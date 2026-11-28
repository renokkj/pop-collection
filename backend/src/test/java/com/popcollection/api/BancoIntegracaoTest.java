package com.popcollection.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.UUID;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

/** A API conectada no banco como pop_api: o que ela consegue e o que ela NÃO consegue ver. */
@SpringBootTest
@AutoConfigureMockMvc
class BancoIntegracaoTest extends BancoDeTeste {

    static final UUID LUNA = UUID.fromString("11111111-1111-1111-1111-111111111111");
    static final UUID SEM_PERFIL = UUID.fromString("22222222-2222-2222-2222-222222222222");

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @BeforeAll
    static void criarContas() throws Exception {
        // como dono do banco (no Supabase, isso é o cadastro feito pelo Auth e pelo site)
        try (Connection c = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
            c.createStatement().execute("""
                    insert into auth.users (id, email) values
                      ('%s', 'luna@exemplo.com'), ('%s', 'nova@exemplo.com') on conflict do nothing;
                    insert into public.profiles (id, username, display_name, avatar_path)
                      values ('%s', 'luna.pc', 'Luna', '%s/perfil/foto.jpg') on conflict do nothing;
                    """.formatted(LUNA, SEM_PERFIL, LUNA, LUNA));
        }
    }

    @Test
    void meMostraOPerfilDoBanco() throws Exception {
        mvc.perform(get("/api/me").with(jwt().jwt(j -> j.subject(LUNA.toString()).claim("email", "luna@exemplo.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(LUNA.toString()))
                .andExpect(jsonPath("$.email").value("luna@exemplo.com"))
                .andExpect(jsonPath("$.perfil.username").value("luna.pc"))
                .andExpect(jsonPath("$.perfil.nome").value("Luna"))
                .andExpect(jsonPath("$.perfil.fotoPath").value(LUNA + "/perfil/foto.jpg"));
    }

    @Test
    void contaSemPerfilVemComPerfilVazio() throws Exception {
        mvc.perform(get("/api/me").with(jwt().jwt(j -> j.subject(SEM_PERFIL.toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.perfil").doesNotExist());
    }

    @Test
    void apiEntraComoPopApi() {
        assertThat(jdbc.queryForObject("select current_user", String.class)).isEqualTo("pop_api");
    }

    @Test
    void apiLeAsTabelasDoAppMesmoComRls() {
        assertThat(jdbc.queryForObject("select count(*) from public.profiles", Integer.class)).isPositive();
    }

    @Test
    void apiNaoVeContasNemSenhas() {
        assertThatThrownBy(() -> jdbc.queryForList("select * from auth.users"))
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("permission denied");
    }

    @Test
    void apiNaoMexeNasFotosDireto() {
        assertThatThrownBy(() -> jdbc.queryForList("select * from storage.objects"))
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("permission denied");
    }

    @Test
    void flywayGuardaOHistoricoNoEsquemaApi() {
        assertThat(jdbc.queryForObject(
                "select count(*) from information_schema.tables where table_schema = 'api' and table_name = 'flyway_schema_history'",
                Integer.class)).isEqualTo(1);
    }
}
