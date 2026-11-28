package com.popcollection.api;

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
import org.springframework.test.web.servlet.MockMvc;

/** O resumo lido do banco de verdade, só com os dados da pessoa logada. */
@SpringBootTest
@AutoConfigureMockMvc
class FinanceiroIntegracaoTest extends BancoDeTeste {

    static final UUID ANA = UUID.fromString("33333333-3333-3333-3333-333333333333");
    static final UUID BIA = UUID.fromString("44444444-4444-4444-4444-444444444444");
    static final UUID GRUPO = UUID.fromString("55555555-5555-5555-5555-555555555555");

    @Autowired
    MockMvc mvc;

    @BeforeAll
    static void dados() throws Exception {
        try (Connection c = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
            c.createStatement().execute("""
                    insert into auth.users (id, email) values ('%1$s', 'ana@exemplo.com'), ('%2$s', 'bia@exemplo.com')
                      on conflict do nothing;
                    insert into public.card_groups (id, user_id, name, purchase_type, origin, shipping, shipping_to_gom,
                                                    import_tax, paid_shipping, paid_shipping_to_gom, paid_tax, created_at)
                      values ('%3$s', '%1$s', 'Álbum aespa', 'individual', 'internacional', 10, 20, 6, true, true, false,
                              '2026-10-31 23:30:00-03');
                    -- Ana: dois cards no grupo, um sem grupo, um presente e um card de Binder (fora da conta)
                    insert into public.cards (user_id, name, kind, price, shipping, paid_price, purchased_on, group_id) values
                      ('%1$s', 'Karina', 'compra', 30, 50, true, '2026-11-02', '%3$s'),
                      ('%1$s', 'Winter', 'compra', 25, 50, true, '2026-11-02', '%3$s');
                    insert into public.cards (user_id, name, kind, price, shipping, paid_price, paid_shipping, purchased_on) values
                      ('%1$s', 'Giselle', 'compra', 40, 12, true, false, '2026-11-20');
                    insert into public.cards (user_id, name, kind, gift, arrived, purchased_on) values
                      ('%1$s', 'Ningning', 'compra', true, false, '2026-11-21');
                    insert into public.cards (user_id, name, kind) values ('%1$s', 'Karina do Binder', 'binder');
                    insert into public.stats (user_id, archived_total, archived_count) values ('%1$s', 100, 3);
                    -- Bia: não pode aparecer no resumo da Ana
                    insert into public.cards (user_id, name, kind, price, purchased_on) values ('%2$s', 'Outra', 'compra', 999, '2026-11-01');
                    """.formatted(ANA, BIA, GRUPO));
        }
    }

    @Test
    void resumoDaAna() throws Exception {
        mvc.perform(get("/api/financeiro/resumo").with(jwt().jwt(j -> j.subject(ANA.toString()))))
                .andExpect(status().isOk())
                // 30 + 25 + (10 + 20 + 6) + (40 + 12) + 0 + 100 arquivado
                .andExpect(jsonPath("$.totalInvestido").value(243.00))
                .andExpect(jsonPath("$.faltaPagar").value(18.00)) // taxa do grupo + frete do Giselle
                .andExpect(jsonPath("$.jaPago").value(225.00))
                .andExpect(jsonPath("$.emPhotocards").value(95.00))
                .andExpect(jsonPath("$.emFretes").value(42.00))
                .andExpect(jsonPath("$.emTaxas").value(6.00))
                .andExpect(jsonPath("$.cards").value(7)) // 4 compras + 3 arquivados
                .andExpect(jsonPath("$.comprasEmAberto").value(3))
                .andExpect(jsonPath("$.comprasQuitadas").value(1))
                .andExpect(jsonPath("$.presentes").value(1))
                // o grupo foi criado às 23:30 de 31/out em Brasília: conta em outubro
                .andExpect(jsonPath("$.porMes[0].mes").value("2026-10"))
                .andExpect(jsonPath("$.porMes[0].valor").value(36.00))
                .andExpect(jsonPath("$.porMes[1].mes").value("2026-11"))
                .andExpect(jsonPath("$.porMes[1].valor").value(107.00))
                .andExpect(jsonPath("$.porCategoria[0].nome").value("Individual Internacional"));
    }

    @Test
    void semLoginNaoVeNada() throws Exception {
        mvc.perform(get("/api/financeiro/resumo")).andExpect(status().isUnauthorized());
    }
}
