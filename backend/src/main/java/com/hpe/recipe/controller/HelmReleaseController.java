package com.hpe.recipe.controller;

import com.hpe.recipe.config.ReleaseWebSocketHandler;
import com.hpe.recipe.model.ComponentSpec;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;
import com.hpe.recipe.service.GitOpsService;
import com.hpe.recipe.service.HelmReleaseService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.*;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/helm-releases")
public class HelmReleaseController {
    private static final Logger log = LoggerFactory.getLogger(HelmReleaseController.class);

    @Value("${jenkins.username}")
    private String jenkinsUser;

    @Value("${jenkins.token}")
    private String jenkinsToken;

    @Value("${jenkins.url}")
    private String jenkinsUrl;

    @Value("${jenkins.job}")
    private String jenkinsJob;

    private final HelmReleaseService helmReleaseService;
    private final ReleaseWebSocketHandler wsHandler;
    private final GitOpsService gitOpsService;

    public HelmReleaseController(HelmReleaseService helmReleaseService,
                                 ReleaseWebSocketHandler wsHandler,
                                 GitOpsService gitOpsService) {
        this.helmReleaseService = helmReleaseService;
        this.wsHandler = wsHandler;
        this.gitOpsService = gitOpsService;
    }

  
    @GetMapping
    public List<Map<String, String>> getAllHelmReleases(@RequestParam String cluster) {

        List<Map<String, String>> lightweight = new ArrayList<>();

        for (HelmRelease release : helmReleaseService.getAllHelmReleases(cluster)) {

            Map<String, String> summary = new LinkedHashMap<>();
            summary.put("version", release.getVersion());
            summary.put("releaseName", release.getReleaseName());
            summary.put("status", release.getStatus());
            summary.put("cluster", cluster);
            if (release.getCatalogName() != null && !release.getCatalogName().isBlank()) {
                summary.put("catalog_name", release.getCatalogName());
            }
            if (release.getCatalogStatus() != null && !release.getCatalogStatus().isBlank()) {
                summary.put("catalog_status", release.getCatalogStatus());
            }

            lightweight.add(summary);
        }

        return lightweight;
    }

    
    @GetMapping("/{version}")
    public ResponseEntity<HelmRelease> getHelmRelease(
            @PathVariable String version,
            @RequestParam String cluster) {

        HelmRelease release = helmReleaseService.getHelmRelease(cluster, version);

        if (release == null) return ResponseEntity.notFound().build();

        release.setCluster(cluster); // 🔥 attach cluster info

        return ResponseEntity.ok(release);
    }

   
    @PostMapping
    public ResponseEntity<HelmRelease> createHelmRelease(
            @RequestParam String cluster,
            @RequestBody HelmRelease release) {
        HelmRelease created = helmReleaseService.createHelmRelease(cluster, release);

        if (created == null) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }

        created.setCluster(cluster);

        wsHandler.broadcast("release_created", created);

        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

   
    @PutMapping("/{version}")
    public ResponseEntity<HelmRelease> updateHelmRelease(
            @PathVariable String version,
            @RequestParam String cluster,
            @RequestBody HelmRelease release) {
        HelmRelease updated = helmReleaseService.updateHelmRelease(cluster, version, release);

        if (updated == null) return ResponseEntity.notFound().build();

        updated.setCluster(cluster);

        wsHandler.broadcast("release_updated", updated);

        return ResponseEntity.ok(updated);
    }

    
    @PutMapping("/{version}/status")
    public ResponseEntity<HelmRelease> updateStatus(
            @PathVariable String version,
            @RequestParam String cluster,
            @RequestBody Map<String, String> body) {

        String status = body.get("status");

        if (status == null || status.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        HelmRelease release = helmReleaseService.getHelmRelease(cluster, version);

        if (release == null) return ResponseEntity.notFound().build();

        release.setStatus(status);
        helmReleaseService.updateHelmRelease(cluster, version, release);

        if ("deployed".equalsIgnoreCase(status)) {
            helmReleaseService.cleanupDraftConfigMapsIfHelmExists(cluster, version);
            helmReleaseService.cleanupDraftReleaseIfHelmExists(cluster, version);
        }

        wsHandler.broadcast("status_changed",
                Map.of("version", version, "status", status, "cluster", cluster));

        return ResponseEntity.ok(release);
    }

  
    @PostMapping("/{version}/deploy")
    public ResponseEntity<?> deployRelease(
            @PathVariable String version,
            @RequestParam String cluster) {

        HelmRelease release = helmReleaseService.getHelmRelease(cluster, version);

        if (release == null) return ResponseEntity.notFound().build();

        if (release.getRecipes() == null || release.getRecipes().isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "Cannot deploy release with no recipes"));
        }

