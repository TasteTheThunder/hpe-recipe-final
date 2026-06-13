package com.hpe.recipe.service;

import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;
import com.hpe.recipe.model.ComponentSpec;
import org.eclipse.jgit.api.Git;
import org.eclipse.jgit.api.errors.GitAPIException;
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

@Service
public class GitOpsService {

    @Value("${gitops.repo-url}")
    private String repoUrl;

    @Value("${gitops.local-path}")
    private String localPath;

    @Value("${gitops.branch}")
    private String branch;

    @Value("${gitops.username}")
    private String username;

    @Value("${gitops.token}")
    private String token;

    @Value("${gitops.values-dir}")
    private String valuesDir;

    /**
     * Generate a Helm values YAML file from a HelmRelease and push it to GitHub.
     * Also updates Chart.yaml version so Jenkins picks up the right version.
     */
    public void generateAndPush(HelmRelease release) throws Exception {
        synchronized (GitSupport.REMOTE_LOCK) {

        System.out.println("Starting GitOps for version: " + release.getVersion());

        File repoDir = new File(localPath);
        Git git = getOrCloneRepo(repoDir);

        try {
            System.out.println("Pulling latest code...");
            git.pull()
                    .setCredentialsProvider(getCredentials())
                    .setRemoteBranchName(branch)
                    .call();

            System.out.println("Generating YAML...");
            String valuesFileName = resolveValuesFileName(release);
            String valuesYaml = generateValuesYaml(release, valuesFileName);
            File valuesFile = new File(repoDir, valuesDir + "/" + valuesFileName);
            writeFile(valuesFile, valuesYaml);

            System.out.println("Updating Chart.yaml...");
            File chartFile = new File(repoDir, valuesDir + "/Chart.yaml");
            updateChartMetadata(chartFile, release.getVersion(), valuesFileName);

            System.out.println("Adding files to git...");
            git.add().addFilepattern(valuesDir + "/" + valuesFileName).call();
            git.add().addFilepattern(valuesDir + "/Chart.yaml").call();

            System.out.println("Committing changes...");
            git.commit()
                    .setMessage("Release v" + release.getVersion())
                    .setAuthor("Recipe Detection", "recipe-detection@hpe.com")
                    .call();

            System.out.println("Pushing to GitHub...");
            var pushResults = git.push()
                    .setCredentialsProvider(getCredentials())
                    .call();
            if (!GitSupport.pushAccepted(pushResults)) {
                throw new IllegalStateException("Git push rejected (remote moved): "
                        + GitSupport.pushFailureDetail(pushResults));
            }

            System.out.println("PUSH SUCCESS");

        } catch (Exception e) {
            System.out.println("GIT ERROR: " + e.getMessage());
            e.printStackTrace();
            throw e;
        } finally {
            git.close();
        }
        }
    }

    private Git getOrCloneRepo(File repoDir) throws GitAPIException {
        if (repoDir.exists() && new File(repoDir, ".git").exists()) {
            try {
                return Git.open(repoDir);
            } catch (IOException e) {
                // Corrupted repo — delete and re-clone
                deleteDirectory(repoDir);
            }
        }

        return Git.cloneRepository()
                .setURI(repoUrl)
                .setDirectory(repoDir)
                .setBranch(branch)
                .setCredentialsProvider(getCredentials())
                .call();
    }

    private UsernamePasswordCredentialsProvider getCredentials() {
        return new UsernamePasswordCredentialsProvider(username, token);
    }

    /**
     * Generate YAML matching the existing values-v*.yaml format:
     *
     * recipeData:
     *   chartVersion: "0.0.4"
     *   recipes:
     *     - version: "1.6.0"
     *       description: "..."
     *       components:
     *         spark: "3.5.0"
    *       upgrade_to:
     *         - "1.5.0"
     */
    public String resolveValuesFileName(HelmRelease release) {
        if (release.getValuesFileName() != null && !release.getValuesFileName().isBlank()) {
            String custom = release.getValuesFileName().trim().replace("\\", "/");
            if (custom.contains("..") || custom.startsWith("/")) {
                throw new IllegalArgumentException("Invalid values file name: " + release.getValuesFileName());
            }
            return custom.endsWith(".yaml") ? custom : custom + ".yaml";
        }
        return "values-v" + release.getVersion() + ".yaml";
    }

