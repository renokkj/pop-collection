package com.popcollection.api.finance;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Um card de compra, do jeito que o Financeiro precisa.
 *
 * @param fretes    os fretes e a taxa do próprio card; só contam quando ele não está num grupo
 * @param grupoId   grupo da compra, ou {@code null}
 * @param data      data da compra (define o mês)
 */
public record CompraCard(
        BigDecimal preco,
        boolean precoPago,
        boolean presente,
        boolean chegou,
        LocalDate data,
        Fretes fretes,
        UUID grupoId) {
}
