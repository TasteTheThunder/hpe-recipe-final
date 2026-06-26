package com.hpe.recipe.controller;

import com.hpe.recipe.config.ReleaseWebSocketHandler;
import com.hpe.recipe.model.ComponentSpec;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.model.Recipe;
import com.hpe.recipe.service.CatalogPlatformService;
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
    private final CatalogPlatformService platform;

    public HelmReleaseController(HelmReleaseService helmReleaseService,
                                 ReleaseWebSocketHandler wsHandler,
                                 GitOpsService gitOpsService,
                                 CatalogPlatformService platform) {
        this.helmReleaseService = helmReleaseService;
        this.wsHandler = wsHandler;
        this.gitOpsService = gitOpsService;
        this.platform = platform;
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
    public ResponseEntity<?> updateStatus(
            @PathVariable String version,
            @RequestParam String cluster,
            @RequestBody Map<String, String> body) {

        String status = body.get("status");

        if (status == null || status.isEmpty()) {
            return ResponseEntity.badRequest().build();
        }

        if ("deployed".equalsIgnoreCase(status)) {
            String eventAction = firstNonBlank(body.get("eventAction"), body.get("action"));
            platform.completeDeployment(version, cluster, eventAction, body.get("fromVersion"));
        }

        wsHandler.broadcast("status_changed",
                Map.of("version", version, "status", status, "cluster", cluster));

        return ResponseEntity.ok(Map.of("version", version, "status", status, "cluster", cluster));
    }

    private static String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }

  
    @PostMapping("/{version}/deploy")
    public ResponseEntity<?> deployRelease(
            @PathVariable String version,
            @RequestParam String cluster) {

        try {
            // Git is the source of truth: route the legacy deploy to the Git-backed platform,
            // which triggers Jenkins now and records env state/history only after Jenkins reports
            // a successful Helm deploy.
            String first = platform.pipeline().get(0);
            if (cluster.equals(first)) {
                platform.deployToDev(version);
            } else {
                platform.promote(version, cluster);
            }

            wsHandler.broadcast("status_changed",
                    Map.of("version", version, "status", "deploying", "cluster", cluster));

            return ResponseEntity.ok(Map.of(
                    "message", "Deployment triggered. Git environment state will update after Jenkins succeeds.",
                    "version", version,
                    "cluster", cluster
            ));

        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            wsHandler.broadcast("status_changed",
                    Map.of("version", version, "status", "push_failed", "cluster", cluster));
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("error", e.getMessage()));
        }
    }

   
    @DeleteMapping("/{version}")
    public ResponseEntity<?> deleteHelmRelease(
            @PathVariable String version,
            @RequestParam(required = false) String cluster) {
        // Git-backed coherent delete: helm-uninstall from every env running this version,
        // clear pointers/history, and remove the version file (cluster param kept for the
        // legacy route but ignored — delete is global). Same logic as DELETE /api/versions/{v}.
        try {
            platform.deleteVersion(version);
            wsHandler.broadcast("release_deleted", Map.of("version", version));
            return ResponseEntity.noContent().build();
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
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

    @GetMapping("/{version}/promotion-options")
    public ResponseEntity<Map<String, Object>> promotionOptions(@PathVariable String version) {
        return ResponseEntity.ok(helmReleaseService.getPromotionOptions(version));
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
