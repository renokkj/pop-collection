# Pop Collection API

API do [Pop Collection](../README.md) em **Java 21 + Spring Boot**. Ela vai assumir, aos poucos, as regras do app que hoje ficam no `app.js` (financeiro, grupos, quem vê o quê), usando o mesmo banco PostgreSQL do Supabase.

> Etapa 1 de 7: por enquanto a API só tem o esqueleto (status, saúde, Swagger, erros padronizados, testes e CI). O site ainda não usa a API.

## Stack

| Parte | Ferramenta |
| --- | --- |
| Linguagem | Java 21 |
| Framework | Spring Boot 4 (Spring Web MVC, Validation, Actuator) |
| Documentação | springdoc-openapi (Swagger UI) |
| Testes | JUnit 5, MockMvc, JaCoCo |
| Build | Maven (com Maven Wrapper) |
| Container | Docker |
| CI | GitHub Actions |

## Como rodar no computador

Precisa só do **Java 21** instalado (no Mac: `brew install openjdk@21`). O Maven vem junto, pelo `mvnw`.

```bash
cd backend
./mvnw spring-boot:run
```

Depois abra:

- http://localhost:8080/api/status: nome, versão e horário da API
- http://localhost:8080/actuator/health: se a API está de pé
- http://localhost:8080/swagger-ui.html: todos os endpoints, com botão para testar

## Testes

```bash
./mvnw verify
```

O relatório de cobertura fica em `target/site/jacoco/index.html`.

## Docker

```bash
docker build -t pop-collection-api .
docker run -p 8080:8080 pop-collection-api
```

## Configuração

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `8080` |
| `POP_CORS_ALLOWED_ORIGINS` | Sites que podem chamar a API, separados por vírgula | GitHub Pages do app e `localhost:5500` |

Senhas e chaves nunca entram no repositório: ficam em variáveis de ambiente.

## Organização do código

O código fica separado por assunto, e dentro de cada assunto pelas camadas `Controller` → `Service` → `Repository`.

```
src/main/java/com/popcollection/api/
├── config/    CORS, Swagger, relógio
├── common/    tratamento de erros
└── status/    GET /api/status
```
