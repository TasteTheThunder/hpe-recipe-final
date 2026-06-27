package com.hpe.recipe.service;

import com.hpe.recipe.config.PromotionProperties;
import com.hpe.recipe.model.ComponentSpec;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Service
public class HelmReleaseService {

    private final List<String> promotionPipeline;
    private final GitStateService gitState;

    public HelmReleaseService(PromotionProperties promotionProperties, GitStateService gitState) {
        this.promotionPipeline = promotionProperties.getPipeline();
        this.gitState = gitState;
    }


    public static String helmReleaseNameForCluster(String cluster) {
        return "recipe-" + cluster;
    }

    public Optional<HelmRelease> getActiveDeployedCatalog(String cluster) {
        // Git is the source of truth: the env file holds the single current version for this cluster.
        String version = gitState.readEnvironmentVersion(cluster);
        if (version == null || version.isBlank()) {
            return Optional.empty();
        }
        HelmRelease release = gitState.readVersion(version);
        if (release == null) {
            return Optional.empty();
        }
        release.setCluster(cluster);
        release.setStatus("deployed");
        release.setReleaseName(helmReleaseNameForCluster(cluster));
        return Optional.of(release);
    }

    public void validatePromotionDeploy(String targetCluster, String version) {
        if (!promotionPipeline.contains(targetCluster)) {
            throw new IllegalStateException("Unknown cluster: " + targetCluster);
        }

        int idx = promotionPipeline.indexOf(targetCluster);
        if (idx == 0) {
            return;
        }

        String requiredCluster = promotionPipeline.get(idx - 1);
        if (getDeployedFromCluster(requiredCluster, version) == null) {
            throw new IllegalStateException(
                    "Version " + version + " must be deployed on " + requiredCluster.toUpperCase()
                            + " before promoting to " + targetCluster.toUpperCase()
                            + " (pipeline: " + String.join(" → ", promotionPipeline) + ")");
        }
    }

    public Optional<String> getNextPromotionTarget(String version) {
        int furthest = -1;
        for (int i = 0; i < promotionPipeline.size(); i++) {
            if (getDeployedFromCluster(promotionPipeline.get(i), version) != null) {
                furthest = i;
            }
        }
        if (furthest < 0 || furthest >= promotionPipeline.size() - 1) {
            return Optional.empty();
        }
        return Optional.of(promotionPipeline.get(furthest + 1));
    }

    public Map<String, Object> getPromotionOptions(String version) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("pipeline", promotionPipeline);

        Map<String, Boolean> deployedOn = new LinkedHashMap<>();
        Map<String, String> activeVersions = new LinkedHashMap<>();
        for (String cluster : promotionPipeline) {
            Optional<HelmRelease> active = getActiveDeployedCatalog(cluster);
            activeVersions.put(cluster, active.map(HelmRelease::getVersion).orElse(""));
            deployedOn.put(cluster, getDeployedFromCluster(cluster, version) != null);
        }
        result.put("deployedOn", deployedOn);
        result.put("activeVersionOnCluster", activeVersions);

