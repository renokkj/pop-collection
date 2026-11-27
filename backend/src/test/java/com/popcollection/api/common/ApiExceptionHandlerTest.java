package com.popcollection.api.common;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@WebMvcTest(ApiExceptionHandlerTest.ExemploController.class)
@Import({ApiExceptionHandler.class, ApiExceptionHandlerTest.ExemploController.class})
class ApiExceptionHandlerTest {

    @Autowired
    MockMvc mvc;

    @Test
    void dadosInvalidosViramErro400ComOsCampos() throws Exception {
        mvc.perform(post("/teste/cards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nome\": \"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.title").value("Dados inválidos"))
                .andExpect(jsonPath("$.campos.nome").value("O nome é obrigatório."));
    }

    record ExemploCard(@NotBlank(message = "O nome é obrigatório.") @Size(max = 120) String nome) {
    }

    @RestController
    static class ExemploController {
        @PostMapping("/teste/cards")
        ExemploCard criar(@Valid @RequestBody ExemploCard card) {
            return card;
        }
    }
}
