package com.popcollection.api.finance;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import com.popcollection.api.finance.FinanceiroResumo.Arquivado;
import com.popcollection.api.finance.FinanceiroResumo.Mes;
import com.popcollection.api.finance.FinanceiroResumo.PorCategoria;

class CalculadoraFinanceiraTest {

    static final Arquivado NADA_ARQUIVADO = new Arquivado(null, 0);
    static final LocalDate NOV = LocalDate.of(2026, 11, 10);
    static final LocalDate OUT = LocalDate.of(2026, 10, 3);

    @Nested
    class CategoriasDeCompra {

        @Test
        void individualNacionalTemSoOFreteAteVoce() {
            // o frete até a GOM guardado não conta nesta categoria
            Fretes f = fretes("individual", "nacional", "15", "99", "99");
            assertThat(f.total()).isEqualByComparingTo("15");
            assertThat(f.totalTaxas()).isEqualByComparingTo("0");
        }

        @Test
        void individualInternacionalTemFreteAteAGomTaxaEFreteAteVoce() {
            Fretes f = fretes("individual", "internacional", "15", "20", "8.50");
            assertThat(f.total()).isEqualByComparingTo("43.50");
            assertThat(f.totalFretes()).isEqualByComparingTo("35");
            assertThat(f.totalTaxas()).isEqualByComparingTo("8.50");
        }

        @Test
        void cegNacionalTemFreteAteAGomSemTaxa() {
            Fretes f = fretes("ceg", "nacional", "15", "4", "10");
            assertThat(f.total()).isEqualByComparingTo("19");
            assertThat(f.categoria()).isEqualTo(Categoria.CEG_NACIONAL);
        }

        @Test
        void taxaZeradaNaoEntraNasPartes() {
            Fretes f = fretes("ceg", "internacional", "15", "4", "0");
            assertThat(f.partes()).hasSize(2);
            assertThat(f.categoria()).isEqualTo(Categoria.CEG_INTERNACIONAL);
        }

        @Test
        void devidoSomaSoOQueNaoFoiPago() {
            Fretes f = new Fretes("individual", "internacional", bd("15"), bd("20"), bd("5"), true, false, false);
            assertThat(f.devido()).isEqualByComparingTo("25");
            assertThat(f.quitado()).isFalse();
        }
    }

