package com.popcollection.api.stats;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.Immutable;

/** Total já gasto com coleções apagadas (tabela public.stats), para o total não zerar. */
@Entity
@Immutable
@Table(name = "stats", schema = "public")
public class Stats {

    @Id
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "archived_total", nullable = false, precision = 12, scale = 2)
    private BigDecimal archivedTotal;

    @Column(name = "archived_count", nullable = false)
    private int archivedCount;

    protected Stats() {
    }

    public UUID getUserId() { return userId; }
    public BigDecimal getArchivedTotal() { return archivedTotal; }
    public int getArchivedCount() { return archivedCount; }
}
