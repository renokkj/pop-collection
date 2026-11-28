-- Pop Collection — usuário de banco da API Java (backend/)
-- Rode UMA vez no SQL Editor do Supabase, depois de trocar a senha logo abaixo.
-- O que este arquivo faz:
--   1) cria o usuário "pop_api", que a API usa para entrar no banco (não é o usuário "postgres");
--   2) deixa a API ler e gravar SÓ as tabelas do app, e nada de auth (contas) ou storage (fotos);
--   3) cria o esquema "api", onde o Flyway guarda o histórico de mudanças do banco feitas pela API.
-- As regras de hoje (RLS) continuam valendo para o site. Para a API, quem confere o dono de cada
-- card é o código Java, por isso as regras abaixo liberam as tabelas só para o pop_api.
-- Pode rodar de novo sem problema: na segunda vez ele só atualiza a senha e as permissões.

do $$
declare
  -- TROQUE a senha abaixo por uma senha forte, só de letras e números (ex.: gerada num gerenciador de senhas).
  -- Guarde essa senha: ela vai no arquivo backend/.env e na hospedagem, NUNCA no GitHub.
  v_senha text := 'TROQUE-ESTA-SENHA';
begin
  if v_senha = 'TROQUE-ESTA-SENHA' or char_length(v_senha) < 16 then
    raise exception 'Troque a senha do pop_api (linha "v_senha") por uma com pelo menos 16 caracteres.';
  end if;
  if exists (select 1 from pg_roles where rolname = 'pop_api') then
    execute format('alter role pop_api with login noinherit password %L', v_senha);
  else
    execute format('create role pop_api with login noinherit password %L', v_senha);
  end if;
end;
$$;

-- 1) Tabelas do app: ler e gravar
grant usage on schema public to pop_api;
grant select, insert, update, delete on
  public.cards, public.card_groups, public.folders, public.stats,
  public.profiles, public.follows, public.notifications
  to pop_api;

-- 2) Regras (RLS) só para a API: libera as linhas, porque o dono é conferido no código Java
drop policy if exists "api: acesso pela API" on public.cards;
create policy "api: acesso pela API" on public.cards for all to pop_api using (true) with check (true);
drop policy if exists "api: acesso pela API" on public.card_groups;
create policy "api: acesso pela API" on public.card_groups for all to pop_api using (true) with check (true);
drop policy if exists "api: acesso pela API" on public.folders;
create policy "api: acesso pela API" on public.folders for all to pop_api using (true) with check (true);
drop policy if exists "api: acesso pela API" on public.stats;
create policy "api: acesso pela API" on public.stats for all to pop_api using (true) with check (true);
drop policy if exists "api: acesso pela API" on public.profiles;
create policy "api: acesso pela API" on public.profiles for all to pop_api using (true) with check (true);
drop policy if exists "api: acesso pela API" on public.follows;
create policy "api: acesso pela API" on public.follows for all to pop_api using (true) with check (true);
drop policy if exists "api: acesso pela API" on public.notifications;
create policy "api: acesso pela API" on public.notifications for all to pop_api using (true) with check (true);

-- 3) Esquema da API (histórico do Flyway). O dono continua sendo o postgres; o pop_api só usa e cria tabelas nele.
create schema if not exists api;
grant usage, create on schema api to pop_api;

-- 4) Limite de conexões, para caber no plano gratuito do Supabase
alter role pop_api connection limit 5;