    @Test
    void semComprasTudoZerado() {
        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(), List.of(), NADA_ARQUIVADO);
        assertThat(r.totalInvestido()).isEqualByComparingTo("0");
        assertThat(r.porMes()).isEmpty();
        assertThat(r.porCategoria()).isEmpty();
        assertThat(r.cards()).isZero();
    }

    @Test
    void cardSemGrupoContaPrecoEFretes() {
        CompraCard card = card("30", false, NOV, fretes("individual", "nacional", "12", "0", "0"), null);

        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(card), List.of(), NADA_ARQUIVADO);

        assertThat(r.totalInvestido()).isEqualByComparingTo("42");
        assertThat(r.emPhotocards()).isEqualByComparingTo("30");
        assertThat(r.emFretes()).isEqualByComparingTo("12");
        assertThat(r.faltaPagar()).isEqualByComparingTo("42");
        assertThat(r.jaPago()).isEqualByComparingTo("0");
        assertThat(r.comprasEmAberto()).isEqualTo(1);
    }

    @Test
    void freteDoGrupoContaUmaVezSoEOsFretesDoCardFicamDeFora() {
        UUID g = UUID.randomUUID();
        // os fretes guardados nos cards (50) não contam: eles estão num grupo
        CompraCard a = card("30", true, NOV, fretes("individual", "nacional", "50", "0", "0"), g);
        CompraCard b = card("25", true, NOV, fretes("individual", "nacional", "50", "0", "0"), g);
        CompraGrupo grupo = new CompraGrupo(g, new Fretes("individual", "internacional", bd("10"), bd("20"), bd("6"), true, true, false), OUT);

        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(a, b), List.of(grupo), NADA_ARQUIVADO);

        assertThat(r.totalInvestido()).isEqualByComparingTo("91"); // 30 + 25 + 10 + 20 + 6
        assertThat(r.emFretes()).isEqualByComparingTo("30");
        assertThat(r.emTaxas()).isEqualByComparingTo("6");
        assertThat(r.faltaPagar()).isEqualByComparingTo("6"); // só a taxa do grupo
        assertThat(r.comprasEmAberto()).isEqualTo(2); // a taxa do grupo segura os dois cards
        assertThat(r.porCategoria()).containsExactly(new PorCategoria("individual-internacional", "Individual Internacional", bd("91.00"), 2));
        // os cards entram no mês da compra; os fretes do grupo, no mês em que o grupo foi criado
        assertThat(r.porMes()).containsExactly(new Mes("2026-10", bd("36.00")), new Mes("2026-11", bd("55.00")));
    }

    @Test
    void situacaoDasCompras() {
        Fretes pago = new Fretes("individual", "nacional", bd("10"), bd("0"), bd("0"), true, false, false);
        CompraCard quitado = new CompraCard(bd("20"), true, false, false, NOV, pago, null);
        CompraCard chegou = new CompraCard(bd("20"), false, false, true, NOV, pago, null);
        CompraCard presente = new CompraCard(bd("0"), false, true, false, NOV, fretes("individual", "nacional", "0", "0", "0"), null);
        CompraCard aberto = new CompraCard(bd("20"), false, false, false, NOV, pago, null);

        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(quitado, chegou, presente, aberto), List.of(), NADA_ARQUIVADO);

        assertThat(r.comprasQuitadas()).isEqualTo(3);
        assertThat(r.comprasEmAberto()).isEqualTo(1);
        assertThat(r.presentes()).isEqualTo(1);
        assertThat(r.porCategoria()).extracting(PorCategoria::categoria).doesNotContain("gift");
    }

    @Test
    void colecoesApagadasContamNoTotal() {
        CompraCard card = card("10", true, NOV, new Fretes("individual", "nacional", bd("5"), null, null, true, false, false), null);

        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(card), List.of(), new Arquivado(bd("100"), 4));

        assertThat(r.totalInvestido()).isEqualByComparingTo("115");
        assertThat(r.jaPago()).isEqualByComparingTo("115");
        assertThat(r.cards()).isEqualTo(5);
        assertThat(r.arquivado().total()).isEqualByComparingTo("100");
    }

    @Test
    void categoriasDoMaiorParaOMenor() {
        CompraCard barato = card("10", false, NOV, fretes("individual", "nacional", "0", "0", "0"), null);
        CompraCard caro = card("80", false, NOV, fretes("ceg", "internacional", "0", "0", "0"), null);

        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(barato, caro), List.of(), NADA_ARQUIVADO);

        assertThat(r.porCategoria()).extracting(PorCategoria::nome).containsExactly("CEG Internacional", "Individual Nacional");
    }

    @Test
    void centavosNaoSePerdem() {
        CompraCard a = card("0.10", false, NOV, fretes("individual", "nacional", "0.20", "0", "0"), null);
        CompraCard b = card("0.10", false, NOV, fretes("individual", "nacional", "0.20", "0", "0"), null);
        CompraCard c = card("0.10", false, NOV, fretes("individual", "nacional", "0.20", "0", "0"), null);

        FinanceiroResumo r = CalculadoraFinanceira.resumo(List.of(a, b, c), List.of(), NADA_ARQUIVADO);

        assertThat(r.totalInvestido()).isEqualTo(bd("0.90"));
    }

    static CompraCard card(String preco, boolean pago, LocalDate data, Fretes fretes, UUID grupo) {
        return new CompraCard(bd(preco), pago, false, false, data, fretes, grupo);
    }

    static Fretes fretes(String tipo, String origem, String ateVoce, String ateGom, String taxa) {
        return new Fretes(tipo, origem, bd(ateVoce), bd(ateGom), bd(taxa), false, false, false);
    }

    static BigDecimal bd(String v) {
        return new BigDecimal(v);
    }
}
