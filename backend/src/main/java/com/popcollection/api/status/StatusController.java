package com.popcollection.api.status;

import java.time.Clock;
import java.time.OffsetDateTime;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Endpoint público e simples para o site conferir se a API está no ar. */
@RestController
@RequestMapping("/api/status")
@Tag(name = "Status", description = "Se a API está no ar")
public class StatusController {

    private final String version;
    private final Clock clock;

    public StatusController(ObjectProvider<BuildProperties> build, Clock clock) {
        BuildProperties props = build.getIfAvailable();
        this.version = props != null ? props.getVersion() : "dev";
        this.clock = clock;
    }

    @GetMapping
    @Operation(summary = "Mostra o nome, a versão e o horário do servidor")
    public StatusResponse status() {
        return new StatusResponse("Pop Collection API", version, OffsetDateTime.now(clock));
    }
}
