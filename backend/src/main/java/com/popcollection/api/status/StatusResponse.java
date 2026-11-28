package com.popcollection.api.status;

import java.time.OffsetDateTime;

/** Resposta do GET /api/status. O horário vem no fuso de Brasília (-03:00). */
public record StatusResponse(String app, String versao, OffsetDateTime horario) {
}
