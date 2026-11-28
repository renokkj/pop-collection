package com.popcollection.api.finance;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.stream.Stream;

/** Somas em reais, sempre com 2 casas. */
final class Dinheiro {

    static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2);

    private Dinheiro() {
    }

    static BigDecimal soma(Stream<BigDecimal> valores) {
        return valores.reduce(ZERO, BigDecimal::add).setScale(2, RoundingMode.HALF_UP);
    }

    static BigDecimal de(BigDecimal v) {
        return v == null ? ZERO : v.setScale(2, RoundingMode.HALF_UP);
    }
}
