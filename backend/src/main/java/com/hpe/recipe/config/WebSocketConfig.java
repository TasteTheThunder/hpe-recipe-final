package com.hpe.recipe.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final ReleaseWebSocketHandler releaseWebSocketHandler;

    public WebSocketConfig(ReleaseWebSocketHandler releaseWebSocketHandler) {
        this.releaseWebSocketHandler = releaseWebSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(releaseWebSocketHandler, "/ws/releases")
                .setAllowedOrigins("*");
    }
}
