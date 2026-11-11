-- ============================================================================
-- Tischtennis-Turnier v2 — Selbst-Anmeldung (QR-Code), Teamnamen
-- ============================================================================
-- Voraussetzung: supabase/schema-turnier.sql wurde bereits ausgeführt.
-- Diese Datei einmal komplett im Supabase SQL-Editor ausführen (die PIN bleibt
-- unverändert, hier muss nichts angepasst werden).
--
-- Neu:
--   * Tabelle turnier_spieler: Spieler melden sich selbst an (Name + eigene
--     Einschätzung 1–10). Name/Status sind öffentlich lesbar, die SPIELSTÄRKE
--     NICHT (Spaltenrechte) — die sieht nur die Turnierleitung per PIN.
--   * turnier.teamnamen: jedes Team kann sich selbst einen Namen geben.
--   * Spielerverwaltung der Leitung läuft über turnier_admin_spieler() mit PIN.
-- ============================================================================

create table if not exists public.turnier_spieler (
  id          text primary key default gen_random_uuid()::text,
  turnier_id  text not null references public.turnier(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 30),
  skill       int  not null default 5 check (skill between 1 and 10),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists turnier_spieler_name_uniq
  on public.turnier_spieler (turnier_id, lower(name));

alter table public.turnier_spieler enable row level security;
drop policy if exists "turnier_spieler_select_public" on public.turnier_spieler;
create policy "turnier_spieler_select_public"
  on public.turnier_spieler for select
  to anon, authenticated
  using (true);

-- Öffentlich nur diese Spalten — skill bleibt verborgen
revoke all on public.turnier_spieler from anon, authenticated;
grant select (id, turnier_id, name, active, created_at) on public.turnier_spieler to anon, authenticated;

alter table public.turnier add column if not exists teamnamen jsonb not null default '{}'::jsonb;
alter table public.turnier drop constraint if exists turnier_teamnamen_groesse;
alter table public.turnier add constraint turnier_teamnamen_groesse check (pg_column_size(teamnamen) < 20000);

-- Bisher im Setup gespeicherte Spieler (v1) in die neue Tabelle übernehmen
insert into public.turnier_spieler (id, turnier_id, name, skill, active)
select p->>'id', t.id, left(trim(p->>'name'), 30),
       greatest(1, least(10, coalesce((p->>'skill')::int, 5))),
       coalesce((p->>'active')::boolean, true)
  from public.turnier t, jsonb_array_elements(coalesce(t.setup->'players', '[]'::jsonb)) p
 where coalesce(trim(p->>'name'), '') <> ''
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- PIN-Prüfung (intern, nicht öffentlich aufrufbar)
-- ---------------------------------------------------------------------------
create or replace function public.turnier_pin_pruefen(p_turnier text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_hash text;
begin
  select pin_hash into v_hash from public.turnier_admin where turnier_id = p_turnier;
  if v_hash is null or p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    perform pg_sleep(1);
    raise exception 'falsche PIN';
  end if;
end;
$$;
revoke all on function public.turnier_pin_pruefen(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Selbst-Anmeldung (für alle) — nur solange die Teams noch nicht ausgelost sind
-- ---------------------------------------------------------------------------
create or replace function public.turnier_anmelden(p_turnier text, p_name text, p_skill int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setup jsonb;
  v_name  text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 30);
  v_id    text;
begin
  select setup into v_setup from public.turnier where id = p_turnier;
  if not found then raise exception 'Turnier nicht gefunden'; end if;
  if jsonb_array_length(coalesce(v_setup->'teams', '[]'::jsonb)) > 0 then
    raise exception 'Die Teams sind schon ausgelost – bitte bei der Turnierleitung melden';
  end if;
  if v_name = '' then raise exception 'Bitte einen Namen eingeben'; end if;
  if (select count(*) from public.turnier_spieler where turnier_id = p_turnier) >= 40 then
    raise exception 'Turnier ist voll';
  end if;
  begin
    insert into public.turnier_spieler (turnier_id, name, skill)
    values (p_turnier, v_name, greatest(1, least(10, coalesce(p_skill, 5))))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Der Name „%“ ist schon angemeldet', v_name;
  end;
  update public.turnier set updated_at = now() where id = p_turnier;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Teamnamen setzen (für alle; leerer Name = zurücksetzen)
-- ---------------------------------------------------------------------------
create or replace function public.turnier_teamname_setzen(p_turnier text, p_team text, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 30);
begin
  if not exists (
    select 1 from public.turnier t, jsonb_array_elements(coalesce(t.setup->'teams', '[]'::jsonb)) tm
     where t.id = p_turnier and tm->>'id' = p_team
  ) then
    raise exception 'Team nicht gefunden';
  end if;
  update public.turnier
     set teamnamen = case when v_name = '' then teamnamen - p_team
                          else jsonb_set(teamnamen, array[p_team], to_jsonb(v_name)) end,
         updated_at = now()
   where id = p_turnier;
end;
$$;

-- ---------------------------------------------------------------------------
-- Spielerverwaltung der Turnierleitung (mit PIN)
--   p_action: 'list' | 'upsert' | 'delete';  p_player: {id?, name, skill, active}
--   Gibt immer die komplette Spielerliste inkl. Spielstärke zurück.
-- ---------------------------------------------------------------------------
create or replace function public.turnier_admin_spieler(
  p_turnier text, p_pin text, p_action text, p_player jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  perform public.turnier_pin_pruefen(p_turnier, p_pin);

  if p_action = 'upsert' then
    v_name := left(regexp_replace(trim(coalesce(p_player->>'name', '')), '\s+', ' ', 'g'), 30);
    if v_name = '' then raise exception 'Name fehlt'; end if;
    begin
      if p_player->>'id' is not null
         and exists (select 1 from public.turnier_spieler where id = p_player->>'id' and turnier_id = p_turnier) then
        update public.turnier_spieler
           set name = v_name,
               skill = greatest(1, least(10, coalesce((p_player->>'skill')::int, skill))),
               active = coalesce((p_player->>'active')::boolean, active)
         where id = p_player->>'id' and turnier_id = p_turnier;
      else
        insert into public.turnier_spieler (turnier_id, name, skill, active)
        values (p_turnier, v_name,
                greatest(1, least(10, coalesce((p_player->>'skill')::int, 5))),
                coalesce((p_player->>'active')::boolean, true));
      end if;
    exception when unique_violation then
      raise exception 'Der Name „%“ ist schon angemeldet', v_name;
    end;
    update public.turnier set updated_at = now() where id = p_turnier;
  elsif p_action = 'delete' then
    delete from public.turnier_spieler where id = p_player->>'id' and turnier_id = p_turnier;
    update public.turnier set updated_at = now() where id = p_turnier;
  elsif p_action <> 'list' then
    raise exception 'unbekannte Aktion';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'skill', skill, 'active', active) order by created_at, name)
      from public.turnier_spieler where turnier_id = p_turnier
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup speichern (ersetzt v1): beim Zurücksetzen auch die Teamnamen leeren
-- ---------------------------------------------------------------------------
create or replace function public.turnier_admin_speichern(
  p_turnier text, p_pin text, p_setup jsonb, p_reset_results boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.turnier_pin_pruefen(p_turnier, p_pin);
  if p_setup is not null then
    if jsonb_typeof(p_setup) <> 'object' then
      raise exception 'ungueltiges Setup';
    end if;
    update public.turnier
       set setup = p_setup - 'players',
           results   = case when p_reset_results then '{}'::jsonb else results end,
           teamnamen = case when p_reset_results then '{}'::jsonb else teamnamen end,
           updated_at = now()
     where id = p_turnier;
  end if;
  return true;
end;
$$;

revoke all on function public.turnier_anmelden(text, text, int) from public;
revoke all on function public.turnier_teamname_setzen(text, text, text) from public;
revoke all on function public.turnier_admin_spieler(text, text, text, jsonb) from public;
grant execute on function public.turnier_anmelden(text, text, int) to anon, authenticated;
grant execute on function public.turnier_teamname_setzen(text, text, text) to anon, authenticated;
grant execute on function public.turnier_admin_spieler(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.turnier_admin_speichern(text, text, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Aufräumen nach dem Turnier zusätzlich zu den Befehlen in schema-turnier.sql:
--   drop function if exists public.turnier_anmelden(text, text, int);
--   drop function if exists public.turnier_teamname_setzen(text, text, text);
--   drop function if exists public.turnier_admin_spieler(text, text, text, jsonb);
--   drop function if exists public.turnier_pin_pruefen(text, text);
--   drop table if exists public.turnier_spieler cascade;
-- ---------------------------------------------------------------------------
