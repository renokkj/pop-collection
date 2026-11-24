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

drop policy if exists "stats do dono" on public.stats;
create policy "stats do dono" on public.stats
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4) Apagar coleção: soma o valor no histórico e apaga os cards que chegaram.
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
   where user_id = auth.uid() and arrived;

  if v_count = 0 then
    return '{}';
  end if;

  -- grupos em que todos os cards chegaram
  select coalesce(array_agg(g.id), '{}'), coalesce(sum(g.shipping + g.shipping_to_gom + g.import_tax), 0)
    into v_groups, v_fees
    from card_groups g
   where g.user_id = auth.uid()
     and exists (select 1 from cards c where c.group_id = g.id and c.arrived)
     and not exists (select 1 from cards c where c.group_id = g.id and not c.arrived);

  insert into stats (user_id, archived_total, archived_count)
  values (auth.uid(), v_total + v_fees, v_count)
  on conflict (user_id) do update
    set archived_total = stats.archived_total + excluded.archived_total,
        archived_count = stats.archived_count + excluded.archived_count;

  delete from cards where user_id = auth.uid() and arrived;
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
