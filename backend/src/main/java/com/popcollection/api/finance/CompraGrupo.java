package com.popcollection.api.finance;

import java.time.LocalDate;
import java.util.UUID;

/** Um grupo de compra: os fretes e a taxa dele contam uma vez só, no mês em que foi criado. */
public record CompraGrupo(UUID id, Fretes fretes, LocalDate criadoEm) {
}
