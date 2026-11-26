-- Pop Collection — estrutura do banco no Supabase
-- Cole este arquivo inteiro no SQL Editor do seu projeto Supabase e clique em "Run".
-- Pode rodar de novo sem problema: ele não duplica nada.

-- 1) Tabela de photocards (cada linha pertence a um usuário)
create table if not exists public.cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 120),
  seller        text check (char_length(seller) <= 80),
  price         numeric(10,2) not null default 0 check (price >= 0),
  shipping      numeric(10,2) not null default 0 check (shipping >= 0),
  paid_price    boolean not null default false,
  paid_shipping boolean not null default false,
  arrived       boolean not null default false,
  arrived_at    timestamptz,
  image_path    text,
  created_at    timestamptz not null default now()
);
create index if not exists cards_user_idx on public.cards (user_id, created_at desc);

-- 1b) Categorias de compra: Individual ou CEG, Nacional ou Internacional.
--     shipping            = frete da GOM até você (todas as categorias)
--     shipping_to_gom     = frete até a GOM (Individual Internacional e CEG); na CEG, só a sua parte
--     import_tax          = taxa de importação, opcional (Internacional); na CEG, só a sua parte
--     Cards antigos ficam como Individual Nacional.
alter table public.cards
  add column if not exists purchase_type        text not null default 'individual',
  add column if not exists origin               text not null default 'nacional',
  add column if not exists shipping_to_gom      numeric(10,2) not null default 0,
  add column if not exists import_tax           numeric(10,2) not null default 0,
  add column if not exists paid_shipping_to_gom boolean not null default false,
  add column if not exists paid_tax             boolean not null default false;
alter table public.cards
  drop constraint if exists cards_purchase_type_check,
  add constraint cards_purchase_type_check check (purchase_type in ('individual', 'ceg')),
  drop constraint if exists cards_origin_check,
  add constraint cards_origin_check check (origin in ('nacional', 'internacional')),
  drop constraint if exists cards_extra_values_check,
  add constraint cards_extra_values_check check (shipping_to_gom >= 0 and import_tax >= 0);

-- 1b2) Presente: card sem custo nenhum, que vai direto para a Chegada.
alter table public.cards add column if not exists gift boolean not null default false;

-- 1c) Grupos: vários cards da mesma compra.
--     Os fretes e a taxa ficam no grupo e contam uma vez só, não importa quantos cards ele tenha.
--     Num card com grupo, valem só o preço e o "preço pago" do card; os fretes próprios dele
--     ficam guardados (voltam a contar se ele sair do grupo).
--     Apagar um grupo não apaga os cards: eles só ficam sem grupo.
--     Cards antigos continuam sem grupo, com os próprios fretes.
create table if not exists public.card_groups (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                 text not null check (char_length(name) between 1 and 80),
  purchase_type        text not null default 'individual' check (purchase_type in ('individual', 'ceg')),
  origin               text not null default 'nacional' check (origin in ('nacional', 'internacional')),
  shipping             numeric(10,2) not null default 0 check (shipping >= 0),
  shipping_to_gom      numeric(10,2) not null default 0 check (shipping_to_gom >= 0),
  import_tax           numeric(10,2) not null default 0 check (import_tax >= 0),
  paid_shipping        boolean not null default false,
  paid_shipping_to_gom boolean not null default false,
  paid_tax             boolean not null default false,
  created_at           timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists card_groups_user_idx on public.card_groups (user_id, created_at desc);

-- o card só pode entrar num grupo do mesmo dono; apagar o grupo só tira o card dele
alter table public.cards add column if not exists group_id uuid;
alter table public.cards
  drop constraint if exists cards_group_fk,
  add constraint cards_group_fk foreign key (group_id, user_id)
    references public.card_groups (id, user_id) on delete set null (group_id);
create index if not exists cards_group_idx on public.cards (group_id);

-- 1d) Binder e Wishlist (2026-11).
--     kind = modalidade do card: 'compra' (tem valores e entra nos totais), 'binder' (card que você
--     já tem, sem valores) ou 'wishlist' (card que você quer). Cards antigos ficam como compra.
--     A situação continua calculada pelo app: wishlist = desejado; binder = na coleção;
--     compra = Pagamento, Chegada ou na coleção (pelo "Chegou").
--     wished_at    = quando entrou na Wishlist (fica guardado depois que o card é adquirido)
--     artist       = grupo de K-pop (aespa, TWICE…); cards antigos ficam sem
--     purchased_on = data da compra; cards antigos recebem a data em que foram cadastrados
--     expected_on  = previsão de chegada, opcional
--     folder_id    = pasta do Binder ou da Wishlist
--     in_binder    = false quando a pessoa tira o card do Binder mas quer manter a compra
alter table public.cards
  add column if not exists kind         text not null default 'compra',
  add column if not exists wished_at    timestamptz,
  add column if not exists artist       text,
  add column if not exists purchased_on date,
  add column if not exists expected_on  date,
  add column if not exists folder_id    uuid,
  add column if not exists in_binder    boolean not null default true;
