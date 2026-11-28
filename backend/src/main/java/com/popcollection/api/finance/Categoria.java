package com.popcollection.api.finance;

/** Categoria de compra: tipo (Individual ou CEG) × origem (Nacional ou Internacional), ou Presente. */
public enum Categoria {
    INDIVIDUAL_NACIONAL("individual-nacional", "Individual Nacional"),
    INDIVIDUAL_INTERNACIONAL("individual-internacional", "Individual Internacional"),
    CEG_NACIONAL("ceg-nacional", "CEG Nacional"),
    CEG_INTERNACIONAL("ceg-internacional", "CEG Internacional"),
    PRESENTE("gift", "Presente");

    private final String chave;
    private final String nome;

    Categoria(String chave, String nome) {
        this.chave = chave;
        this.nome = nome;
    }

    public String chave() {
        return chave;
    }

    public String nome() {
        return nome;
    }

    static Categoria de(String tipo, String origem) {
        boolean ceg = "ceg".equals(tipo);
        boolean internacional = "internacional".equals(origem);
        if (ceg) {
            return internacional ? CEG_INTERNACIONAL : CEG_NACIONAL;
        }
        return internacional ? INDIVIDUAL_INTERNACIONAL : INDIVIDUAL_NACIONAL;
    }
}
