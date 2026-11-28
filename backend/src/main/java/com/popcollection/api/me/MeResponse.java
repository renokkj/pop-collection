package com.popcollection.api.me;

import java.util.UUID;

/**
 * Resposta do GET /api/me.
 *
 * @param perfil {@code null} quando a conta ainda não criou o perfil
 */
public record MeResponse(UUID id, String email, Perfil perfil) {

    public record Perfil(String username, String nome, String fotoPath) {
    }
}
