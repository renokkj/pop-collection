package com.popcollection.api.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Endereços do site que podem chamar a API pelo navegador.
 * Vem de {@code pop.cors.allowed-origins} no application.yml
 * (ou da variável de ambiente POP_CORS_ALLOWED_ORIGINS na hospedagem).
 */
@ConfigurationProperties(prefix = "pop.cors")
public record CorsProperties(List<String> allowedOrigins) {

    public CorsProperties {
        allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
    }
}
