-- BETAMOVE — Schema-Erweiterung für Prüfungs-Freischaltung + Zertifikate
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql und schema-admin-kommentare.sql auf
-- (müssen vorher gelaufen sein).
--
-- Dieses Skript fügt hinzu:
--
--   1) `kursanmeldungen.kurs_datum` — das Kursdatum wird beim Buchen direkt
--      mit in die Buchung geschrieben (statt später aus courses-data.js
--      nachzuschlagen), damit ein Zertifikat auch dann noch das richtige
--      Datum zeigt, wenn der Kurstermin inzwischen im Kursplan verändert
--      wurde.
--
--   2) Admin-Leserecht auf `profiles` — die Kursleitung braucht eine Liste
--      aller registrierten Konten, um Prüfungen freizuschalten.
--
--   3) Neue Tabelle `pruefungsfreigaben` — eine Prüfung ist für eine Person
--      erst sichtbar/startbar, wenn die Kursleitung sie dort freigeschaltet
--      hat. Lesen darf jede Person nur den eigenen Freischaltungsstatus,
--      freischalten/sperren darf ausschließlich die Kursleitung.
--
-- WICHTIG: Wie bei schema-admin-kommentare.sql — ersetze jedes Vorkommen von
-- 'noel.uhlrich@gmail.com' durch die tatsächliche Login-Adresse der
-- Kursleitung, falls die nicht (mehr) stimmt. Muss exakt zum ADMIN_EMAIL-Wert
-- in js/account.js, admin-kurse.html und admin-pruefungen.html passen.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) Kursdatum pro Buchung snapshotten
-- ============================================================================

alter table public.kursanmeldungen
  add column if not exists kurs_datum text;

comment on column public.kursanmeldungen.kurs_datum is 'Kursdatum zum Zeitpunkt der Buchung (Snapshot aus courses-data.js), für Zertifikate';


-- ============================================================================
-- 2) Admin darf alle Profile lesen (für die Konten-Auswahl bei Prüfungen)
-- ============================================================================

drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select"
  on public.profiles for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');


-- ============================================================================
-- 3) pruefungsfreigaben — Prüfung erst nach Freischaltung durch Kursleitung
-- ============================================================================

create table if not exists public.pruefungsfreigaben (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  pruefung_id text not null,
  created_at  timestamptz not null default now(),

  constraint pruefungsfreigaben_pruefung_id_len check (char_length(pruefung_id) between 1 and 80),
  unique (user_id, pruefung_id)
);

comment on table public.pruefungsfreigaben is 'Welche Person welche Online-Prüfung ablegen darf — freigeschaltet von der Kursleitung';

alter table public.pruefungsfreigaben enable row level security;

-- Eigene Freischaltungen lesen (um zu prüfen, ob die Prüfung startbar ist).
drop policy if exists "pruefungsfreigaben_select_own" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_select_own"
  on public.pruefungsfreigaben for select
  to authenticated
  using (auth.uid() = user_id);

-- Kursleitung darf alle Freischaltungen lesen, anlegen und wieder entfernen
-- (Freischaltung zurücknehmen = Zeile löschen).
drop policy if exists "pruefungsfreigaben_admin_select" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_admin_select"
  on public.pruefungsfreigaben for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "pruefungsfreigaben_admin_insert" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_admin_insert"
  on public.pruefungsfreigaben for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "pruefungsfreigaben_admin_delete" on public.pruefungsfreigaben;
create policy "pruefungsfreigaben_admin_delete"
  on public.pruefungsfreigaben for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> kursanmeldungen: neue Spalte kurs_datum.
-- Table Editor -> profiles: Reiter "Policies" zeigt zusätzlich
-- profiles_admin_select.
-- Table Editor -> pruefungsfreigaben: neue Tabelle mit RLS enabled und vier
-- Policies.
-- ============================================================================
