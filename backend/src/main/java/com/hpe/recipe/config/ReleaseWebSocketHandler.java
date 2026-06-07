package com.hpe.recipe.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArraySet;

@Component
public class ReleaseWebSocketHandler extends TextWebSocketHandler {

    private final CopyOnWriteArraySet<WebSocketSession> sessions = new CopyOnWriteArraySet<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.add(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session);
    }

    /**
     * Broadcast an event to all connected clients.
     * Events: release_created, release_updated, release_deleted,
     *         recipe_added, recipe_updated, recipe_deleted,
     *         status_changed
     */
    public void broadcast(String event, Object data) {
        try {
            String json = objectMapper.writeValueAsString(Map.of(
                    "event", event,
                    "data", data,
                    "timestamp", System.currentTimeMillis()
            ));
            TextMessage message = new TextMessage(json);
            for (WebSocketSession session : sessions) {
                if (session.isOpen()) {
                    try {
                        session.sendMessage(message);
                    } catch (IOException e) {
                        sessions.remove(session);
                    }
                }
            }
        } catch (Exception e) {
            // log and continue
        }
    }
}
