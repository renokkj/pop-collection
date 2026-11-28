# Pop Collection API

API do [Pop Collection](../README.md) em **Java 21 + Spring Boot**. Ela vai assumir, aos poucos, as regras do app que hoje ficam no `app.js` (financeiro, grupos, quem vê o quê), usando o mesmo banco PostgreSQL do Supabase.

> Etapa 2 de 7: a API confere o login do Supabase, conecta no banco com um usuário próprio e responde `GET /api/me`. O site ainda não usa a API.

## Stack

| Parte | Ferramenta |
| --- | --- |
| Linguagem | Java 21 |
| Framework | Spring Boot 4 (Spring Web MVC, Validation, Actuator) |
| Login | Spring Security (OAuth2 Resource Server) conferindo o token do Supabase Auth |
| Banco | Spring Data JPA + PostgreSQL do Supabase, histórico com Flyway |
| Documentação | springdoc-openapi (Swagger UI) |
| Testes | JUnit 5, MockMvc, Testcontainers (Postgres de verdade), JaCoCo |
| Build | Maven (com Maven Wrapper) |
| Container | Docker |
| CI | GitHub Actions |

## Como rodar no computador

Precisa do **Java 21** instalado (no Mac: `brew install --cask temurin@21`). O Maven vem junto, pelo `mvnw`.

Antes da primeira vez:

1. Rode o arquivo [`supabase/api-usuario-pop_api.sql`](../supabase/api-usuario-pop_api.sql) no SQL Editor do Supabase, trocando a senha.
2. Copie `backend/.env.example` para `backend/.env` e preencha (o `.env` nunca vai para o GitHub).

```bash
cd backend
./mvnw spring-boot:run
```

Depois abra:

- http://localhost:8080/api/status: nome, versão e horário da API
- http://localhost:8080/api/me: a conta logada (precisa do token de login)
- http://localhost:8080/actuator/health: se a API está de pé
- http://localhost:8080/swagger-ui.html: todos os endpoints, com botão para testar

## Testes

```bash
./mvnw verify
```

Os testes de banco sobem um PostgreSQL de verdade com o Testcontainers, então o **Docker** precisa estar aberto (Docker Desktop é gratuito para uso pessoal). Eles rodam o `supabase/schema.sql` do app e o `supabase/api-usuario-pop_api.sql`, e conferem o que o usuário `pop_api` pode e não pode ver.

O relatório de cobertura fica em `target/site/jacoco/index.html`.

## Docker

```bash
docker build -t pop-collection-api .
docker run -p 8080:8080 --env-file .env pop-collection-api
```

A publicação no Render (plano gratuito) está descrita no [`render.yaml`](../render.yaml).

## Configuração

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | Porta do servidor | `8080` |
| `DB_URL` | Endereço do banco (Session pooler do Supabase, formato `jdbc:postgresql://...`) | obrigatório |
| `DB_USER` | `pop_api.<id do projeto>` | obrigatório |
| `DB_PASSWORD` | Senha escolhida no `api-usuario-pop_api.sql` | obrigatório |
| `SUPABASE_URL` | Endereço do projeto Supabase (público) | o do app |
| `SUPABASE_JWT_SECRET` | Só para projetos com a chave antiga "JWT Secret" | vazio |
| `POP_CORS_ALLOWED_ORIGINS` | Sites que podem chamar a API, separados por vírgula | GitHub Pages do app e `localhost:5500` |

Senhas e chaves nunca entram no repositório: ficam em variáveis de ambiente.

## Organização do código

O código fica separado por assunto, e dentro de cada assunto pelas camadas `Controller` → `Service` → `Repository`.

```
src/main/java/com/popcollection/api/
├── config/    segurança, CORS, Swagger, relógio
├── common/    tratamento de erros
├── auth/      regras do token do Supabase e usuário logado
├── profile/   tabela profiles (JPA)
├── me/        GET /api/me
└── status/    GET /api/status
```

## Login e banco

- **Login:** o site continua entrando pelo Supabase Auth. Em cada chamada, manda `Authorization: Bearer <token>`. A API confere a assinatura com as chaves públicas do Supabase, o emissor, a validade e se é login de uma pessoa (`aud = authenticated`). A chave `anon` do site é recusada.
- **Banco:** a API entra como `pop_api`, que só lê e grava as tabelas do app. Contas (`auth`) e fotos (`storage`) ficam de fora. O dono dos dados vem sempre do token, nunca do que o site envia.
