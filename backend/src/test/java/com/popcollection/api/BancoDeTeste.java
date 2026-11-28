package com.popcollection.api;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.images.builder.Transferable;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.MountableFile;

/**
 * Sobe um PostgreSQL de verdade (Docker) parecido com o do Supabase:
 * 1) o que o Supabase já traz (papéis, auth, storage), 2) o supabase/schema.sql do app e
 * 3) o supabase/api-usuario-pop_api.sql, rodado por um usuário que NÃO é superuser (como o "postgres"
 * do Supabase, que só pode criar usuários e é dono das tabelas). A API entra como pop_api, igual em produção.
 */
public abstract class BancoDeTeste {

    public static final String SENHA_POP_API = "senha-de-teste-1234567";

    /** Imita o "postgres" do Supabase: pode criar usuários, é dono das tabelas, mas não é superuser. */
    private static final String DONO_DAS_TABELAS = """
            create role dono_supabase nologin createrole;
            grant create on database test to dono_supabase;
            do $$
            declare t record;
            begin
              for t in select tablename from pg_tables where schemaname = 'public' loop
                execute format('alter table public.%I owner to dono_supabase', t.tablename);
              end loop;
            end $$;
            """;

    protected static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17-alpine")
            .withCopyFileToContainer(MountableFile.forClasspathResource("supabase-simulado.sql"),
                    "/docker-entrypoint-initdb.d/01-supabase-simulado.sql")
            .withCopyFileToContainer(MountableFile.forHostPath("../supabase/schema.sql"),
                    "/docker-entrypoint-initdb.d/02-schema.sql")
            .withCopyToContainer(Transferable.of(DONO_DAS_TABELAS),
                    "/docker-entrypoint-initdb.d/03-dono-sem-superuser.sql")
            .withCopyToContainer(Transferable.of("set role dono_supabase;\n" + usuarioDaApi()),
                    "/docker-entrypoint-initdb.d/04-api-usuario-pop_api.sql");

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void banco(DynamicPropertyRegistry props) {
        props.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        props.add("spring.datasource.username", () -> "pop_api");
        props.add("spring.datasource.password", () -> SENHA_POP_API);
    }

    private static String usuarioDaApi() {
        try {
            return Files.readString(Path.of("../supabase/api-usuario-pop_api.sql"))
                    .replace("'TROQUE-ESTA-SENHA';", "'" + SENHA_POP_API + "';");
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
