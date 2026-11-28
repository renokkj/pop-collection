package com.popcollection.api.auth;

import java.nio.charset.StandardCharsets;
import java.util.List;

import javax.crypto.spec.SecretKeySpec;

import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Regras para aceitar um token de login do Supabase:
 * assinatura válida, emitido pelo nosso projeto, dentro da validade,
 * de uma pessoa logada (aud = "authenticated") e com o id dela (sub).
 * Isso recusa, por exemplo, a chave "anon" do site, que não é login de ninguém.
 */
public final class SupabaseJwt {

    static final String AUDIENCIA = "authenticated";

    private SupabaseJwt() {
    }

    public static JwtDecoder decoder(SupabaseProperties supabase) {
        NimbusJwtDecoder decoder;
        if (supabase.usaSegredoAntigo()) {
            var chave = new SecretKeySpec(supabase.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
            decoder = NimbusJwtDecoder.withSecretKey(chave).macAlgorithm(MacAlgorithm.HS256).build();
        } else {
            decoder = NimbusJwtDecoder.withJwkSetUri(supabase.jwkSetUri())
                    .jwsAlgorithms(algs -> {
                        algs.add(SignatureAlgorithm.ES256);
                        algs.add(SignatureAlgorithm.RS256);
                    })
                    .build();
        }
        decoder.setJwtValidator(validador(supabase.issuer()));
        return decoder;
    }

    public static OAuth2TokenValidator<Jwt> validador(String issuer) {
        OAuth2TokenValidator<Jwt> pessoaLogada = jwt -> {
            List<String> aud = jwt.getAudience();
            boolean ok = aud != null && aud.contains(AUDIENCIA)
                    && jwt.getSubject() != null && !jwt.getSubject().isBlank();
            return ok ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(
                            new OAuth2Error("invalid_token", "O token não é de uma pessoa logada.", null));
        };
        return new DelegatingOAuth2TokenValidator<>(JwtValidators.createDefaultWithIssuer(issuer), pessoaLogada);
    }
}
