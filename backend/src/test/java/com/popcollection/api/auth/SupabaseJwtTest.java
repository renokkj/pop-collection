package com.popcollection.api.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/** Quais tokens a API aceita: só login de verdade do nosso projeto Supabase. */
class SupabaseJwtTest {

    static final SupabaseProperties PROJETO = new SupabaseProperties("https://abcd.supabase.co", "");
    static final String USUARIA = "11111111-1111-1111-1111-111111111111";

    static KeyPair chaves;
    static JwtDecoder decoder;

    @BeforeAll
    static void chaveDoSupabase() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        chaves = gen.generateKeyPair();
        NimbusJwtDecoder d = NimbusJwtDecoder.withPublicKey((RSAPublicKey) chaves.getPublic()).build();
        d.setJwtValidator(SupabaseJwt.validador(PROJETO.issuer()));
        decoder = d;
    }

    @Test
    void enderecosDoProjeto() {
        assertThat(new SupabaseProperties("https://abcd.supabase.co/", null).issuer())
                .isEqualTo("https://abcd.supabase.co/auth/v1");
        assertThat(PROJETO.jwkSetUri()).isEqualTo("https://abcd.supabase.co/auth/v1/.well-known/jwks.json");
        assertThat(PROJETO.usaSegredoAntigo()).isFalse();
    }

    @Test
    void aceitaLoginDoProjeto() throws Exception {
        Jwt jwt = decoder.decode(rsa(login().build()));
        UsuarioLogado usuario = UsuarioLogado.de(jwt);
        assertThat(usuario.id()).hasToString(USUARIA);
        assertThat(usuario.email()).isEqualTo("luna@exemplo.com");
    }

    @Test
    void recusaTokenDeOutroProjeto() throws Exception {
        String token = rsa(login().issuer("https://outro.supabase.co/auth/v1").build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtValidationException.class);
    }

    @Test
    void recusaChaveAnonDoSite() throws Exception {
        // a chave "anon" do config.js não tem "sub" nem aud = authenticated
        String token = rsa(new JWTClaimsSet.Builder().issuer(PROJETO.issuer()).claim("role", "anon")
                .expirationTime(Date.from(Instant.now().plusSeconds(600))).build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtValidationException.class);
    }

    @Test
    void recusaLoginVencido() throws Exception {
        String token = rsa(login()
                .issueTime(Date.from(Instant.now().minusSeconds(7200)))
                .expirationTime(Date.from(Instant.now().minusSeconds(3600))).build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtValidationException.class);
    }

    @Test
    void recusaAssinaturaFalsa() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        String token = assinar(new RSASSASigner((RSAPrivateKey) gen.generateKeyPair().getPrivate()),
                JWSAlgorithm.RS256, login().build());
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(BadJwtException.class);
    }

    @Test
    void projetoComSegredoAntigoUsaHs256() throws Exception {
        String segredo = "segredo-de-teste-com-mais-de-32-caracteres";
        JwtDecoder hs = SupabaseJwt.decoder(new SupabaseProperties("https://abcd.supabase.co", segredo));

        String bom = assinar(new MACSigner(segredo), JWSAlgorithm.HS256, login().build());
        assertThat(hs.decode(bom).getSubject()).isEqualTo(USUARIA);

        String ruim = assinar(new MACSigner("outro-segredo-qualquer-com-mais-de-32-caracteres"),
                JWSAlgorithm.HS256, login().build());
        assertThatThrownBy(() -> hs.decode(ruim)).isInstanceOf(BadJwtException.class);
    }

    private static JWTClaimsSet.Builder login() {
        return new JWTClaimsSet.Builder()
                .issuer(PROJETO.issuer())
                .subject(USUARIA)
                .audience(List.of("authenticated"))
                .claim("role", "authenticated")
                .claim("email", "luna@exemplo.com")
                .issueTime(new Date())
                .expirationTime(Date.from(Instant.now().plusSeconds(3600)));
    }

    private static String rsa(JWTClaimsSet claims) throws Exception {
        return assinar(new RSASSASigner(chaves.getPrivate()), JWSAlgorithm.RS256, claims);
    }

    private static String assinar(JWSSigner signer, JWSAlgorithm alg, JWTClaimsSet claims) throws Exception {
        SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(alg).type(JOSEObjectType.JWT).build(), claims);
        jwt.sign(signer);
        return jwt.serialize();
    }
}
