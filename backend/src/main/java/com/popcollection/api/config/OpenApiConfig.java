package com.popcollection.api.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;

import org.springframework.boot.info.BuildProperties;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Título e descrição que aparecem no Swagger UI. */
@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI popCollectionOpenApi(ObjectProvider<BuildProperties> build) {
        String version = build.getIfAvailable() != null ? build.getIfAvailable().getVersion() : "dev";
        return new OpenAPI().info(new Info()
                .title("Pop Collection API")
                .version(version)
                .description("API do Pop Collection, o app para organizar a coleção de photocards de K-pop.")
                .license(new License().name("MIT").url("https://github.com/renokkj/pop-collection/blob/main/LICENSE")));
    }
}
