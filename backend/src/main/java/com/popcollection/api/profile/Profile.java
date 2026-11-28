package com.popcollection.api.profile;

import java.time.OffsetDateTime;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.Immutable;

/**
 * Perfil público de uma conta (tabela public.profiles).
 * Por enquanto a API só lê; criar e editar perfil chega na etapa 6.
 */
@Entity
@Immutable
@Table(name = "profiles", schema = "public")
public class Profile {

    @Id
    private UUID id;

    @Column(nullable = false, columnDefinition = "text")
    private String username;

    @Column(name = "display_name", nullable = false, columnDefinition = "text")
    private String displayName;

    @Column(name = "avatar_path", columnDefinition = "text")
    private String avatarPath;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    protected Profile() {
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getAvatarPath() {
        return avatarPath;
    }

    public OffsetDateTime getCreatedAt() {
        return createdAt;
    }
}
