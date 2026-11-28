package com.popcollection.api.card;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CardRepository extends JpaRepository<Card, UUID> {

    /** Cards de uma conta numa modalidade (compra, binder ou wishlist). */
    List<Card> findByUserIdAndKind(UUID userId, String kind);
}
