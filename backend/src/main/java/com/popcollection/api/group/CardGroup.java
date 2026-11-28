package com.popcollection.api.group;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.Immutable;

/**
 * Grupo de compra (tabela public.card_groups): vários cards da mesma compra.
 * Os fretes e a taxa ficam no grupo e contam uma vez só.
 */
@Entity
@Immutable
@Table(name = "card_groups", schema = "public")
public class CardGroup {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(nullable = false, columnDefinition = "text")
    private String name;

    @Column(name = "purchase_type", nullable = false, columnDefinition = "text")
    private String purchaseType;

    @Column(nullable = false, columnDefinition = "text")
    private String origin;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal shipping;

    @Column(name = "shipping_to_gom", nullable = false, precision = 10, scale = 2)
    private BigDecimal shippingToGom;

    @Column(name = "import_tax", nullable = false, precision = 10, scale = 2)
    private BigDecimal importTax;

    @Column(name = "paid_shipping", nullable = false)
    private boolean paidShipping;

    @Column(name = "paid_shipping_to_gom", nullable = false)
    private boolean paidShippingToGom;

    @Column(name = "paid_tax", nullable = false)
    private boolean paidTax;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected CardGroup() {
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getName() { return name; }
    public String getPurchaseType() { return purchaseType; }
    public String getOrigin() { return origin; }
    public BigDecimal getShipping() { return shipping; }
    public BigDecimal getShippingToGom() { return shippingToGom; }
    public BigDecimal getImportTax() { return importTax; }
    public boolean isPaidShipping() { return paidShipping; }
    public boolean isPaidShippingToGom() { return paidShippingToGom; }
    public boolean isPaidTax() { return paidTax; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
