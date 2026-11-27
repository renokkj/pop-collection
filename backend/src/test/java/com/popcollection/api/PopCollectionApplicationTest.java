package com.popcollection.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/** Sobe a aplicação inteira e confere o que a hospedagem e o site precisam. */
@SpringBootTest
@AutoConfigureMockMvc
class PopCollectionApplicationTest {

    @Autowired
    MockMvc mvc;

    @Test
    void healthRespondeUp() throws Exception {
        mvc.perform(get("/actuator/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void swaggerDescreveAApi() throws Exception {
        mvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.info.title").value("Pop Collection API"))
                .andExpect(jsonPath("$.paths['/api/status']").exists());
    }

    @Test
    void siteDoGithubPagesPodeChamarAApi() throws Exception {
        mvc.perform(options("/api/status")
                        .header("Origin", "https://renokkj.github.io")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", "https://renokkj.github.io"));
    }

    @Test
    void outroSiteNaoPodeChamarAApi() throws Exception {
        mvc.perform(options("/api/status")
                        .header("Origin", "https://site-qualquer.example")
                        .header("Access-Control-Request-Method", "GET"))
                .andExpect(status().isForbidden());
    }
}
