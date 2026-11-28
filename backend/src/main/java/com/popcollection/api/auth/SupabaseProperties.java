package com.popcollection.api.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Dados do projeto Supabase usados para conferir o login.
 *
 * @param url       endereço do projeto, ex.: https://abcd.supabase.co (é público)
 * @param jwtSecret só para projetos com a chave antiga "JWT secret" (HS256); vazio nos projetos
 *                  com chaves de assinatura novas, em que a API usa as chaves públicas do Supabase
 */
@ConfigurationProperties(prefix = "pop.supabase")
public record SupabaseProperties(String url, String jwtSecret) {

    /** Quem emite os tokens de login: {@code <url>/auth/v1}. */
    public String issuer() {
        return url.replaceAll("/+$", "") + "/auth/v1";
    }

    public String jwkSetUri() {
        return issuer() + "/.well-known/jwks.json";
    }

    public boolean usaSegredoAntigo() {
        return jwtSecret != null && !jwtSecret.isBlank();
    }
}
