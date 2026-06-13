package com.hpe.recipe.service;

import com.hpe.recipe.model.ComponentSpec;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Single, format-agnostic converter between {@link HelmRelease} and the {@code recipeData}
 * Map shape used across the catalog (Helm values files, ConfigMaps, and the Git version files).
 *
 * <p>Centralizing it here keeps the Git version-file reader/writer behaviourally identical to
 * the historical ConfigMap parser — same version normalization (strip a leading {@code v}),
 * same legacy {@code componentUpgradeRules}/{@code upgradePaths} handling — so the two readers
 * can never disagree about the same bytes.
 *
 * <p>NOTE: {@code GitOpsService.generateValuesYaml} and {@code HelmReleaseService.parseConfigMap}/
 * {@code buildRecipeJson} still carry their own copies of this logic. Routing them through this
 * mapper is folded into the write-phase cutover (cleanup #10); at that point this becomes the
 * only implementation. Until then, this is the canonical reader/writer for the Git path.
 */
public final class RecipeDataMapper {

    private RecipeDataMapper() {
    }

    // ---------- model -> recipeData map ----------

    /** Build the cluster-agnostic recipeData map (no target_cluster/values_file — those are per-deploy). */
    public static Map<String, Object> toRecipeData(HelmRelease release) {
        Map<String, Object> recipeData = new LinkedHashMap<>();
        recipeData.put("chartVersion", release.getVersion());
        putIfPresent(recipeData, "catalog_name", release.getCatalogName());
        putIfPresent(recipeData, "catalog_description", release.getCatalogDescription());
        putIfPresent(recipeData, "release_date", release.getCatalogReleaseDate());
        putIfPresent(recipeData, "catalog_status", release.getCatalogStatus());
        putIfPresent(recipeData, "maintainer", release.getMaintainer());

        List<Map<String, Object>> recipeMaps = new ArrayList<>();
        if (release.getRecipes() != null) {
            for (Recipe recipe : release.getRecipes()) {
                Map<String, Object> rm = new LinkedHashMap<>();
                rm.put("version", normalizeVersion(recipe.getVersion()));
                putIfPresent(rm, "description", recipe.getDescription());
                putIfPresent(rm, "release_date", recipe.getReleaseDate());
                putIfPresent(rm, "status", recipe.getStatus());
                putIfPresent(rm, "release_notes", recipe.getReleaseNotes());

                Map<String, Object> comps = new LinkedHashMap<>();
                if (recipe.getComponents() != null) {
                    recipe.getComponents().forEach((name, spec) -> {
                        if (spec == null) {
                            return;
                        }
                        Map<String, Object> cm = new LinkedHashMap<>();
                        cm.put("version", spec.getVersion());
                        putIfPresent(cm, "release_date", spec.getReleaseDate());
                        cm.put("upgrade_from", spec.getUpgradeFrom() != null
                                ? new ArrayList<>(spec.getUpgradeFrom()) : new ArrayList<>());
                        cm.put("upgrade_to", spec.getUpgradeTo() != null
                                ? new ArrayList<>(spec.getUpgradeTo()) : new ArrayList<>());
                        comps.put(name, cm);
                    });
                }
                rm.put("components", comps);

                List<String> upgradeTo = normalizeVersions(recipe.getUpgradeTo());
                if (!upgradeTo.isEmpty()) {
                    rm.put("upgrade_to", upgradeTo);
                }
                List<String> upgradeFrom = normalizeVersions(recipe.getUpgradeFrom());
                if (!upgradeFrom.isEmpty()) {
                    rm.put("upgrade_from", upgradeFrom);
                }
                recipeMaps.add(rm);
            }
        }
        recipeData.put("recipes", recipeMaps);
        return recipeData;
    }

    // ---------- recipeData map -> model ----------

    @SuppressWarnings("unchecked")
    public static HelmRelease fromRecipeData(Map<String, Object> recipeData, String fallbackVersion) {
        if (recipeData == null) {
            recipeData = Map.of();
        }

        HelmRelease hr = new HelmRelease();
        Object chartVersion = recipeData.get("chartVersion");
        hr.setVersion(chartVersion != null ? String.valueOf(chartVersion) : fallbackVersion);
        hr.setCatalogName(str(recipeData.get("catalog_name")));
        hr.setCatalogDescription(str(recipeData.get("catalog_description")));
        hr.setCatalogReleaseDate(str(recipeData.get("release_date")));
        hr.setCatalogStatus(str(recipeData.get("catalog_status")));
        hr.setMaintainer(str(recipeData.get("maintainer")));
        hr.setStatus(str(recipeData.get("status")));

        List<Recipe> recipes = new ArrayList<>();
        Map<String, List<String>> legacyFromByTarget = new LinkedHashMap<>();
        Map<String, Recipe> byVersion = new LinkedHashMap<>();
        boolean hasExplicitUpgradeTo = false;

        Object recipesNode = recipeData.get("recipes");
        if (recipesNode instanceof List<?> list) {
            for (Object rObj : list) {
                if (!(rObj instanceof Map)) {
                    continue;
                }
                Map<String, Object> rm = (Map<String, Object>) rObj;

                Map<String, ComponentSpec> components = new LinkedHashMap<>();
                Object compsNode = rm.get("components");
                Object legacyRules = rm.get("componentUpgradeRules");
                if (compsNode instanceof Map<?, ?> cmap) {
                    for (Map.Entry<?, ?> e : cmap.entrySet()) {
                        String cname = String.valueOf(e.getKey());
                        Object cval = e.getValue();
                        if (cval instanceof Map<?, ?> cm) {
                            Map<String, Object> c = (Map<String, Object>) cm;
                            components.put(cname, new ComponentSpec(
                                    str(c.get("version")),
                                    str(c.get("release_date")),
                                    readList(firstOf(c, "upgrade_from", "upgradeFrom")),
                                    readList(firstOf(c, "upgrade_to", "upgradeTo"))));
                        } else if (cval != null) {
                            // Legacy scalar component: "name: version" + optional componentUpgradeRules.
                            List<String> from = new ArrayList<>();
                            List<String> to = new ArrayList<>();
                            if (legacyRules instanceof Map<?, ?> lr) {
                                Object rule = ((Map<String, Object>) lr).get(cname);
                                if (rule instanceof Map<?, ?> rmap) {
                                    Map<String, Object> r = (Map<String, Object>) rmap;
                                    from = readList(r.get("from"));
                                    to = readList(r.get("to"));
                                }
                            }
                            components.put(cname, new ComponentSpec(String.valueOf(cval), null, from, to));
                        }
                    }
                }

                String version = normalizeVersion(str(rm.get("version")));
                List<String> upgradeTo = normalizeVersions(readList(firstOf(rm, "upgrade_to", "upgradeTo")));
                if (!upgradeTo.isEmpty()) {
                    hasExplicitUpgradeTo = true;
                }
                List<String> upgradeFrom = normalizeVersions(readList(firstOf(rm, "upgrade_from", "upgradeFrom")));

                List<String> legacyFrom = normalizeVersions(readList(rm.get("upgradePaths")));
                if (!legacyFrom.isEmpty()) {
                    legacyFromByTarget.put(version, legacyFrom);
                }

                Recipe recipe = new Recipe(
                        version,
                        str(rm.get("description")),
                        str(rm.get("release_date")),
                        str(rm.get("status")),
                        str(rm.get("release_notes")),
                        components,
                        upgradeTo,
                        upgradeFrom);
                recipes.add(recipe);
                if (version != null) {
                    byVersion.put(version, recipe);
                }
            }
        }

        // Legacy: derive upgrade_to from upgradePaths when no explicit upgrade_to was given.
        if (!hasExplicitUpgradeTo && !legacyFromByTarget.isEmpty()) {
            for (Map.Entry<String, List<String>> entry : legacyFromByTarget.entrySet()) {
                String target = entry.getKey();
                for (String from : entry.getValue()) {
                    Recipe source = byVersion.get(from);
                    if (source == null) {
                        continue;
                    }
                    if (source.getUpgradeTo() == null) {
                        source.setUpgradeTo(new ArrayList<>());
                    }
                    if (!source.getUpgradeTo().contains(target)) {
                        source.getUpgradeTo().add(target);
                    }
                }
            }
        }

        hr.setRecipes(recipes);
        return hr;
    }

    // ---------- helpers ----------

    public static String normalizeVersion(String version) {
        if (version == null) {
            return null;
        }
        return version.trim().replaceFirst("^[vV]", "");
    }

    static List<String> normalizeVersions(List<String> versions) {
        List<String> out = new ArrayList<>();
        if (versions == null) {
            return out;
        }
        for (String v : versions) {
            String clean = normalizeVersion(v);
            if (clean != null && !clean.isBlank()) {
                out.add(clean);
            }
        }
        return out;
    }

    private static void putIfPresent(Map<String, Object> map, String key, String value) {
        if (value != null && !value.isBlank()) {
            map.put(key, value);
        }
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private static Object firstOf(Map<String, Object> map, String primary, String fallback) {
        Object v = map.get(primary);
        return v != null ? v : map.get(fallback);
    }

    @SuppressWarnings("unchecked")
    private static List<String> readList(Object o) {
        List<String> result = new ArrayList<>();
        if (o instanceof List<?> list) {
            for (Object x : list) {
                if (x != null) {
                    result.add(String.valueOf(x));
                }
            }
        } else if (o instanceof String s && !s.isBlank()) {
            for (String part : s.split(",")) {
                String t = part.trim();
                if (!t.isEmpty()) {
                    result.add(t);
                }
            }
        }
        return result;
    }
}
