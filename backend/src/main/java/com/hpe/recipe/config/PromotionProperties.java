package com.hpe.recipe.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.List;

/**
 * Promotion pipeline order, bound from {@code promotion.pipeline} in application.yml
 * (comma-separated, e.g. {@code dev,qa,integration,prod}).
 *
 * <p>This replaces the previously hardcoded order so the sequence lives in exactly one
 * place and the frontend can fetch it from {@code GET /api/pipeline}.
 */
@Configuration
@ConfigurationProperties(prefix = "promotion")
public class PromotionProperties {

    /** Ordered list of environments; defaults match the historical hardcoded order. */
    private List<String> pipeline = new ArrayList<>(List.of("dev", "qa", "integration", "prod"));

    public List<String> getPipeline() {
        return pipeline;
    }

    public void setPipeline(List<String> pipeline) {
        this.pipeline = pipeline;
    }
}