update public.cards
   set purchased_on = (created_at at time zone 'America/Sao_Paulo')::date
 where purchased_on is null and kind = 'compra';
alter table public.cards alter column purchased_on set default current_date;
alter table public.cards
  drop constraint if exists cards_kind_check,
  add constraint cards_kind_check check (kind in ('compra', 'binder', 'wishlist')),
  drop constraint if exists cards_artist_check,
  add constraint cards_artist_check check (artist is null or char_length(artist) <= 60),
  -- card de Binder ou Wishlist nunca tem valores nem pedido: não mexe nos totais
  drop constraint if exists cards_no_money_check,
  add constraint cards_no_money_check check (
    kind = 'compra' or (price = 0 and shipping = 0 and shipping_to_gom = 0 and import_tax = 0 and group_id is null));
create index if not exists cards_kind_idx on public.cards (user_id, kind);

-- pastas: cada uma é do Binder ou da Wishlist; apagar a pasta só deixa os cards sem pasta
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  scope      text not null default 'binder' check (scope in ('binder', 'wishlist')),
  name       text not null check (char_length(name) between 1 and 60),
  cover_path text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists folders_user_idx on public.folders (user_id, scope, position);
alter table public.cards
  drop constraint if exists cards_folder_fk,
  add constraint cards_folder_fk foreign key (folder_id, user_id)
    references public.folders (id, user_id) on delete set null (folder_id);
create index if not exists cards_folder_idx on public.cards (folder_id);

-- 1e) Perfis (2026-11): cada conta tem um perfil com @username único.
--     O perfil mostra só o que é da coleção: nunca valores, vendedor, pedidos ou datas de compra.
--     username            = de 3 a 20 caracteres: letras minúsculas, números, ponto e sublinhado
--     binder_visibility   = quem vê o Binder no perfil: 'todos' ou 'so_eu'
--     wishlist_visibility = o mesmo para a Wishlist
--     avatar_path         = foto de perfil, sempre na pasta <conta>/perfil/ do próprio dono
create table if not exists public.profiles (
  id                  uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  username            text not null,
  display_name        text not null,
  avatar_path         text,
  favorite_groups     text[] not null default '{}',
  binder_visibility   text not null default 'todos',
  wishlist_visibility text not null default 'todos',
  created_at          timestamptz not null default now()
);
alter table public.profiles
  drop constraint if exists profiles_username_check,
  add constraint profiles_username_check check (
    username ~ '^[a-z0-9._]{3,20}$'
    and username !~ '^[.]|[.]$|[.][.]'
    and username not in ('admin', 'administrador', 'suporte', 'support', 'popcollection', 'pop.collection', 'pop_collection', 'perfil', 'busca', 'colecionadores', 'null', 'undefined')),
  drop constraint if exists profiles_display_name_check,
  add constraint profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 40),
  drop constraint if exists profiles_groups_check,
  add constraint profiles_groups_check check (cardinality(favorite_groups) <= 5 and char_length(array_to_string(favorite_groups, ',')) <= 310),
  drop constraint if exists profiles_avatar_check,
  add constraint profiles_avatar_check check (avatar_path is null or avatar_path like id::text || '/perfil/%'),
  drop constraint if exists profiles_visibility_check,
  add constraint profiles_visibility_check check (
    binder_visibility in ('todos', 'so_eu') and wishlist_visibility in ('todos', 'so_eu'));
create unique index if not exists profiles_username_key on public.profiles (lower(username));

-- 1f) Seguidores: "A segue B". Não precisa ser recíproco; ninguém segue a si mesmo nem duas vezes.
create table if not exists public.follows (
  follower_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id, created_at desc);

