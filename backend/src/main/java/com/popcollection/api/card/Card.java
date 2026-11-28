package com.popcollection.api.card;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.Immutable;

/**
 * Photocard (tabela public.cards). Por enquanto a API só lê os campos que o Financeiro usa;
 * cadastrar e editar cards chega na etapa 4.
 */
@Entity
@Immutable
@Table(name = "cards", schema = "public")
public class Card {

    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** compra, binder ou wishlist: só compra tem valores. */
    @Column(nullable = false, columnDefinition = "text")
    private String kind;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal price;

    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal shipping;

    @Column(name = "shipping_to_gom", nullable = false, precision = 10, scale = 2)
    private BigDecimal shippingToGom;

    @Column(name = "import_tax", nullable = false, precision = 10, scale = 2)
    private BigDecimal importTax;

    @Column(name = "paid_price", nullable = false)
    private boolean paidPrice;

    @Column(name = "paid_shipping", nullable = false)
    private boolean paidShipping;

    @Column(name = "paid_shipping_to_gom", nullable = false)
    private boolean paidShippingToGom;

    @Column(name = "paid_tax", nullable = false)
    private boolean paidTax;

    @Column(name = "purchase_type", nullable = false, columnDefinition = "text")
    private String purchaseType;

    @Column(nullable = false, columnDefinition = "text")
    private String origin;

    @Column(nullable = false)
    private boolean arrived;

    @Column(nullable = false)
    private boolean gift;

    @Column(name = "group_id")
    private UUID groupId;

    @Column(name = "purchased_on")
    private LocalDate purchasedOn;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected Card() {
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getKind() { return kind; }
    public BigDecimal getPrice() { return price; }
    public BigDecimal getShipping() { return shipping; }
    public BigDecimal getShippingToGom() { return shippingToGom; }
    public BigDecimal getImportTax() { return importTax; }
    public boolean isPaidPrice() { return paidPrice; }
    public boolean isPaidShipping() { return paidShipping; }
    public boolean isPaidShippingToGom() { return paidShippingToGom; }
    public boolean isPaidTax() { return paidTax; }
    public String getPurchaseType() { return purchaseType; }
    public String getOrigin() { return origin; }
    public boolean isArrived() { return arrived; }
    public boolean isGift() { return gift; }
    public UUID getGroupId() { return groupId; }
    public LocalDate getPurchasedOn() { return purchasedOn; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
