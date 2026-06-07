package com.hpe.recipe.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

@Configuration
@ConfigurationProperties(prefix = "kubernetes")
public class KubernetesProperties {

    private Map<String, Cluster> clusters;

    // ✅ Getter
    public Map<String, Cluster> getClusters() {
        return clusters;
    }

    // ✅ Setter
    public void setClusters(Map<String, Cluster> clusters) {
        this.clusters = clusters;
    }

    // Inner class
    public static class Cluster {
        private String context;

        // Getter
        public String getContext() {
            return context;
        }

        // Setter
        public void setContext(String context) {
            this.context = context;
        }
    }
}