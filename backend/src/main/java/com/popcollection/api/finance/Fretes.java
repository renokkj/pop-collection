package com.popcollection.api.finance;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * Fretes e taxa de uma compra (de um card sem grupo ou de um grupo), cada um com o seu "pago".
 * <ul>
 *   <li>Individual Nacional: só o frete até você.</li>
 *   <li>Individual Internacional: frete até a GOM, taxa de importação (se houver) e frete até você.</li>
 *   <li>CEG Nacional: frete da seller até a GOM (a sua parte) e frete até você.</li>
 *   <li>CEG Internacional: frete até a GOM e taxa (as suas partes) e frete até você.</li>
 * </ul>
 */
public record Fretes(
        String tipo,
        String origem,
        BigDecimal freteAteVoce,
        BigDecimal freteAteGom,
        BigDecimal taxaImportacao,
        boolean freteAteVocePago,
        boolean freteAteGomPago,
        boolean taxaPaga) {

    /** Um valor a pagar: frete ou taxa. */
    public record Parte(boolean taxa, BigDecimal valor, boolean pago) {
    }

    public Categoria categoria() {
        return Categoria.de(tipo, origem);
    }

    /** As partes que contam nesta categoria. */
    public List<Parte> partes() {
        boolean ceg = "ceg".equals(tipo);
        boolean internacional = "internacional".equals(origem);
        List<Parte> partes = new ArrayList<>(3);
        if (ceg || internacional) {
            partes.add(new Parte(false, valor(freteAteGom), freteAteGomPago));
        }
        if (internacional && valor(taxaImportacao).signum() > 0) {
            partes.add(new Parte(true, valor(taxaImportacao), taxaPaga));
        }
        partes.add(new Parte(false, valor(freteAteVoce), freteAteVocePago));
        return partes;
    }

    public BigDecimal total() {
        return Dinheiro.soma(partes().stream().map(Parte::valor));
    }

    public BigDecimal devido() {
        return Dinheiro.soma(partes().stream().filter(p -> !p.pago()).map(Parte::valor));
    }

    public BigDecimal totalFretes() {
        return Dinheiro.soma(partes().stream().filter(p -> !p.taxa()).map(Parte::valor));
    }

    public BigDecimal totalTaxas() {
        return Dinheiro.soma(partes().stream().filter(Parte::taxa).map(Parte::valor));
    }

    public boolean quitado() {
        return partes().stream().allMatch(Parte::pago);
    }

    private static BigDecimal valor(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }
}
