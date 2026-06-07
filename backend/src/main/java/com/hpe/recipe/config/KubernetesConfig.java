package com.hpe.recipe.config;

import io.fabric8.kubernetes.client.Config;
import io.fabric8.kubernetes.client.KubernetesClient;
import io.fabric8.kubernetes.client.KubernetesClientBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

@Configuration
public class KubernetesConfig {

    @Bean
    public Map<String, KubernetesClient> kubernetesClients(KubernetesProperties properties) {

        Map<String, KubernetesClient> clients = new HashMap<>();

        properties.getClusters().forEach((name, cluster) -> {

            // 🔥 Automatically reads ~/.kube/config
            Config config = Config.autoConfigure(cluster.getContext());

            KubernetesClient client = new KubernetesClientBuilder()
                    .withConfig(config)
                    .build();

            clients.put(name, client);
        });

        return clients;
    }
}