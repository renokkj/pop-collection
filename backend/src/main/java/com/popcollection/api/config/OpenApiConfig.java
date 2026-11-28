package com.popcollection.api.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Título, descrição e o botão "Authorize" (token de login) do Swagger UI. */
@Configuration
public class OpenApiConfig {

    private static final String LOGIN = "login-supabase";

    @Bean
    OpenAPI popCollectionOpenApi(ObjectProvider<BuildProperties> build) {
        BuildProperties props = build.getIfAvailable();
        String version = props != null ? props.getVersion() : "dev";
        return new OpenAPI()
                .info(new Info()
                        .title("Pop Collection API")
                        .version(version)
                        .description("API do Pop Collection, o app para organizar a coleção de photocards de K-pop.")
                        .license(new License().name("MIT")
                                .url("https://github.com/renokkj/pop-collection/blob/main/LICENSE")))
                .components(new Components().addSecuritySchemes(LOGIN, new SecurityScheme()
                        .type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")
                        .description("Token de login do Supabase (access_token da sessão).")))
                .addSecurityItem(new SecurityRequirement().addList(LOGIN));
    }
}
