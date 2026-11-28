package com.popcollection.api.finance;

import java.math.BigDecimal;
import java.util.List;

/**
 * Resposta do GET /api/financeiro/resumo. Valores em reais.
 *
 * @param cards           cards de compra, mais os de coleções apagadas
 * @param comprasEmAberto compras com algo a pagar (aba Pagamento)
 * @param comprasQuitadas compras pagas (a caminho ou já chegaram)
 * @param presentes       cards ganhos de presente, fora da conta por categoria
 * @param porMes          um item por mês com compra, do mais antigo ao mais novo
 * @param porCategoria    só categorias com valor, do maior para o menor (sem Presente)
 */
public record FinanceiroResumo(
        BigDecimal totalInvestido,
        BigDecimal jaPago,
        BigDecimal faltaPagar,
        BigDecimal emPhotocards,
        BigDecimal emFretes,
        BigDecimal emTaxas,
        int cards,
        int comprasEmAberto,
        int comprasQuitadas,
        int presentes,
        Arquivado arquivado,
        List<Mes> porMes,
        List<PorCategoria> porCategoria) {

    /** Coleções apagadas: o valor continua contando no total. */
    public record Arquivado(BigDecimal total, int cards) {
    }

    /** @param mes no formato 2026-11 */
    public record Mes(String mes, BigDecimal valor) {
    }

    public record PorCategoria(String categoria, String nome, BigDecimal valor, int cards) {
    }
}
