package com.popcollection.api.config;

import java.time.Clock;
import java.time.ZoneId;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Relógio da API, no fuso de Brasília (America/Sao_Paulo).
 * Ser injetável deixa os testes controlarem o horário.
 */
@Configuration
public class ClockConfig {

    public static final ZoneId FUSO_BRASIL = ZoneId.of("America/Sao_Paulo");

    @Bean
    Clock clock() {
        return Clock.system(FUSO_BRASIL);
    }
}
