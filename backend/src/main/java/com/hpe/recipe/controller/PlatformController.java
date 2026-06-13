package com.hpe.recipe.controller;

import com.hpe.recipe.config.PromotionProperties;
import com.hpe.recipe.service.GitStateService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * Read-only platform-state endpoints backed by Git (the source of truth) and the
 * configured promotion order. Context path is /api, so these resolve to
 * /api/pipeline, /api/environments, /api/versions, /api/history.
 */
@RestController
public class PlatformController {

    private final PromotionProperties promotionProperties;
    private final GitStateService gitStateService;

    public PlatformController(PromotionProperties promotionProperties, GitStateService gitStateService) {
        this.promotionProperties = promotionProperties;
        this.gitStateService = gitStateService;
    }

    /** Configured promotion order (e.g. [dev, qa, integration, prod]). */
    @GetMapping("/pipeline")
    public List<String> pipeline() {
        return promotionProperties.getPipeline();
    }

    /** Current catalog version per environment, read from Git env files. */
    @GetMapping("/environments")
    public Map<String, String> environments() {
        return gitStateService.readAllEnvironments();
    }

    /** All catalog version ids that exist in Git. */
    @GetMapping("/versions")
    public List<String> versions() {
        return gitStateService.listVersions();
    }

    /** Append-only deployment event log. */
    @GetMapping("/history")
    public List<Map<String, Object>> history() {
        return gitStateService.readHistory();
    }
}
