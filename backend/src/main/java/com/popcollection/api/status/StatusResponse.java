package com.popcollection.api.status;

import java.time.Instant;

/** Resposta do GET /api/status. */
public record StatusResponse(String app, String versao, Instant horario) {
}
