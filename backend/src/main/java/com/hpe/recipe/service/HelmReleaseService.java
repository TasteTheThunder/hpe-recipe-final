package com.hpe.recipe.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.hpe.recipe.model.ComponentSpec;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;
import io.fabric8.kubernetes.api.model.ConfigMap;
import io.fabric8.kubernetes.api.model.StatusDetails;
import io.fabric8.kubernetes.client.KubernetesClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class HelmReleaseService {

    private static final Logger log = LoggerFactory.getLogger(HelmReleaseService.class);

    private static final String LABEL_APP_NAME = "app.kubernetes.io/name";
    private static final String LABEL_MANAGED_BY = "app.kubernetes.io/managed-by";
    private static final String LABEL_APP_VERSION = "app.kubernetes.io/version";
    private static final String ANNOTATION_RELEASE_NAME = "meta.helm.sh/release-name";
    private static final String RECIPE_DATA_KEY = "recipe-data.json";

    private final Map<String, KubernetesClient> clients;
    private final Map<String, Map<String, HelmRelease>> draftReleasesByCluster = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public HelmReleaseService(Map<String, KubernetesClient> clients) {
        this.clients = clients;
    }

    // ================= CLIENT =================

    private KubernetesClient getClient(String cluster) {
        KubernetesClient client = clients.get(cluster);
        if (client == null) {
            throw new RuntimeException("Invalid cluster: " + cluster);
        }
        return client;
    }

    private List<ConfigMap> fetchRecipeConfigMaps(String cluster) {
        return getClient(cluster).configMaps()
                .inNamespace("default")
                .withLabel(LABEL_APP_NAME, "recipe-detection")
                .list()
                .getItems();
    }

    private boolean isHelmManaged(ConfigMap cm) {
        Map<String, String> labels = cm.getMetadata() != null ? cm.getMetadata().getLabels() : null;
        String managedBy = labels != null ? labels.get(LABEL_MANAGED_BY) : null;
        return "Helm".equalsIgnoreCase(managedBy);
    }

    private Map<String, HelmRelease> draftsForCluster(String cluster) {
        return draftReleasesByCluster.computeIfAbsent(cluster, k -> new ConcurrentHashMap<>());
    }

    private HelmRelease copyRelease(HelmRelease source) {
        if (source == null) {
            return null;
        }

        HelmRelease copy = new HelmRelease();
        copy.setVersion(source.getVersion());
        copy.setReleaseName(source.getReleaseName());
        copy.setStatus(source.getStatus());
        copy.setCluster(source.getCluster());
        copy.setCatalogName(source.getCatalogName());
        copy.setCatalogDescription(source.getCatalogDescription());
        copy.setCatalogReleaseDate(source.getCatalogReleaseDate());
        copy.setCatalogStatus(source.getCatalogStatus());
        copy.setMaintainer(source.getMaintainer());
        copy.setValuesFileName(source.getValuesFileName());

        List<Recipe> copiedRecipes = new ArrayList<>();
        if (source.getRecipes() != null) {
            for (Recipe recipe : source.getRecipes()) {
                Recipe r = new Recipe();
                r.setVersion(recipe.getVersion());
                r.setDescription(recipe.getDescription());
                r.setReleaseDate(recipe.getReleaseDate());
                r.setStatus(recipe.getStatus());
                r.setReleaseNotes(recipe.getReleaseNotes());
                r.setComponents(copyComponents(recipe.getComponents()));
                r.setUpgradeTo(recipe.getUpgradeTo() == null
                        ? new ArrayList<>()
                    : new ArrayList<>(recipe.getUpgradeTo()));
                r.setUpgradeFrom(recipe.getUpgradeFrom() == null
                        ? new ArrayList<>()
                        : new ArrayList<>(recipe.getUpgradeFrom()));
                copiedRecipes.add(r);
            }
        }
        copy.setRecipes(copiedRecipes);

        return copy;
    }

    private void storeDraft(String cluster, HelmRelease release) {
        HelmRelease stored = copyRelease(release);
        stored.setCluster(cluster);
        draftsForCluster(cluster).put(stored.getVersion(), stored);
    }

    private HelmRelease getDraft(String cluster, String version) {
        HelmRelease draft = draftsForCluster(cluster).get(version);
        if (draft == null) {
            return null;
        }
        HelmRelease copied = copyRelease(draft);
        copied.setCluster(cluster);
        return copied;
    }

    private void removeDraft(String cluster, String version) {
        draftsForCluster(cluster).remove(version);
    }

    private boolean helmManagedReleaseExists(String cluster, String version) {
        List<ConfigMap> cms = fetchRecipeConfigMaps(cluster);

        return cms.stream().anyMatch(cm -> {
            HelmRelease parsed = parseConfigMap(cluster, cm);
            return parsed != null
                    && version.equals(parsed.getVersion())
                    && isHelmManaged(cm);
        });
    }

    // ================= PARSE =================

    private HelmRelease parseConfigMap(String cluster, ConfigMap cm) {
        try {
            String json = cm.getData().get(RECIPE_DATA_KEY);
            if (json == null || json.isBlank()) return null;

            JsonNode root = objectMapper.readTree(json);
            String version = root.get("chartVersion").asText();
            String releaseName = cm.getMetadata().getAnnotations()
                    .getOrDefault(ANNOTATION_RELEASE_NAME, "unknown");
            String status = root.has("status") ? root.get("status").asText() : "deployed";
            String catalogName = root.has("catalog_name") ? root.get("catalog_name").asText() : "";
            String catalogDescription = root.has("catalog_description") ? root.get("catalog_description").asText() : "";
            String catalogReleaseDate = root.has("release_date") ? root.get("release_date").asText() : "";
            String catalogStatus = root.has("catalog_status") ? root.get("catalog_status").asText() : "";
            String maintainer = root.has("maintainer") ? root.get("maintainer").asText() : "";
            String valuesFileName = root.has("values_file") ? root.get("values_file").asText() : "";

            List<Recipe> recipes = new ArrayList<>();
            Map<String, List<String>> legacyFromByTarget = new LinkedHashMap<>();
            boolean hasExplicitUpgradeTo = false;

            for (JsonNode rNode : root.get("recipes")) {

                Map<String, ComponentSpec> components = new LinkedHashMap<>();
                JsonNode componentsNode = rNode.get("components");
                JsonNode legacyRulesNode = rNode.get("componentUpgradeRules");
                if (componentsNode != null && componentsNode.isObject()) {
                    componentsNode.fields().forEachRemaining(e -> {
                        String name = e.getKey();
                        JsonNode compNode = e.getValue();
                        String versionValue = null;
                        String releaseDate = null;
                        List<String> upgradeFrom = new ArrayList<>();
                        List<String> upgradeTo = new ArrayList<>();

                        if (compNode != null && compNode.isObject()) {
                            versionValue = readText(compNode, "version");
                            releaseDate = readText(compNode, "release_date");
                            upgradeFrom = readStringList(
                                    readFirst(compNode, "upgrade_from", "upgradeFrom"));
                            upgradeTo = readStringList(
                                    readFirst(compNode, "upgrade_to", "upgradeTo"));
                        } else if (compNode != null && compNode.isTextual()) {
                            versionValue = compNode.asText();
                            if (legacyRulesNode != null && legacyRulesNode.isObject()) {
                                JsonNode legacyRule = legacyRulesNode.get(name);
                                if (legacyRule != null && legacyRule.isObject()) {
                                    upgradeFrom = readStringList(legacyRule.get("from"));
                                    upgradeTo = readStringList(legacyRule.get("to"));
                                }
                            }
                        }

                        components.put(name, new ComponentSpec(versionValue, releaseDate, upgradeFrom, upgradeTo));
                    });
                }

                String versionValue = normalizeVersion(rNode.get("version").asText());
                List<String> upgradeTo = normalizeVersions(
                    readStringList(readFirst(rNode, "upgrade_to", "upgradeTo")));
                if (!upgradeTo.isEmpty()) {
                    hasExplicitUpgradeTo = true;
                }
                List<String> upgradeFrom = normalizeVersions(
                    readStringList(readFirst(rNode, "upgrade_from", "upgradeFrom")));

                List<String> legacyFrom = normalizeVersions(readStringList(rNode.get("upgradePaths")));
                if (!legacyFrom.isEmpty()) {
                    legacyFromByTarget.put(versionValue, legacyFrom);
                }

                recipes.add(new Recipe(
                    versionValue,
                    rNode.has("description") ? rNode.get("description").asText() : "",
                    rNode.has("release_date") ? rNode.get("release_date").asText() : "",
                    rNode.has("status") ? rNode.get("status").asText() : "",
                    rNode.has("release_notes") ? rNode.get("release_notes").asText() : "",
                    components,
                    upgradeTo,
                    upgradeFrom
                ));
            }

            if (!hasExplicitUpgradeTo && !legacyFromByTarget.isEmpty()) {
                Map<String, Recipe> byVersion = recipes.stream()
                        .filter(Objects::nonNull)
                        .collect(Collectors.toMap(Recipe::getVersion, r -> r, (a, b) -> a, LinkedHashMap::new));
                for (Map.Entry<String, List<String>> entry : legacyFromByTarget.entrySet()) {
                    String targetVersion = entry.getKey();
                    for (String fromVersion : entry.getValue()) {
                        Recipe source = byVersion.get(fromVersion);
                        if (source == null) continue;
                        List<String> upgradeTo = source.getUpgradeTo();
                        if (upgradeTo == null) {
                            upgradeTo = new ArrayList<>();
                            source.setUpgradeTo(upgradeTo);
                        }
                        if (!upgradeTo.contains(targetVersion)) {
                            upgradeTo.add(targetVersion);
                        }
                    }
                }
            }

                HelmRelease parsedRelease = new HelmRelease(
                    version,
                    releaseName,
                    status,
                    cluster,
                    catalogName,
                    catalogDescription,
                    catalogReleaseDate,
                    catalogStatus,
                    maintainer,
                    recipes);
                if (!valuesFileName.isBlank()) {
                    parsedRelease.setValuesFileName(valuesFileName);
                }
                return parsedRelease;

        } catch (Exception e) {
            log.warn("Parse error: {}", e.getMessage());
            return null;
        }
    }

    // ================= CRUD =================

    public List<HelmRelease> getAllHelmReleases(String cluster) {

        List<ConfigMap> cms = fetchRecipeConfigMaps(cluster);

        // One release per chart version in API responses.
        // If both draft and Helm configmaps exist, prefer draft (pending/deploying state).
        Map<String, ConfigMap> selectedByVersion = new LinkedHashMap<>();
        for (ConfigMap cm : cms) {
            HelmRelease parsed = parseConfigMap(cluster, cm);
            if (parsed == null) {
                continue;
            }

            ConfigMap existing = selectedByVersion.get(parsed.getVersion());
            if (existing == null) {
                selectedByVersion.put(parsed.getVersion(), cm);
                continue;
            }

            if (isHelmManaged(existing) && !isHelmManaged(cm)) {
                selectedByVersion.put(parsed.getVersion(), cm);
            }
        }

        Map<String, HelmRelease> merged = selectedByVersion.values().stream()
                .map(cm -> parseConfigMap(cluster, cm))
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(
                        HelmRelease::getVersion,
                        this::copyRelease,
                        (a, b) -> a,
                        LinkedHashMap::new
                ));

        draftsForCluster(cluster).forEach((version, draft) -> merged.put(version, copyRelease(draft)));

        return merged.values().stream()
                .peek(r -> r.setCluster(cluster))
                .sorted(Comparator.comparing(HelmRelease::getVersion))
                .collect(Collectors.toList());
    }

    public HelmRelease getHelmRelease(String cluster, String version) {
        HelmRelease draft = getDraft(cluster, version);
        if (draft != null) {
            return draft;
        }

        return getAllHelmReleases(cluster).stream()
                .filter(h -> h.getVersion().equals(version))
                .findFirst()
                .orElse(null);
    }

    public HelmRelease createHelmRelease(String cluster, HelmRelease release) {

        if (getHelmRelease(cluster, release.getVersion()) != null) return null;

        if (release.getStatus() == null || release.getStatus().isBlank()) {
            release.setStatus("pending");
        }

        storeDraft(cluster, release);
        return getDraft(cluster, release.getVersion());
    }

    public HelmRelease updateHelmRelease(String cluster, String version, HelmRelease release) {
        if (getHelmRelease(cluster, version) == null) return null;

        release.setVersion(version);
        storeDraft(cluster, release);
        updateConfigMap(cluster, version, release);
        return getDraft(cluster, version);
    }

    public boolean deleteHelmRelease(String cluster, String version) {

        removeDraft(cluster, version);

        List<ConfigMap> cms = fetchRecipeConfigMaps(cluster);
        boolean deleted = false;

        for (ConfigMap cm : cms) {
            HelmRelease r = parseConfigMap(cluster, cm);

            if (r != null && r.getVersion().equals(version)) {

                List<StatusDetails> result = getClient(cluster).configMaps()
                        .inNamespace("default")
                        .withName(cm.getMetadata().getName())
                        .delete();

                boolean removed = result != null && !result.isEmpty();

                deleted = deleted || removed;
            }
        }

        return deleted;
    }

    public void cleanupDraftConfigMapsIfHelmExists(String cluster, String version) {
        List<ConfigMap> cms = fetchRecipeConfigMaps(cluster);

        boolean helmExistsForVersion = cms.stream().anyMatch(cm -> {
            HelmRelease parsed = parseConfigMap(cluster, cm);
            return parsed != null
                    && version.equals(parsed.getVersion())
                    && isHelmManaged(cm);
        });

        if (!helmExistsForVersion) {
            return;
        }

        for (ConfigMap cm : cms) {
            HelmRelease parsed = parseConfigMap(cluster, cm);
            if (parsed != null
                    && version.equals(parsed.getVersion())
                    && !isHelmManaged(cm)) {
                getClient(cluster).configMaps()
                        .inNamespace("default")
                        .withName(cm.getMetadata().getName())
                        .delete();
            }
        }
    }

    public void cleanupDraftReleaseIfHelmExists(String cluster, String version) {
        if (helmManagedReleaseExists(cluster, version)) {
            removeDraft(cluster, version);
        }
    }

    // ================= RECIPE =================

    public List<Recipe> getRecipesByHelmVersion(String cluster, String version) {
        HelmRelease r = getHelmRelease(cluster, version);
        return r != null ? r.getRecipes() : Collections.emptyList();
    }

    public Recipe addRecipeToRelease(String cluster, String version, Recipe recipe) {

        HelmRelease r = getHelmRelease(cluster, version);
        if (r == null) return null;

        r.getRecipes().add(recipe);
        storeDraft(cluster, r);
        updateConfigMap(cluster, version, r);

        return recipe;
    }

    public Recipe updateRecipeInRelease(String cluster, String version, String recipeVersion, Recipe recipe) {

        HelmRelease r = getHelmRelease(cluster, version);
        if (r == null) return null;

        for (int i = 0; i < r.getRecipes().size(); i++) {
            if (r.getRecipes().get(i).getVersion().equals(recipeVersion)) {
                if (recipe != null && (recipe.getVersion() == null || recipe.getVersion().isBlank())) {
                    recipe.setVersion(recipeVersion);
                }
                r.getRecipes().set(i, recipe);
                storeDraft(cluster, r);
                updateConfigMap(cluster, version, r);
                return recipe;
            }
        }
        return null;
    }

    public boolean deleteRecipeFromRelease(String cluster, String version, String recipeVersion) {

        HelmRelease r = getHelmRelease(cluster, version);
        if (r == null) return false;

        boolean removed = r.getRecipes().removeIf(x -> x.getVersion().equals(recipeVersion));

        if (removed) {
            storeDraft(cluster, r);
            updateConfigMap(cluster, version, r);
        }

        return removed;
    }

    public Map<String, ComponentSpec> getComponentsByRecipe(String cluster, String version, String recipeVersion) {

        HelmRelease r = getHelmRelease(cluster, version);
        if (r == null) return Collections.emptyMap();

        return r.getRecipes().stream()
                .filter(x -> x.getVersion().equals(recipeVersion))
                .findFirst()
                .map(Recipe::getComponents)
                .orElse(Collections.emptyMap());
    }

    public List<String> getUpgradePaths(String cluster, String version, String recipeVersion) {

        HelmRelease r = getHelmRelease(cluster, version);
        if (r == null) return Collections.emptyList();

        return r.getRecipes().stream()
                .filter(x -> x.getVersion().equals(recipeVersion))
                .findFirst()
                .map(Recipe::getUpgradeTo)
                .orElse(Collections.emptyList());
    }

    // ================= COMPARE =================

    public Map<String, Object> getUpgradePathsBetweenHelmVersions(String cluster, String from, String to) {

        HelmRelease r1 = getHelmRelease(cluster, from);
        HelmRelease r2 = getHelmRelease(cluster, to);

        if (r1 == null || r2 == null) return Map.of("error", "Invalid versions");

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("from", from);
        result.put("to", to);

        Map<String, Recipe> fromByVersion = new LinkedHashMap<>();
        for (Recipe r : safeRecipes(r1)) {
            fromByVersion.put(r.getVersion(), r);
        }

        Map<String, Recipe> toByVersion = new LinkedHashMap<>();
        for (Recipe r : safeRecipes(r2)) {
            toByVersion.put(r.getVersion(), r);
        }

        List<Map<String, Object>> recipesAdded = new ArrayList<>();
        List<Map<String, Object>> recipesRemoved = new ArrayList<>();
        List<Map<String, Object>> recipesChanged = new ArrayList<>();

        for (String v : toByVersion.keySet()) {
            if (!fromByVersion.containsKey(v)) {
                Recipe r = toByVersion.get(v);
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("version", v);
                entry.put("description", r.getDescription());
                recipesAdded.add(entry);
            }
        }

        for (String v : fromByVersion.keySet()) {
            if (!toByVersion.containsKey(v)) {
                Recipe r = fromByVersion.get(v);
                Map<String, Object> entry = new LinkedHashMap<>();
                entry.put("version", v);
                entry.put("description", r.getDescription());
                recipesRemoved.add(entry);
            }
        }

        for (String v : fromByVersion.keySet()) {
            if (!toByVersion.containsKey(v)) continue;

            Recipe a = fromByVersion.get(v);
            Recipe b = toByVersion.get(v);

            Map<String, Object> changes = new LinkedHashMap<>();
            changes.put("version", v);

            Map<String, ComponentSpec> compsFrom = safeComponents(a);
            Map<String, ComponentSpec> compsTo = safeComponents(b);

            Map<String, String> compsAdded = new LinkedHashMap<>();
            Map<String, String> compsRemoved = new LinkedHashMap<>();
            Map<String, Map<String, String>> compsChanged = new LinkedHashMap<>();

            for (String comp : compsTo.keySet()) {
                if (!compsFrom.containsKey(comp)) {
                    compsAdded.put(comp, componentVersion(compsTo.get(comp)));
                }
            }

            for (String comp : compsFrom.keySet()) {
                if (!compsTo.containsKey(comp)) {
                    compsRemoved.put(comp, componentVersion(compsFrom.get(comp)));
                } else {
                    String v1 = componentVersion(compsFrom.get(comp));
                    String v2 = componentVersion(compsTo.get(comp));
                    if (!Objects.equals(v1, v2)) {
                        Map<String, String> change = new LinkedHashMap<>();
                        change.put("from", v1);
                        change.put("to", v2);
                        compsChanged.put(comp, change);
                    }
                }
            }

            Map<String, Object> compChanges = new LinkedHashMap<>();
            if (!compsAdded.isEmpty()) compChanges.put("added", compsAdded);
            if (!compsRemoved.isEmpty()) compChanges.put("removed", compsRemoved);
            if (!compsChanged.isEmpty()) compChanges.put("changed", compsChanged);
            if (!compChanges.isEmpty()) changes.put("components", compChanges);

            List<String> pathsFrom = safeUpgradeTo(a);
            List<String> pathsTo = safeUpgradeTo(b);
            Set<String> fromSet = new LinkedHashSet<>(pathsFrom);
            Set<String> toSet = new LinkedHashSet<>(pathsTo);

            List<String> pathsAdded = new ArrayList<>();
            List<String> pathsRemoved = new ArrayList<>();

            for (String p : toSet) {
                if (!fromSet.contains(p)) pathsAdded.add(p);
            }
            for (String p : fromSet) {
                if (!toSet.contains(p)) pathsRemoved.add(p);
            }

            if (!pathsAdded.isEmpty() || !pathsRemoved.isEmpty()) {
                Map<String, Object> pathChanges = new LinkedHashMap<>();
                if (!pathsAdded.isEmpty()) pathChanges.put("added", pathsAdded);
                if (!pathsRemoved.isEmpty()) pathChanges.put("removed", pathsRemoved);
                changes.put("upgrade_to", pathChanges);
            }

            if (changes.size() > 1) {
                recipesChanged.add(changes);
            }
        }

        result.put("recipesAdded", recipesAdded);
        result.put("recipesRemoved", recipesRemoved);
        result.put("recipesChanged", recipesChanged);

        return result;
    }

    private List<Recipe> safeRecipes(HelmRelease release) {
        return release.getRecipes() != null ? release.getRecipes() : Collections.emptyList();
    }

    private Map<String, ComponentSpec> safeComponents(Recipe recipe) {
        return recipe.getComponents() != null ? recipe.getComponents() : Collections.emptyMap();
    }

    private List<String> safeUpgradeTo(Recipe recipe) {
        return recipe.getUpgradeTo() != null ? recipe.getUpgradeTo() : Collections.emptyList();
    }

    private List<String> safeUpgradeFrom(Recipe recipe) {
        return recipe.getUpgradeFrom() != null ? recipe.getUpgradeFrom() : Collections.emptyList();
    }

    private List<String> getUpgradeFromVersions(List<Recipe> recipes, Recipe target) {
        if (recipes == null || target == null || target.getVersion() == null) {
            return Collections.emptyList();
        }
        List<String> explicit = safeUpgradeFrom(target);
        if (!explicit.isEmpty()) {
            return explicit;
        }
        List<String> fromVersions = new ArrayList<>();
        String targetVersion = target.getVersion();
        for (Recipe recipe : recipes) {
            if (recipe == null) continue;
            List<String> upgradeTo = safeUpgradeTo(recipe);
            if (upgradeTo.contains(targetVersion)) {
                fromVersions.add(recipe.getVersion());
            }
        }
        return fromVersions;
    }

    private Map<String, ComponentSpec> copyComponents(Map<String, ComponentSpec> components) {
        if (components == null) return new LinkedHashMap<>();
        Map<String, ComponentSpec> copy = new LinkedHashMap<>();
        for (Map.Entry<String, ComponentSpec> entry : components.entrySet()) {
            ComponentSpec spec = entry.getValue();
            if (spec == null) continue;
            copy.put(entry.getKey(), new ComponentSpec(
                    spec.getVersion(),
                    spec.getReleaseDate(),
                    spec.getUpgradeFrom(),
                    spec.getUpgradeTo()
            ));
        }
        return copy;
    }

    public Optional<String> validateComponentUpgradeCompatibility(HelmRelease release) {
        if (release == null || release.getRecipes() == null) return Optional.empty();

        List<Recipe> recipes = release.getRecipes();
        Map<String, Recipe> recipesByVersion = recipes.stream()
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(Recipe::getVersion, r -> r, (a, b) -> a, LinkedHashMap::new));

        Map<String, Map<String, ComponentSpec>> rulesByComponentVersion = new LinkedHashMap<>();

        for (Recipe recipe : recipes) {
            Map<String, ComponentSpec> components = safeComponents(recipe);
            for (Map.Entry<String, ComponentSpec> entry : components.entrySet()) {
                String compName = entry.getKey();
                ComponentSpec spec = entry.getValue();
                String compVersion = componentVersion(spec);
                if (compVersion == null) continue;
                Map<String, ComponentSpec> byVersion =
                        rulesByComponentVersion.computeIfAbsent(compName, k -> new LinkedHashMap<>());
                ComponentSpec existing = byVersion.get(compVersion);
                if (existing != null && !componentRuleEquals(existing, spec)) {
                    return Optional.of(
                            "Conflicting upgrade rules for component " + compName + " version " + compVersion);
                }
                byVersion.put(compVersion, new ComponentSpec(
                        compVersion,
                    spec.getReleaseDate(),
                        spec.getUpgradeFrom(),
                        spec.getUpgradeTo()
                ));
            }
        }

        for (Recipe target : recipes) {
            List<String> fromVersions = getUpgradeFromVersions(recipes, target);
            if (fromVersions.isEmpty()) continue;

            for (String fromVersion : fromVersions) {
                Recipe source = recipesByVersion.get(fromVersion);
                if (source == null) {
                    return Optional.of("Upgrade path references missing recipe version " + fromVersion);
                }

                Map<String, ComponentSpec> targetComponents = safeComponents(target);
                Map<String, ComponentSpec> sourceComponents = safeComponents(source);

                for (Map.Entry<String, ComponentSpec> compEntry : targetComponents.entrySet()) {
                    String compName = compEntry.getKey();
                    String targetVersion = componentVersion(compEntry.getValue());
                    String sourceVersion = componentVersion(sourceComponents.get(compName));
                    if (sourceVersion == null || targetVersion == null) continue;

                    ComponentSpec targetRule = rulesByComponentVersion
                            .getOrDefault(compName, Collections.emptyMap())
                            .get(targetVersion);
                    ComponentSpec sourceRule = rulesByComponentVersion
                            .getOrDefault(compName, Collections.emptyMap())
                            .get(sourceVersion);

                    if (targetRule != null && !isAllowed(targetRule.getUpgradeFrom(), sourceVersion)) {
                        return Optional.of("Component " + compName + " version " + targetVersion
                                + " cannot upgrade from " + sourceVersion);
                    }
                    if (sourceRule != null && !isAllowed(sourceRule.getUpgradeTo(), targetVersion)) {
                        return Optional.of("Component " + compName + " version " + sourceVersion
                                + " cannot upgrade to " + targetVersion);
                    }
                }
            }
        }

        return Optional.empty();
    }

    private boolean isAllowed(List<String> allowed, String version) {
        if (allowed == null || allowed.isEmpty()) return true;
        return allowed.contains(version);
    }

    private boolean componentRuleEquals(ComponentSpec a, ComponentSpec b) {
        List<String> fromA = a.getUpgradeFrom() != null ? a.getUpgradeFrom() : Collections.emptyList();
        List<String> fromB = b.getUpgradeFrom() != null ? b.getUpgradeFrom() : Collections.emptyList();
        List<String> toA = a.getUpgradeTo() != null ? a.getUpgradeTo() : Collections.emptyList();
        List<String> toB = b.getUpgradeTo() != null ? b.getUpgradeTo() : Collections.emptyList();
        return new LinkedHashSet<>(fromA).equals(new LinkedHashSet<>(fromB))
                && new LinkedHashSet<>(toA).equals(new LinkedHashSet<>(toB));
    }

    private String componentVersion(ComponentSpec spec) {
        return spec != null ? spec.getVersion() : null;
    }

    private Map<String, Object> buildComponentPayload(Map<String, ComponentSpec> components) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (components == null) return payload;

        for (Map.Entry<String, ComponentSpec> entry : components.entrySet()) {
            ComponentSpec spec = entry.getValue();
            if (spec == null) continue;
            Map<String, Object> specMap = new LinkedHashMap<>();
            specMap.put("version", spec.getVersion());
            if (spec.getReleaseDate() != null && !spec.getReleaseDate().isBlank()) {
                specMap.put("release_date", spec.getReleaseDate());
            }
            specMap.put("upgrade_from", safeList(spec.getUpgradeFrom()));
            specMap.put("upgrade_to", safeList(spec.getUpgradeTo()));
            payload.put(entry.getKey(), specMap);
        }

        return payload;
    }

    private List<String> safeList(List<String> items) {
        return items != null ? items : Collections.emptyList();
    }

    private String readText(JsonNode node, String field) {
        if (node == null) return null;
        JsonNode value = node.get(field);
        return value != null && value.isTextual() ? value.asText() : null;
    }

    private JsonNode readFirst(JsonNode node, String primary, String fallback) {
        if (node == null) return null;
        JsonNode first = node.get(primary);
        if (first != null) return first;
        return node.get(fallback);
    }

    private List<String> readStringList(JsonNode node) {
        if (node == null) return new ArrayList<>();
        List<String> values = new ArrayList<>();
        if (node.isArray()) {
            node.forEach(v -> values.add(v.asText()));
        } else if (node.isTextual()) {
            String raw = node.asText();
            Arrays.stream(raw.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .forEach(values::add);
        }
        return values;
    }

    private String normalizeVersion(String version) {
        if (version == null) return null;
        return version.trim().replaceFirst("^[vV]", "");
    }

    private List<String> normalizeVersions(List<String> versions) {
        if (versions == null) return Collections.emptyList();
        List<String> normalized = new ArrayList<>();
        for (String v : versions) {
            String clean = normalizeVersion(v);
            if (clean != null && !clean.isBlank()) normalized.add(clean);
        }
        return normalized;
    }

    // ================= INTERNAL =================

    private void updateConfigMap(String cluster, String version, HelmRelease release) {

        List<ConfigMap> cms = fetchRecipeConfigMaps(cluster);

        for (ConfigMap cm : cms) {

            HelmRelease parsed = parseConfigMap(cluster, cm);

                if (parsed != null
                    && parsed.getVersion().equals(version)
                    && !isHelmManaged(cm)) {

                try {
                    cm.getData().put(RECIPE_DATA_KEY, buildRecipeJson(release));

                    getClient(cluster).configMaps()
                            .inNamespace("default")
                            .resource(cm)
                            .update();

                } catch (Exception e) {
                    log.error("Update failed: {}", e.getMessage());
                }
            }
        }
    }

    private String buildRecipeJson(HelmRelease release) {

        try {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("chartVersion", release.getVersion());
            data.put("status", release.getStatus());
            if (release.getCatalogName() != null && !release.getCatalogName().isBlank()) {
                data.put("catalog_name", release.getCatalogName());
            }
            if (release.getCatalogDescription() != null && !release.getCatalogDescription().isBlank()) {
                data.put("catalog_description", release.getCatalogDescription());
            }
            if (release.getCatalogReleaseDate() != null && !release.getCatalogReleaseDate().isBlank()) {
                data.put("release_date", release.getCatalogReleaseDate());
            }
            if (release.getCatalogStatus() != null && !release.getCatalogStatus().isBlank()) {
                data.put("catalog_status", release.getCatalogStatus());
            }
            if (release.getMaintainer() != null && !release.getMaintainer().isBlank()) {
                data.put("maintainer", release.getMaintainer());
            }

            List<Map<String, Object>> recipes = new ArrayList<>();

            for (Recipe r : release.getRecipes()) {

                Map<String, Object> map = new LinkedHashMap<>();
                map.put("version", normalizeVersion(r.getVersion()));
                map.put("description", r.getDescription());
                if (r.getReleaseDate() != null && !r.getReleaseDate().isBlank()) {
                    map.put("release_date", r.getReleaseDate());
                }
                if (r.getStatus() != null && !r.getStatus().isBlank()) {
                    map.put("status", r.getStatus());
                }
                if (r.getReleaseNotes() != null && !r.getReleaseNotes().isBlank()) {
                    map.put("release_notes", r.getReleaseNotes());
                }
                map.put("components", buildComponentPayload(r.getComponents()));
                List<String> upgradeTo = normalizeVersions(r.getUpgradeTo());
                if (!upgradeTo.isEmpty()) {
                    map.put("upgrade_to", upgradeTo);
                }
                List<String> upgradeFrom = normalizeVersions(r.getUpgradeFrom());
                if (!upgradeFrom.isEmpty()) {
                    map.put("upgrade_from", upgradeFrom);
                }

                recipes.add(map);
            }

            data.put("recipes", recipes);

            return objectMapper.writeValueAsString(data);

        } catch (Exception e) {
            return "{}";
        }
    }


    public HelmRelease getDeployedFromCluster(String cluster, String version) {
        for (ConfigMap cm : fetchRecipeConfigMaps(cluster)) {
            if (!isHelmManaged(cm)) {
                continue;
            }
            HelmRelease parsed = parseConfigMap(cluster, cm);
            if (parsed != null && version.equals(parsed.getVersion())) {
                HelmRelease copy = copyRelease(parsed);
                copy.setCluster(cluster);
                copy.setStatus("deployed");
                return copy;
            }
        }
        return null;
    }

    public List<HelmRelease> getDeployedHelmReleases(String cluster) {
        List<HelmRelease> result = new ArrayList<>();
        for (ConfigMap cm : fetchRecipeConfigMaps(cluster)) {
            if (!isHelmManaged(cm)) {
                continue;
            }
            HelmRelease parsed = parseConfigMap(cluster, cm);
            if (parsed != null) {
                HelmRelease copy = copyRelease(parsed);
                copy.setCluster(cluster);
                copy.setStatus("deployed");
                result.add(copy);
            }
        }
        result.sort((a, b) -> compareVersions(a.getVersion(), b.getVersion()));
        return result;
    }

    public Optional<String> getLatestDeployedVersion(String cluster) {
        List<HelmRelease> deployed = getDeployedHelmReleases(cluster);
        if (deployed.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(deployed.get(deployed.size() - 1).getVersion());
    }

    public Map<String, Object> getDeployPreview(String cluster, String version, String baseline) {
        HelmRelease proposed = getHelmRelease(cluster, version);
        if (proposed == null) {
            return Map.of("error", "Release not found");
        }

        String baselineVersion = resolveBaselineVersion(cluster, version, baseline);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("cluster", cluster);
        result.put("targetVersion", version);
        result.put("baselineVersion", baselineVersion != null ? baselineVersion : "");
        result.put("isNewDeploy", baselineVersion == null);

        if (baselineVersion == null) {
            result.put("recipesAdded", List.of());
            result.put("recipesRemoved", List.of());
            result.put("recipesChanged", List.of());
            result.put("hasChanges", !safeRecipes(proposed).isEmpty());
            result.put("summary", "First deploy to this cluster — no previous Helm release to compare against.");
            return result;
        }

        Map<String, Object> diff = getUpgradePathsBetweenHelmVersions(cluster, baselineVersion, version);
        result.putAll(diff);
        result.put("hasChanges", hasRecipeDiffs(diff));
        result.put("summary", hasRecipeDiffs(diff)
                ? "Changes detected versus currently deployed v" + baselineVersion + "."
                : "No recipe differences versus currently deployed v" + baselineVersion + ".");
        return result;
    }

    private String resolveBaselineVersion(String cluster, String version, String baseline) {
        if (baseline != null && ("none".equalsIgnoreCase(baseline) || "new".equalsIgnoreCase(baseline))) {
            return null;
        }
        if (baseline != null && !baseline.isBlank()
                && !"latest".equalsIgnoreCase(baseline)
                && !"auto".equalsIgnoreCase(baseline)) {
            return getHelmRelease(cluster, baseline) != null || getDeployedFromCluster(cluster, baseline) != null
                    ? baseline
                    : null;
        }

        HelmRelease deployedTarget = getDeployedFromCluster(cluster, version);
        if (deployedTarget != null) {
            return version;
        }

        Optional<String> latest = getLatestDeployedVersion(cluster);
        if (latest.isPresent() && !latest.get().equals(version)) {
            return latest.get();
        }

        return null;
    }

    private boolean hasRecipeDiffs(Map<String, Object> diff) {
        return !asList(diff.get("recipesAdded")).isEmpty()
                || !asList(diff.get("recipesRemoved")).isEmpty()
                || !asList(diff.get("recipesChanged")).isEmpty();
    }

    @SuppressWarnings("unchecked")
    private List<Object> asList(Object value) {
        if (value instanceof List<?> list) {
            return (List<Object>) list;
        }
        return Collections.emptyList();
    }

    int compareVersions(String a, String b) {
        String[] partsA = a.split("\\.");
        String[] partsB = b.split("\\.");
        int len = Math.max(partsA.length, partsB.length);
        for (int i = 0; i < len; i++) {
            int numA = i < partsA.length ? parseVersionPart(partsA[i]) : 0;
            int numB = i < partsB.length ? parseVersionPart(partsB[i]) : 0;
            if (numA != numB) {
                return Integer.compare(numA, numB);
            }
        }
        return 0;
    }

    private int parseVersionPart(String part) {
        try {
            return Integer.parseInt(part.replaceAll("[^0-9].*", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}