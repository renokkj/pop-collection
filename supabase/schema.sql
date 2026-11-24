-- Binder de Photocards — estrutura do banco no Supabase
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

-- 2) Total já gasto com coleções apagadas (para o "total gasto" não zerar)
create table if not exists public.stats (
  user_id        uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  archived_total numeric(12,2) not null default 0,
  archived_count integer not null default 0
);

-- 3) Segurança: cada usuário só lê e altera os próprios dados
alter table public.cards enable row level security;
alter table public.stats enable row level security;

drop policy if exists "cards do dono" on public.cards;
create policy "cards do dono" on public.cards
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "stats do dono" on public.stats;
create policy "stats do dono" on public.stats
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 4) Apagar coleção: soma o valor no histórico e apaga os cards que chegaram.
--    Devolve os caminhos das fotos para o app apagar do Storage.
create or replace function public.clear_collection()
returns text[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total numeric(12,2);
  v_count integer;
  v_paths text[];
begin
  select coalesce(sum(price + shipping), 0), count(*),
         coalesce(array_agg(image_path) filter (where image_path is not null), '{}')
    into v_total, v_count, v_paths
    from cards
   where user_id = auth.uid() and arrived;

  if v_count = 0 then
    return '{}';
  end if;

  insert into stats (user_id, archived_total, archived_count)
  values (auth.uid(), v_total, v_count)
  on conflict (user_id) do update
    set archived_total = stats.archived_total + excluded.archived_total,
        archived_count = stats.archived_count + excluded.archived_count;

  delete from cards where user_id = auth.uid() and arrived;
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
