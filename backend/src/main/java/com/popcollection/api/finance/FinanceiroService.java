package com.popcollection.api.finance;

import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.popcollection.api.auth.UsuarioLogado;
import com.popcollection.api.card.Card;
import com.popcollection.api.card.CardRepository;
import com.popcollection.api.finance.FinanceiroResumo.Arquivado;
import com.popcollection.api.group.CardGroup;
import com.popcollection.api.group.CardGroupRepository;
import com.popcollection.api.stats.StatsRepository;

/** Busca no banco só os dados da pessoa logada e entrega para a calculadora. */
@Service
public class FinanceiroService {

    private final CardRepository cards;
    private final CardGroupRepository grupos;
    private final StatsRepository stats;
    private final Clock clock;

    public FinanceiroService(CardRepository cards, CardGroupRepository grupos, StatsRepository stats, Clock clock) {
        this.cards = cards;
        this.grupos = grupos;
        this.stats = stats;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public FinanceiroResumo resumo(UsuarioLogado usuario) {
        List<CompraCard> compras = cards.findByUserIdAndKind(usuario.id(), "compra").stream().map(this::compra).toList();
        List<CompraGrupo> gs = grupos.findByUserId(usuario.id()).stream().map(this::grupo).toList();
        Arquivado arquivado = stats.findById(usuario.id())
                .map(s -> new Arquivado(s.getArchivedTotal(), s.getArchivedCount()))
                .orElse(new Arquivado(null, 0));
        return CalculadoraFinanceira.resumo(compras, gs, arquivado);
    }

    private CompraCard compra(Card c) {
        Fretes fretes = new Fretes(c.getPurchaseType(), c.getOrigin(), c.getShipping(), c.getShippingToGom(),
                c.getImportTax(), c.isPaidShipping(), c.isPaidShippingToGom(), c.isPaidTax());
        LocalDate data = c.getPurchasedOn() != null ? c.getPurchasedOn() : dia(c.getCreatedAt());
        return new CompraCard(c.getPrice(), c.isPaidPrice(), c.isGift(), c.isArrived(), data, fretes, c.getGroupId());
    }

    private CompraGrupo grupo(CardGroup g) {
        Fretes fretes = new Fretes(g.getPurchaseType(), g.getOrigin(), g.getShipping(), g.getShippingToGom(),
                g.getImportTax(), g.isPaidShipping(), g.isPaidShippingToGom(), g.isPaidTax());
        return new CompraGrupo(g.getId(), fretes, dia(g.getCreatedAt()));
    }

    /** Dia no fuso de Brasília. */
    private LocalDate dia(OffsetDateTime quando) {
        return quando == null ? null : quando.atZoneSameInstant(clock.getZone()).toLocalDate();
    }
}
