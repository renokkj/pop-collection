package com.popcollection.api.finance;

import java.math.BigDecimal;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.popcollection.api.finance.FinanceiroResumo.Arquivado;
import com.popcollection.api.finance.FinanceiroResumo.Mes;
import com.popcollection.api.finance.FinanceiroResumo.PorCategoria;

/**
 * As contas do Financeiro, sem banco nem HTTP (fácil de testar).
 * <p>
 * Regras principais:
 * <ul>
 *   <li>Card sem grupo: conta o preço e os próprios fretes e taxa.</li>
 *   <li>Card num grupo: conta só o preço; os fretes e a taxa do grupo contam uma vez só.</li>
 *   <li>Situação: chegou → coleção; presente ou tudo pago → a caminho; senão → pagamento.</li>
 *   <li>O total inclui o valor de coleções apagadas.</li>
 * </ul>
 */
public final class CalculadoraFinanceira {

    private static final DateTimeFormatter MES = DateTimeFormatter.ofPattern("yyyy-MM");

    private CalculadoraFinanceira() {
    }

    public static FinanceiroResumo resumo(List<CompraCard> cards, List<CompraGrupo> grupos, Arquivado arquivado) {
        Map<UUID, CompraGrupo> porId = grupos.stream().collect(Collectors.toMap(CompraGrupo::id, Function.identity()));

        BigDecimal total = Dinheiro.ZERO, devido = Dinheiro.ZERO, precos = Dinheiro.ZERO, fretes = Dinheiro.ZERO, taxas = Dinheiro.ZERO;
        int emAberto = 0, quitadas = 0, presentes = 0;
        Map<Categoria, BigDecimal> valorCategoria = new EnumMap<>(Categoria.class);
        Map<Categoria, Integer> cardsCategoria = new EnumMap<>(Categoria.class);
        Map<String, BigDecimal> meses = new TreeMap<>();

        for (CompraCard c : cards) {
            CompraGrupo grupo = c.grupoId() == null ? null : porId.get(c.grupoId());
            BigDecimal preco = Dinheiro.de(c.preco());
            BigDecimal custo = grupo == null ? preco.add(c.fretes().total()) : preco;
            BigDecimal falta = (c.precoPago() ? Dinheiro.ZERO : preco)
                    .add(grupo == null ? c.fretes().devido() : Dinheiro.ZERO);

            total = total.add(custo);
            devido = devido.add(falta);
            precos = precos.add(preco);
            if (grupo == null) {
                fretes = fretes.add(c.fretes().totalFretes());
                taxas = taxas.add(c.fretes().totalTaxas());
            }

            boolean tudoPago = c.precoPago() && (grupo == null ? c.fretes().quitado() : grupo.fretes().quitado());
            if (c.chegou() || c.presente() || tudoPago) {
                quitadas++;
            } else {
                emAberto++;
            }

            Categoria categoria = c.presente() ? Categoria.PRESENTE
                    : (grupo == null ? c.fretes() : grupo.fretes()).categoria();
            valorCategoria.merge(categoria, custo, BigDecimal::add);
            cardsCategoria.merge(categoria, 1, Integer::sum);
            if (c.presente()) {
                presentes++;
            }
            if (c.data() != null) {
                meses.merge(c.data().format(MES), custo, BigDecimal::add);
            }
        }

        for (CompraGrupo g : grupos) {
            BigDecimal custo = g.fretes().total();
            total = total.add(custo);
            devido = devido.add(g.fretes().devido());
            fretes = fretes.add(g.fretes().totalFretes());
            taxas = taxas.add(g.fretes().totalTaxas());
            valorCategoria.merge(g.fretes().categoria(), custo, BigDecimal::add);
            if (g.criadoEm() != null) {
                meses.merge(g.criadoEm().format(MES), custo, BigDecimal::add);
            }
        }

        BigDecimal totalInvestido = total.add(Dinheiro.de(arquivado.total()));
        List<Mes> porMes = meses.entrySet().stream().map(e -> new Mes(e.getKey(), Dinheiro.de(e.getValue()))).toList();
        List<PorCategoria> porCategoria = new ArrayList<>();
        valorCategoria.forEach((cat, valor) -> {
            if (cat != Categoria.PRESENTE && valor.signum() > 0) {
                porCategoria.add(new PorCategoria(cat.chave(), cat.nome(), Dinheiro.de(valor), cardsCategoria.getOrDefault(cat, 0)));
            }
        });
        porCategoria.sort(Comparator.comparing(PorCategoria::valor).reversed());

        return new FinanceiroResumo(
                Dinheiro.de(totalInvestido),
                Dinheiro.de(totalInvestido.subtract(devido)),
                Dinheiro.de(devido),
                Dinheiro.de(precos),
                Dinheiro.de(fretes),
                Dinheiro.de(taxas),
                cards.size() + arquivado.cards(),
                emAberto,
                quitadas,
                presentes,
                new Arquivado(Dinheiro.de(arquivado.total()), arquivado.cards()),
                porMes,
                List.copyOf(porCategoria));
    }

}