        release.setCluster(cluster);
        release.setStatus("deploying");
        helmReleaseService.updateHelmRelease(cluster, version, release);

        wsHandler.broadcast("status_changed",
                Map.of("version", version, "status", "deploying", "cluster", cluster));

        try {
            String valuesFileName = gitOpsService.resolveValuesFileName(release);
            gitOpsService.generateAndPush(release);
            triggerJenkins(cluster, "deploy", release.getVersion(), valuesFileName);

            return ResponseEntity.ok(Map.of(
                    "message", "Pushed to Git. Jenkins will deploy shortly.",
                    "version", version,
                    "cluster", cluster
            ));

        } catch (Exception e) {

            release.setStatus("push_failed");
            helmReleaseService.updateHelmRelease(cluster, version, release);

            wsHandler.broadcast("status_changed",
                    Map.of("version", version, "status", "push_failed", "cluster", cluster));

            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

   
    @DeleteMapping("/{version}")
    public ResponseEntity<Void> deleteHelmRelease(
            @PathVariable String version,
            @RequestParam String cluster) {

        boolean deleted = helmReleaseService.deleteHelmRelease(cluster, version);

        if (!deleted) return ResponseEntity.notFound().build();

        wsHandler.broadcast("release_deleted",
                Map.of("version", version, "cluster", cluster));

        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{version}/recipes")
    public List<Recipe> getRecipes(
            @PathVariable String version,
            @RequestParam String cluster) {

        return helmReleaseService.getRecipesByHelmVersion(cluster, version);
    }

    @PostMapping("/{version}/recipes")
    public ResponseEntity<Recipe> addRecipe(
            @PathVariable String version,
            @RequestParam String cluster,
            @RequestBody Recipe recipe) {
        Recipe added = helmReleaseService.addRecipeToRelease(cluster, version, recipe);

        if (added == null) return ResponseEntity.status(HttpStatus.CONFLICT).build();

        wsHandler.broadcast("recipe_added",
                Map.of("helmVersion", version, "cluster", cluster, "recipe", added));

        return ResponseEntity.status(HttpStatus.CREATED).body(added);
    }

    @PutMapping("/{version}/recipes/{recipeVersion}")
    public ResponseEntity<Recipe> updateRecipe(
            @PathVariable String version,
            @PathVariable String recipeVersion,
            @RequestParam String cluster,
            @RequestBody Recipe recipe) {
        Recipe updated = helmReleaseService.updateRecipeInRelease(cluster, version, recipeVersion, recipe);

        if (updated == null) return ResponseEntity.notFound().build();

        wsHandler.broadcast("recipe_updated",
                Map.of("helmVersion", version, "cluster", cluster, "recipe", updated));

        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/{version}/recipes/{recipeVersion}")
    public ResponseEntity<Void> deleteRecipe(
            @PathVariable String version,
            @PathVariable String recipeVersion,
            @RequestParam String cluster) {

        boolean deleted = helmReleaseService.deleteRecipeFromRelease(cluster, version, recipeVersion);

        if (!deleted) return ResponseEntity.notFound().build();

        wsHandler.broadcast("recipe_deleted",
                Map.of("helmVersion", version, "cluster", cluster, "recipeVersion", recipeVersion));

        return ResponseEntity.noContent().build();
    }

   
    @GetMapping("/{version}/recipes/{recipeVersion}/components")
    public Map<String, ComponentSpec> getComponents(
            @PathVariable String version,
            @PathVariable String recipeVersion,
            @RequestParam String cluster) {

        return helmReleaseService.getComponentsByRecipe(cluster, version, recipeVersion);
    }

    
    @GetMapping("/{version}/recipes/{recipeVersion}/upgradePaths")
    public List<String> getUpgradePaths(
            @PathVariable String version,
            @PathVariable String recipeVersion,
            @RequestParam String cluster) {

        return helmReleaseService.getUpgradePaths(cluster, version, recipeVersion);
    }

   
    @GetMapping("/compare")
    public Map<String, Object> compareHelmVersions(
            @RequestParam String cluster,
            @RequestParam String from,
            @RequestParam String to) {

        return helmReleaseService.getUpgradePathsBetweenHelmVersions(cluster, from, to);
    }

    @GetMapping("/{version}/deploy-preview")
    public ResponseEntity<Map<String, Object>> deployPreview(
            @PathVariable String version,
            @RequestParam String cluster,
            @RequestParam(defaultValue = "auto") String baseline) {

        Map<String, Object> preview = helmReleaseService.getDeployPreview(cluster, version, baseline);
        if (preview.containsKey("error")) {
            return ResponseEntity.badRequest().body(preview);
        }
        return ResponseEntity.ok(preview);
    }

    private void triggerJenkins(String cluster, String action, String chartVersion, String valuesFile) {

        if (!StringUtils.hasText(jenkinsUser) || !StringUtils.hasText(jenkinsToken)) {
            throw new IllegalStateException("Jenkins credentials are not configured (JENKINS_USER/JENKINS_TOKEN)");
        }

        try {
            RestTemplate restTemplate = new RestTemplate();

            String auth = jenkinsUser + ":" + jenkinsToken;
            String encodedAuth = Base64.getEncoder().encodeToString(auth.getBytes());

            
            String crumbUrl = jenkinsUrl + "/crumbIssuer/api/json";

            HttpHeaders crumbHeaders = new HttpHeaders();
            crumbHeaders.set("Authorization", "Basic " + encodedAuth);

            HttpEntity<String> crumbRequest = new HttpEntity<>(crumbHeaders);

            ResponseEntity<Map> crumbResponse = restTemplate.exchange(
                    crumbUrl,
                    HttpMethod.GET,
                    crumbRequest,
                    Map.class
            );

            String crumb = (String) crumbResponse.getBody().get("crumb");
            String crumbField = (String) crumbResponse.getBody().get("crumbRequestField");

            log.info("Fetched Jenkins crumb");

            
            UriComponentsBuilder urlBuilder = UriComponentsBuilder
                    .fromHttpUrl(jenkinsUrl)
                    .pathSegment("job", jenkinsJob, "buildWithParameters")
                    .queryParam("CLUSTER", cluster)
                    .queryParam("ACTION", action)
                    .queryParam("ALLOW_DEPLOY", "yes");

            if (StringUtils.hasText(chartVersion)) {
                urlBuilder.queryParam("CHART_VERSION", chartVersion);
            }
            if (StringUtils.hasText(valuesFile)) {
                urlBuilder.queryParam("VALUES_FILE", valuesFile);
            }

            String url = urlBuilder.toUriString();

            log.info("Triggering Jenkins URL: {}", url);

            
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Basic " + encodedAuth);
            headers.set(crumbField, crumb);

            HttpEntity<String> request = new HttpEntity<>(headers);

          
            ResponseEntity<String> response = restTemplate.exchange(
                    url,
                    HttpMethod.POST,
                    request,
                    String.class
            );

            if (!(response.getStatusCode().is2xxSuccessful() || response.getStatusCode().is3xxRedirection())) {
                log.error("Jenkins trigger failed: {}", response.getBody());
                throw new RuntimeException("Jenkins trigger failed: " + response.getStatusCode());
            }

            log.info("Jenkins triggered for cluster={} status={}", cluster, response.getStatusCodeValue());

        } catch (Exception e) {
            log.error("Error triggering Jenkins", e);
            throw new RuntimeException("Failed to trigger Jenkins", e);
        }
    }
}