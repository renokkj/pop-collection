package com.popcollection.api.auth;

import java.util.UUID;

import org.springframework.security.oauth2.jwt.Jwt;

/** Quem está fazendo a chamada, tirado do token de login. O dono dos dados vem sempre daqui. */
public record UsuarioLogado(UUID id, String email) {

    public static UsuarioLogado de(Jwt jwt) {
        return new UsuarioLogado(UUID.fromString(jwt.getSubject()), jwt.getClaimAsString("email"));
    }
}
