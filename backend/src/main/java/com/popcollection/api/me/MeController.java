package com.popcollection.api.me;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.popcollection.api.auth.UsuarioLogado;

@RestController
@RequestMapping("/api/me")
@Tag(name = "Conta", description = "Quem está logado")
public class MeController {

    private final MeService service;

    public MeController(MeService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Mostra a conta logada e o perfil dela, se já existir")
    public MeResponse me(@AuthenticationPrincipal Jwt jwt) {
        return service.buscar(UsuarioLogado.de(jwt));
    }
}