-- 2) Total já gasto com coleções apagadas (para o "total gasto" não zerar)
create table if not exists public.stats (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  archived_total numeric(12,2) not null default 0,
  archived_count integer not null default 0
);

-- 3) Segurança: cada usuário só lê e altera os próprios dados
alter table public.cards enable row level security;
alter table public.stats enable row level security;
alter table public.card_groups enable row level security;
alter table public.folders enable row level security;
alter table public.profiles enable row level security;
alter table public.follows enable row level security;

drop policy if exists "cards do dono" on public.cards;
create policy "cards do dono" on public.cards
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "grupos do dono" on public.card_groups;
create policy "grupos do dono" on public.card_groups
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "pastas do dono" on public.folders;
create policy "pastas do dono" on public.folders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- perfis: quem está logado vê nome, @username e foto; só o dono cria e altera o seu
drop policy if exists "perfis: ver" on public.profiles;
create policy "perfis: ver" on public.profiles
  for select to authenticated
  using (true);

drop policy if exists "perfis: criar o meu" on public.profiles;
create policy "perfis: criar o meu" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists "perfis: alterar o meu" on public.profiles;
create policy "perfis: alterar o meu" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- seguidores: quem está logado vê as listas; só quem segue cria ou desfaz
drop policy if exists "seguir: ver" on public.follows;
create policy "seguir: ver" on public.follows
  for select to authenticated
  using (true);

drop policy if exists "seguir: eu sigo" on public.follows;
create policy "seguir: eu sigo" on public.follows
  for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists "seguir: deixar de seguir" on public.follows;
create policy "seguir: deixar de seguir" on public.follows
  for delete to authenticated
  using (follower_id = auth.uid());

drop policy if exists "stats do dono" on public.stats;
create policy "stats do dono" on public.stats
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4) Apagar coleção (antigo; o app não usa mais desde o Binder): soma o valor no histórico e apaga os cards que chegaram.
--    Num card com grupo conta só o preço; os fretes e a taxa do grupo entram no histórico
--    quando todos os cards do grupo saem junto (aí o grupo, vazio, também é apagado).
--    Devolve os caminhos das fotos para o app apagar do Storage.
create or replace function public.clear_collection()
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total  numeric(12,2);
  v_count  integer;
  v_paths  text[];
  v_groups uuid[];
  v_fees   numeric(12,2);
begin
  select coalesce(sum(price + case when group_id is null then shipping + shipping_to_gom + import_tax else 0 end), 0),
         count(*),
         coalesce(array_agg(image_path) filter (where image_path is not null), '{}')
    into v_total, v_count, v_paths
    from cards
   where user_id = auth.uid() and kind = 'compra' and arrived;

  if v_count = 0 then
    return '{}';
  end if;

  -- grupos em que todos os cards chegaram
  select coalesce(array_agg(g.id), '{}'), coalesce(sum(g.shipping + g.shipping_to_gom + g.import_tax), 0)
    into v_groups, v_fees
    from card_groups g
   where g.user_id = auth.uid()
     and exists (select 1 from cards c where c.group_id = g.id and c.kind = 'compra' and c.arrived)
     and not exists (select 1 from cards c where c.group_id = g.id and not c.arrived);

  insert into stats (user_id, archived_total, archived_count)
  values (auth.uid(), v_total + v_fees, v_count)
  on conflict (user_id) do update
    set archived_total = stats.archived_total + excluded.archived_total,
        archived_count = stats.archived_count + excluded.archived_count;

  delete from cards where user_id = auth.uid() and kind = 'compra' and arrived;
  delete from card_groups where user_id = auth.uid() and id = any (v_groups);
  return v_paths;
end;
$$;

revoke all on function public.clear_collection() from public, anon;
grant execute on function public.clear_collection() to authenticated;

-- 5) Fotos: bucket privado, cada usuário só mexe na própria pasta (<user_id>/arquivo.jpg)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photocards', 'photocards', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "fotos: ler as minhas" on storage.objects;
create policy "fotos: ler as minhas" on storage.objects
  for select to authenticated
  using (bucket_id = 'photocards' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: enviar na minha pasta" on storage.objects;
create policy "fotos: enviar na minha pasta" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photocards' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: apagar as minhas" on storage.objects;
create policy "fotos: apagar as minhas" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photocards' and (storage.foldername(name))[1] = auth.uid()::text);
