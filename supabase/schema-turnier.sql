-- ============================================================================
-- Tischtennis-Turnier (privat, Geburtstag) — Tabelle + Funktionen für turnier.html
-- ============================================================================
-- Einmalig im Supabase SQL-Editor ausführen. VORHER unten die PIN für die
-- Turnierleitung anpassen (Zeile mit 'HIER-PIN-EINTRAGEN')!
--
-- Sicherheitsmodell:
--   * Jeder (auch ohne Login) darf das Turnier LESEN (Spieler, Teams,
--     Spielplan, Ergebnisse) — die Seite ist bewusst öffentlich.
--   * Jeder darf ERGEBNISSE eintragen/korrigieren — aber nur über die Funktion
--     turnier_ergebnis_setzen(), die Werte prüft (keine beliebigen Daten).
--   * Spieler/Spielstärken/Teams ändern geht nur über
--     turnier_admin_speichern() mit der PIN der Turnierleitung. Die PIN liegt
--     als bcrypt-Hash in turnier_admin — diese Tabelle ist für anon/
--     authenticated komplett unlesbar.
--   * Direktes INSERT/UPDATE/DELETE auf die Tabellen ist für niemanden
--     außer dem Datenbank-Owner erlaubt (keine Policies dafür).
--
-- Nach dem Turnier aufräumen:  drop table public.turnier, public.turnier_admin cascade;
--   (die Funktionen danach mit drop function ... ebenfalls entfernen, siehe Ende)
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.turnier (
  id          text primary key,
  setup       jsonb not null default '{}'::jsonb,
  results     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint turnier_setup_groesse   check (pg_column_size(setup)   < 100000),
  constraint turnier_results_groesse check (pg_column_size(results) < 100000)
);

create table if not exists public.turnier_admin (
  turnier_id  text primary key references public.turnier(id) on delete cascade,
  pin_hash    text not null
);

alter table public.turnier       enable row level security;
alter table public.turnier_admin enable row level security;

-- Lesen: öffentlich
drop policy if exists "turnier_select_public" on public.turnier;
create policy "turnier_select_public"
  on public.turnier for select
  to anon, authenticated
  using (true);
-- turnier_admin bekommt bewusst KEINE Policy -> für anon/authenticated unsichtbar.

revoke all on public.turnier_admin from anon, authenticated;
revoke insert, update, delete on public.turnier from anon, authenticated;
grant select on public.turnier to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ergebnis setzen/löschen (für alle)
--   p_match: Spiel-ID aus dem Spielplan, z. B. "r1m2" oder "f1"
--   p_a/p_b: gewonnene Sätze Team A / Team B; beide NULL = Ergebnis löschen
-- ---------------------------------------------------------------------------
create or replace function public.turnier_ergebnis_setzen(
  p_turnier text, p_match text, p_a int, p_b int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_results jsonb;
begin
  if p_match is null or p_match !~ '^[a-z0-9]{1,12}$' then
    raise exception 'ungueltige Spiel-ID';
  end if;

  if p_a is null and p_b is null then
    update public.turnier
       set results = results - p_match, updated_at = now()
     where id = p_turnier
    returning results into v_results;
  else
    if p_a is null or p_b is null or p_a < 0 or p_b < 0 or p_a > 9 or p_b > 9 or p_a = p_b then
      raise exception 'ungueltiges Ergebnis';
    end if;
    update public.turnier
       set results = jsonb_set(results, array[p_match],
                               jsonb_build_object('a', p_a, 'b', p_b, 'at', now())),
           updated_at = now()
     where id = p_turnier
    returning results into v_results;
  end if;

  if v_results is null then
    raise exception 'Turnier nicht gefunden';
  end if;
  return v_results;
end;
$$;

-- ---------------------------------------------------------------------------
-- Setup speichern (nur Turnierleitung, mit PIN)
--   p_setup:          komplettes Setup-Objekt (Spieler, Teams, Spielplan, Einstellungen)
--   p_reset_results:  true = alle Ergebnisse löschen (z. B. nach neuer Team-Auslosung)
--   p_setup = NULL    -> nur PIN prüfen (Login-Check), nichts ändern
-- ---------------------------------------------------------------------------
create or replace function public.turnier_admin_speichern(
  p_turnier text, p_pin text, p_setup jsonb, p_reset_results boolean default false
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select pin_hash into v_hash from public.turnier_admin where turnier_id = p_turnier;
  if v_hash is null or p_pin is null or extensions.crypt(p_pin, v_hash) <> v_hash then
    perform pg_sleep(1);  -- bremst Durchprobieren
    raise exception 'falsche PIN';
  end if;

  if p_setup is not null then
    if jsonb_typeof(p_setup) <> 'object' then
      raise exception 'ungueltiges Setup';
    end if;
    update public.turnier
       set setup = p_setup,
           results = case when p_reset_results then '{}'::jsonb else results end,
           updated_at = now()
     where id = p_turnier;
  end if;
  return true;
end;
$$;

revoke all on function public.turnier_ergebnis_setzen(text, text, int, int) from public;
revoke all on function public.turnier_admin_speichern(text, text, jsonb, boolean) from public;
grant execute on function public.turnier_ergebnis_setzen(text, text, int, int) to anon, authenticated;
grant execute on function public.turnier_admin_speichern(text, text, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Das Turnier anlegen + PIN setzen.  >>> PIN HIER ANPASSEN (mind. 6 Zeichen) <<<
-- ---------------------------------------------------------------------------
insert into public.turnier (id) values ('geburtstag') on conflict (id) do nothing;
insert into public.turnier_admin (turnier_id, pin_hash)
values ('geburtstag', extensions.crypt('HIER-PIN-EINTRAGEN', extensions.gen_salt('bf')))
on conflict (turnier_id) do update set pin_hash = excluded.pin_hash;

-- ---------------------------------------------------------------------------
-- Aufräumen nach dem Turnier (bei Bedarf einzeln ausführen):
--   drop function if exists public.turnier_ergebnis_setzen(text, text, int, int);
--   drop function if exists public.turnier_admin_speichern(text, text, jsonb, boolean);
--   drop table if exists public.turnier_admin, public.turnier cascade;
-- ---------------------------------------------------------------------------
