-- BETAMOVE — Schema-Erweiterung für echte Nutzerkonten
-- ============================================================================
-- Wofür: Baut auf schema.sql auf (dort: kursanmeldungen, kontaktanfragen).
-- Dieses Skript fügt hinzu, was für echte Konten (Login, Profil, gebuchte
-- Kurse ansehen, Quiz-/Prüfungsergebnisse, Qualifikationen) nötig ist:
--
--   1) public.profiles         — ein Profil pro Nutzer*in (Name, E-Mail, Level)
--   2) public.lernfortschritt  — EIN Tabelle für alles, was ein Konto "erledigt"
--                                 haben kann: gelesene Wissensartikel, Quiz- und
--                                 Prüfungsergebnisse, und selbst bestätigte
--                                 Kursteilnahmen ("Teilnahme umschalten").
--   3) kursanmeldungen.user_id — verknüpft eine Kursbuchung optional mit dem
--                                 Konto, über das sie abgeschickt wurde.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Setzt schema.sql voraus (muss vorher
-- schon gelaufen sein). Mehrfach ausführbar (IF NOT EXISTS / DROP POLICY IF
-- EXISTS), falls du später etwas anpassen willst.
--
-- WICHTIG — bevor Konten live gehen, im Supabase-Dashboard einmal prüfen:
-- Authentication -> Providers -> Email muss aktiviert sein (ist es i. d. R.
-- standardmäßig). Ob "Confirm email" an oder aus ist, entscheidet, ob neue
-- Nutzer*innen erst einen Bestätigungslink per Mail anklicken müssen, bevor
-- sie sich einloggen können — Standardeinstellung ist "an".
--
-- Sicherheitsprinzip: Row-Level-Security sorgt dafür, dass jede Person nur
-- ihre eigenen Daten sehen und ändern kann (auth.uid() = die eigene ID).
-- Es gibt bewusst keine Policy, die einer Person fremde Zeilen zeigt — auch
-- nicht "nur lesend". Das gilt auch für dich: im Dashboard (SQL Editor,
-- Table Editor als Projektinhaberin) siehst du trotzdem alles, weil du dort
-- nicht als "authenticated"-Nutzer, sondern mit vollem Datenbankzugriff
-- unterwegs bist.

create extension if not exists pgcrypto;


-- ============================================================================
-- 1) profiles — ein Profil pro registriertem Konto
-- ============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  vorname     text not null,
  nachname    text not null,
  email       text not null,
  level       text,             -- z.B. "Einsteiger*in", "Fortgeschritten" (freiwillige Selbstangabe)
  created_at  timestamptz not null default now(),

  constraint profiles_vorname_len check (char_length(trim(vorname)) between 1 and 100),
  constraint profiles_nachname_len check (char_length(trim(nachname)) between 1 and 100)
);

comment on table public.profiles is 'Ein Profil pro Nutzerkonto (BETAMOVE Lernkonto, Phase 2)';

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Kein DELETE — ein Profil löscht sich automatisch mit (on delete cascade),
-- wenn irgendwann ein Nutzerkonto komplett gelöscht wird.


-- ============================================================================
-- 2) lernfortschritt — gelesene Artikel, Quiz-/Prüfungsergebnisse, Kurse
-- ============================================================================
-- Eine Zeile = "diese Person hat diesen Inhalt erledigt". `item_id` ist die
-- gleiche ID, die das Frontend schon lokal nutzt (z.B. "quiz-sichern",
-- "halle-an-den-fels", "kurs-halle") — siehe js/account.js.

create table if not exists public.lernfortschritt (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     text not null,
  kind        text not null,
  score       int,
  total       int,
  passed      boolean not null default true,
  created_at  timestamptz not null default now(),

  constraint lernfortschritt_kind_val check (kind in ('artikel', 'quiz', 'pruefung', 'kurs')),
  constraint lernfortschritt_item_id_len check (char_length(item_id) <= 80),
  unique (user_id, item_id)
);

comment on table public.lernfortschritt is 'Lernstand pro Nutzerkonto: Artikel gelesen, Quiz/Prüfung bestanden, Kurs (selbst) bestätigt';

alter table public.lernfortschritt enable row level security;

drop policy if exists "lernfortschritt_select_own" on public.lernfortschritt;
create policy "lernfortschritt_select_own"
  on public.lernfortschritt for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "lernfortschritt_insert_own" on public.lernfortschritt;
create policy "lernfortschritt_insert_own"
  on public.lernfortschritt for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "lernfortschritt_update_own" on public.lernfortschritt;
create policy "lernfortschritt_update_own"
  on public.lernfortschritt for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "lernfortschritt_delete_own" on public.lernfortschritt;
create policy "lernfortschritt_delete_own"
  on public.lernfortschritt for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 3) kursanmeldungen — optional mit einem Konto verknüpfen
-- ============================================================================
-- Bleibt weiterhin auch OHNE Konto buchbar (Gäste-Buchung, wie bisher).
-- Ist beim Buchen ein Konto eingeloggt, speichert das Frontend zusätzlich
-- die user_id mit, damit "Meine gebuchten Kurse" im Konto etwas anzeigen kann.

alter table public.kursanmeldungen
  add column if not exists user_id uuid references auth.users(id) on delete set null;

drop policy if exists "kursanmeldungen_insert_only" on public.kursanmeldungen;
create policy "kursanmeldungen_insert_only"
  on public.kursanmeldungen
  for insert
  to anon, authenticated
  with check (
    char_length(trim(vorname)) between 1 and 100
    and char_length(trim(nachname)) between 1 and 100
    and email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and char_length(level) <= 60
    and rabatt_typ in ('none', 'student')
    and (anmerkungen is null or char_length(anmerkungen) <= 2000)
    and agb_akzeptiert = true
    and (user_id is null or user_id = auth.uid())
  );

-- Neu: eingeloggte Nutzer*innen dürfen ihre EIGENEN Buchungen lesen (für
-- "Meine gebuchten Kurse" im Konto). Weiterhin keine Lese-Policy für "anon"
-- oder für fremde user_id-Werte — siehe Sicherheitsprinzip oben in schema.sql.
drop policy if exists "kursanmeldungen_select_own" on public.kursanmeldungen;
create policy "kursanmeldungen_select_own"
  on public.kursanmeldungen for select
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> profiles / lernfortschritt -> Reiter "Policies": beide
-- Tabellen sollten "RLS enabled" zeigen. kursanmeldungen sollte jetzt eine
-- zusätzliche Spalte "user_id" und zwei Policies (Insert + der neue
-- "kursanmeldungen_select_own") haben.
-- ============================================================================