    String generateValuesYaml(HelmRelease release, String valuesFileName) {
        DumperOptions options = new DumperOptions();
        options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
        options.setPrettyFlow(true);
        options.setDefaultScalarStyle(DumperOptions.ScalarStyle.PLAIN);
        Yaml yaml = new Yaml(options);

        List<Map<String, Object>> recipeMaps = new ArrayList<>();
        for (Recipe recipe : release.getRecipes()) {
            Map<String, Object> recipeMap = new LinkedHashMap<>();
            recipeMap.put("version", quote(normalizeVersion(recipe.getVersion())));
            recipeMap.put("description", quote(recipe.getDescription()));
            if (recipe.getReleaseDate() != null && !recipe.getReleaseDate().isBlank()) {
                recipeMap.put("release_date", quote(recipe.getReleaseDate()));
            }
            if (recipe.getStatus() != null && !recipe.getStatus().isBlank()) {
                recipeMap.put("status", quote(recipe.getStatus()));
            }
            if (recipe.getReleaseNotes() != null && !recipe.getReleaseNotes().isBlank()) {
                recipeMap.put("release_notes", quote(recipe.getReleaseNotes()));
            }

            Map<String, Object> components = new LinkedHashMap<>();
            if (recipe.getComponents() != null) {
                recipe.getComponents().forEach((name, spec) -> {
                    Map<String, Object> compMap = new LinkedHashMap<>();
                    compMap.put("version", quote(spec.getVersion()));
                    if (spec.getReleaseDate() != null && !spec.getReleaseDate().isBlank()) {
                        compMap.put("release_date", quote(spec.getReleaseDate()));
                    }
                    compMap.put("upgrade_from", quoteAll(spec.getUpgradeFrom()));
                    compMap.put("upgrade_to", quoteAll(spec.getUpgradeTo()));
                    components.put(name, compMap);
                });
            }
            recipeMap.put("components", components);

            List<String> paths = new ArrayList<>();
            if (recipe.getUpgradeTo() != null) {
                recipe.getUpgradeTo().forEach(p -> {
                    String normalized = normalizeVersion(p);
                    if (normalized != null && !normalized.isBlank()) {
                        paths.add(quote(normalized));
                    }
                });
            }
            if (!paths.isEmpty()) {
                recipeMap.put("upgrade_to", paths);
            }
            List<String> pathsFrom = new ArrayList<>();
            if (recipe.getUpgradeFrom() != null) {
                recipe.getUpgradeFrom().forEach(p -> {
                    String normalized = normalizeVersion(p);
                    if (normalized != null && !normalized.isBlank()) {
                        pathsFrom.add(quote(normalized));
                    }
                });
            }
            if (!pathsFrom.isEmpty()) {
                recipeMap.put("upgrade_from", pathsFrom);
            }
            recipeMaps.add(recipeMap);
        }

        Map<String, Object> recipeData = new LinkedHashMap<>();
        recipeData.put("chartVersion", quote(release.getVersion()));
        if (release.getCluster() != null && !release.getCluster().isBlank()) {
            recipeData.put("target_cluster", quote(release.getCluster()));
        }
        if (release.getCatalogName() != null && !release.getCatalogName().isBlank()) {
            recipeData.put("catalog_name", quote(release.getCatalogName()));
        }
        if (release.getCatalogDescription() != null && !release.getCatalogDescription().isBlank()) {
            recipeData.put("catalog_description", quote(release.getCatalogDescription()));
        }
        if (release.getCatalogReleaseDate() != null && !release.getCatalogReleaseDate().isBlank()) {
            recipeData.put("release_date", quote(release.getCatalogReleaseDate()));
        }
        if (release.getCatalogStatus() != null && !release.getCatalogStatus().isBlank()) {
            recipeData.put("catalog_status", quote(release.getCatalogStatus()));
        }
        if (release.getMaintainer() != null && !release.getMaintainer().isBlank()) {
            recipeData.put("maintainer", quote(release.getMaintainer()));
        }
        recipeData.put("values_file", quote(valuesFileName));
        recipeData.put("recipes", recipeMaps);

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("recipeData", recipeData);

        String dumped = yaml.dump(root);
        dumped = dumped.replaceAll("(?s)(upgrade_from|upgrade_to):\\s*\\[\\s*\\]", "$1: []");
        return dumped;
    }

    private String normalizeVersion(String version) {
        if (version == null) return null;
        return version.trim().replaceFirst("^[vV]", "");
    }

    private String quote(String val) {
        // SnakeYAML will auto-quote strings that look like numbers
        // We want explicit quoting for version strings
        return val;
    }

    private List<String> quoteAll(List<String> values) {
        if (values == null) return new ArrayList<>();
        List<String> quoted = new ArrayList<>();
        values.forEach(v -> quoted.add(quote(v)));
        return quoted;
    }

    private void updateChartMetadata(File chartFile, String version, String valuesFileName) throws IOException {
        String content = Files.readString(chartFile.toPath());
        content = content.replaceAll("(?m)^version:\\s*.+", "version: " + version);
        content = content.replaceAll("(?m)^appVersion:\\s*.+", "appVersion: \"" + version + "\"");

        String annotationLine = "  recipe-detection/values-file: " + valuesFileName;
        if (content.contains("recipe-detection/values-file:")) {
            content = content.replaceAll(
                    "(?m)^\\s*recipe-detection/values-file:\\s*\\S+",
                    annotationLine.trim());
        } else if (content.contains("annotations:")) {
            content = content.replaceFirst("annotations:", "annotations:\n" + annotationLine);
        } else {
            content = content.trim() + "\nannotations:\n" + annotationLine + "\n";
        }

        writeFile(chartFile, content);
    }

    private void writeFile(File file, String content) throws IOException {
        file.getParentFile().mkdirs();
        try (FileWriter writer = new FileWriter(file)) {
            writer.write(content);
        }
    }

    private void deleteDirectory(File dir) {
        if (dir.isDirectory()) {
            File[] children = dir.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteDirectory(child);
                }
            }
        }
        dir.delete();
    }
}
