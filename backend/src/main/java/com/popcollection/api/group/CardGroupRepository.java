package com.popcollection.api.group;

import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface CardGroupRepository extends JpaRepository<CardGroup, UUID> {

    List<CardGroup> findByUserId(UUID userId);
}
