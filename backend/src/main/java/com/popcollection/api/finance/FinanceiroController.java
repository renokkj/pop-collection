package com.popcollection.api.finance;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.popcollection.api.auth.UsuarioLogado;

@RestController
@RequestMapping("/api/financeiro")
@Tag(name = "Financeiro", description = "Quanto já foi gasto, pago e falta pagar")
public class FinanceiroController {

    private final FinanceiroService service;

    public FinanceiroController(FinanceiroService service) {
        this.service = service;
    }

    @GetMapping("/resumo")
    @Operation(summary = "Totais, gasto por mês e por categoria das compras da pessoa logada")
    public FinanceiroResumo resumo(@AuthenticationPrincipal Jwt jwt) {
        return service.resumo(UsuarioLogado.de(jwt));
    }
}
