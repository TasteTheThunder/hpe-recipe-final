package com.hpe.recipe.controller;

import com.hpe.recipe.config.ReleaseWebSocketHandler;
import com.hpe.recipe.model.HelmRelease;
import com.hpe.recipe.service.CatalogPlatformService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

@RestController
@CrossOrigin(origins = "*")
public class PlatformController {

    private final CatalogPlatformService platform;
    private final ReleaseWebSocketHandler wsHandler;

    public PlatformController(CatalogPlatformService platform, ReleaseWebSocketHandler wsHandler) {
        this.platform = platform;
        this.wsHandler = wsHandler;
    }

    @GetMapping("/pipeline")
    public List<String> pipeline() {
        return platform.pipeline();
    }

    @GetMapping("/environments")
    public Map<String, String> environments() {
        return platform.environments();
    }

    @GetMapping("/versions")
    public List<String> versions() {
        return platform.versions();
    }

    @GetMapping("/versions/{version}")
    public ResponseEntity<HelmRelease> version(@PathVariable String version) {
        HelmRelease release = platform.version(version);
        return release == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(release);
    }

    @GetMapping("/versions/{version}/promotion-options")
    public Map<String, Object> promotionOptions(@PathVariable String version) {
        return platform.promotionOptions(version);
    }

    @GetMapping("/history")
    public List<Map<String, Object>> history() {
        return platform.history();
    }

    @DeleteMapping("/history")
    public ResponseEntity<?> clearHistory() {
        return execute(() -> {
            platform.clearHistory();
            return Map.of("message", "Deployment history cleared");
        });
    }


    @PostMapping("/versions")
    public ResponseEntity<?> create(@RequestBody HelmRelease release,
                                    @RequestParam(defaultValue = "false") boolean deployToDev) {
        try {
            HelmRelease created = deployToDev
                    ? platform.createAndDeployToDev(release)
                    : platform.createVersion(release);
            wsHandler.broadcast("version_created", Map.of("version", created.getVersion()));
            if (deployToDev) {
                String dev = platform.pipeline().get(0);
                broadcastDeploying(created.getVersion(), dev);
            }
            return ResponseEntity.status(HttpStatus.CREATED).body(created);
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/versions/{version}/deploy")
    public ResponseEntity<?> deployToDev(@PathVariable String version) {
        return execute(() -> {
            platform.deployToDev(version);
            String dev = platform.pipeline().get(0);
            broadcastDeploying(version, dev);
            return Map.of("message", "Deploying " + version + " to " + dev, "version", version, "env", dev);
        });
    }

    @PostMapping("/versions/{version}/promote")
    public ResponseEntity<?> promote(@PathVariable String version, @RequestParam String to) {
        return execute(() -> {
            platform.promote(version, to);
            broadcastDeploying(version, to);
            return Map.of("message", "Promoting " + version + " to " + to, "version", version, "env", to);
        });
    }

    @PostMapping("/environments/{env}/rollback")
    public ResponseEntity<?> rollback(@PathVariable String env) {
        return execute(() -> {
            String targetVersion = platform.rollback(env);
            broadcastDeploying(targetVersion, env);
            return Map.of("message", "Rolling back " + env, "version", targetVersion, "env", env);
        });
    }

    @DeleteMapping("/versions/{version}")
    public ResponseEntity<?> deleteVersion(@PathVariable String version) {
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

    @PostMapping("/catalog/edit")
    public ResponseEntity<?> editDev(@RequestBody HelmRelease edited) {
        try {
            HelmRelease forked = platform.editDev(edited);
            String dev = platform.pipeline().get(0);
            wsHandler.broadcast("version_created", Map.of("version", forked.getVersion()));
            broadcastDeploying(forked.getVersion(), dev);
            return ResponseEntity.status(HttpStatus.CREATED).body(forked);
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    private ResponseEntity<?> execute(Supplier<Object> action) {
        try {
            return ResponseEntity.ok(action.get());
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    private void broadcastDeploying(String version, String env) {
        wsHandler.broadcast("status_changed",
                Map.of("version", version == null ? "" : version, "status", "deploying", "cluster", env));
    }
}
