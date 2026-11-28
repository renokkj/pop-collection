package com.popcollection.api.me;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.popcollection.api.auth.UsuarioLogado;
import com.popcollection.api.config.SecurityConfig;

@WebMvcTest(MeController.class)
@Import(SecurityConfig.class)
class MeControllerTest {

    static final UUID ID = UUID.fromString("11111111-1111-1111-1111-111111111111");

    @Autowired
    MockMvc mvc;

    @MockitoBean
    MeService service;

    @Test
    void semTokenRecebe401() throws Exception {
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void usaOIdDoToken() throws Exception {
        given(service.buscar(any(UsuarioLogado.class))).willAnswer(inv -> {
            UsuarioLogado u = inv.getArgument(0);
            return new MeResponse(u.id(), u.email(), new MeResponse.Perfil("luna.pc", "Luna", null));
        });

        mvc.perform(get("/api/me").with(jwt().jwt(j -> j.subject(ID.toString()).claim("email", "luna@exemplo.com"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(ID.toString()))
                .andExpect(jsonPath("$.email").value("luna@exemplo.com"))
                .andExpect(jsonPath("$.perfil.username").value("luna.pc"));
    }
}