        // Forward-only: the only allowed target is the next stage past the version's furthest one.
        Optional<String> next = getNextPromotionTarget(version);
        List<String> allowedTargets = new ArrayList<>();
        next.ifPresent(allowedTargets::add);
        result.put("allowedTargets", allowedTargets);
        next.ifPresent(n -> result.put("nextTarget", n));
        return result;
    }

    public HelmRelease resolveReleaseForDeploy(String targetCluster, String version) {
        String v = RecipeDataMapper.normalizeVersion(version);
        HelmRelease release = v == null ? null : gitState.readVersion(v);
        if (release == null) {
            return null;
        }
        release.setCluster(targetCluster);
        return release;
    }


    public List<HelmRelease> getAllHelmReleases(String cluster) {
        // All catalog versions are global in Git; mark the one currently live in this cluster.
        String active = gitState.readEnvironmentVersion(cluster);
        List<HelmRelease> result = new ArrayList<>();
        for (String version : gitState.listVersions()) {
            HelmRelease release = gitState.readVersion(version);
            if (release == null) {
                continue;
            }
            release.setCluster(cluster);
            release.setReleaseName(helmReleaseNameForCluster(cluster));
            release.setStatus(version.equals(active) ? "deployed" : "available");
            result.add(release);
        }
        result.sort(Comparator.comparing(HelmRelease::getVersion));
        return result;
    }

    public HelmRelease getHelmRelease(String cluster, String version) {
        String v = RecipeDataMapper.normalizeVersion(version);
        if (v == null || !gitState.versionExists(v)) {
            return null;
        }
        HelmRelease release = gitState.readVersion(v);
        if (release == null) {
            return null;
        }
        release.setCluster(cluster);
        String active = gitState.readEnvironmentVersion(cluster);
        release.setStatus(v.equals(active) ? "deployed" : "available");
        release.setReleaseName(helmReleaseNameForCluster(cluster));
        return release;
    }

    public HelmRelease createHelmRelease(String cluster, HelmRelease release) {
        String version = RecipeDataMapper.normalizeVersion(release.getVersion());
        if (version == null || version.isBlank() || gitState.versionExists(version)) {
            return null;
        }
        release.setVersion(version);
        gitState.writeVersion(release);
        return getHelmRelease(cluster, version);
    }

    public HelmRelease updateHelmRelease(String cluster, String version, HelmRelease release) {
        String v = RecipeDataMapper.normalizeVersion(version);
        if (v == null || !gitState.versionExists(v)) {
            return null;
        }
        release.setVersion(v);
        gitState.writeVersion(release);
        return getHelmRelease(cluster, v);
    }


    public List<Recipe> getRecipesByHelmVersion(String cluster, String version) {
        HelmRelease r = getHelmRelease(cluster, version);
        return r != null ? r.getRecipes() : Collections.emptyList();
    }

    public Recipe addRecipeToRelease(String cluster, String version, Recipe recipe) {
        String v = RecipeDataMapper.normalizeVersion(version);
        HelmRelease r = v == null ? null : gitState.readVersion(v);
        if (r == null) return null;

        if (r.getRecipes() == null) {
            r.setRecipes(new ArrayList<>());
        }
        r.getRecipes().add(recipe);
        gitState.writeVersion(r);

        return recipe;
    }

    public Recipe updateRecipeInRelease(String cluster, String version, String recipeVersion, Recipe recipe) {

        String v = RecipeDataMapper.normalizeVersion(version);
        HelmRelease r = v == null ? null : gitState.readVersion(v);
        if (r == null || r.getRecipes() == null) return null;

        for (int i = 0; i < r.getRecipes().size(); i++) {
            if (r.getRecipes().get(i).getVersion().equals(recipeVersion)) {
                if (recipe != null && (recipe.getVersion() == null || recipe.getVersion().isBlank())) {
                    recipe.setVersion(recipeVersion);
                }
                r.getRecipes().set(i, recipe);
                gitState.writeVersion(r);
                return recipe;
            }
        }
        return null;
    }

    public boolean deleteRecipeFromRelease(String cluster, String version, String recipeVersion) {

        String v = RecipeDataMapper.normalizeVersion(version);
        HelmRelease r = v == null ? null : gitState.readVersion(v);
        if (r == null || r.getRecipes() == null) return false;

        boolean removed = r.getRecipes().removeIf(x -> x.getVersion().equals(recipeVersion));

        if (removed) {
            gitState.writeVersion(r);
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

    public HelmRelease getDeployedFromCluster(String cluster, String version) {
        String active = gitState.readEnvironmentVersion(cluster);
        String v = RecipeDataMapper.normalizeVersion(version);
        if (active == null || v == null || !active.equals(v)) {
            return null;
        }
        HelmRelease release = gitState.readVersion(active);
        if (release == null) {
            return null;
        }
        release.setCluster(cluster);
        release.setStatus("deployed");
        release.setReleaseName(helmReleaseNameForCluster(cluster));
        return release;
    }

    public List<HelmRelease> getDeployedHelmReleases(String cluster) {
        return getActiveDeployedCatalog(cluster)
                .map(active -> new ArrayList<>(List.of(active)))
                .orElseGet(ArrayList::new);
    }

    public Optional<String> getLatestDeployedVersion(String cluster) {
        return getActiveDeployedCatalog(cluster).map(HelmRelease::getVersion);
    }

    public Map<String, Object> getDeployPreview(String cluster, String version, String baseline) {
        HelmRelease proposed = resolveReleaseForDeploy(cluster, version);
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

        return getLatestDeployedVersion(cluster)
                .filter(v -> !v.equals(version))
                .orElse(null);
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
}
