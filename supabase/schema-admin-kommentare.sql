-- BETAMOVE — Schema-Erweiterung für Kursbestätigung durch die Kursleitung +
-- Kommentare unter Wissensartikeln
-- ============================================================================
-- Baut auf schema.sql und schema-konten.sql auf (müssen vorher gelaufen sein).
--
-- Dieses Skript ändert zwei Dinge am bisherigen Konto-Konzept:
--
--   1) Kursteilnahme wird nicht mehr von der Person selbst umgeschaltet,
--      sondern von der Kursleitung bestätigt — neue Spalten direkt auf
--      kursanmeldungen (funktioniert so auch für Buchungen ohne Konto).
--      Dafür bekommt die Kursleitung (siehe ADMIN_EMAIL unten) zusätzliche
--      Policies, um ALLE Buchungen zu sehen und die Bestätigung zu setzen.
--
--   2) Neue Tabelle `kommentare` für "Fragen & Kommentare" unter den
--      Wissensartikeln.
--
-- WICHTIG: Ersetze unten jedes Vorkommen von 'noel.uhlrich@gmail.com' durch
-- die E-Mail-Adresse, mit der die Kursleitung ihr eigenes BETAMOVE-Lernkonto
-- einloggt (nicht die alte Gmail-Weiterleitung — die tatsächliche Login-
-- Adresse). Diese Adresse ist exakt der ADMIN_EMAIL-Wert in js/account.js
-- und admin-kurse.html — beide Stellen müssen übereinstimmen, sonst sieht
-- die Kursleitung im Dashboard die Buchungen, aber admin-kurse.html zeigt
-- "nicht berechtigt" (oder umgekehrt).
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) Kursbestätigung durch die Kursleitung
-- ============================================================================

alter table public.kursanmeldungen
  add column if not exists teilnahme_bestaetigt boolean not null default false,
  add column if not exists teilnahme_bestaetigt_at timestamptz;

comment on column public.kursanmeldungen.teilnahme_bestaetigt is 'Von der Kursleitung bestätigt (nicht selbst von der teilnehmenden Person gesetzt)';

-- Kursleitung darf ALLE Buchungen lesen (nicht nur eigene) — zusätzlich zur
-- bestehenden "kursanmeldungen_select_own"-Policy aus schema-konten.sql.
-- Mehrere permissive Policies für dieselbe Aktion werden von Postgres per
-- OR verknüpft, die bestehende Policy bleibt also unverändert bestehen.
drop policy if exists "kursanmeldungen_admin_select" on public.kursanmeldungen;
create policy "kursanmeldungen_admin_select"
  on public.kursanmeldungen for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

-- Kursleitung darf teilnahme_bestaetigt (und *_at) auf JEDER Buchung ändern.
drop policy if exists "kursanmeldungen_admin_update" on public.kursanmeldungen;
create policy "kursanmeldungen_admin_update"
  on public.kursanmeldungen for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');


-- ============================================================================
-- 2) kommentare — "Fragen & Kommentare" unter Wissensartikeln
-- ============================================================================
-- Der Name der kommentierenden Person wird beim Schreiben direkt mit in die
-- Zeile gespeichert (autor_name) statt über die user_id aus `profiles`
-- nachgeladen zu werden — `profiles` ist bewusst nur für die eigene Person
-- lesbar (siehe schema-konten.sql), fremde Profile sollen nicht pauschal für
-- alle eingeloggten Personen sichtbar werden.

create table if not exists public.kommentare (
  id          uuid primary key default gen_random_uuid(),
  artikel_id  text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  autor_name  text not null,
  text        text not null,
  created_at  timestamptz not null default now(),

  constraint kommentare_artikel_id_len check (char_length(artikel_id) between 1 and 80),
  constraint kommentare_autor_name_len check (char_length(trim(autor_name)) between 1 and 120),
  constraint kommentare_text_len check (char_length(trim(text)) between 1 and 2000)
);

comment on table public.kommentare is 'Fragen & Kommentare unter Wissensartikeln, sichtbar für alle, schreibbar nur eingeloggt';

alter table public.kommentare enable row level security;

-- Kommentare sind öffentlich lesbar (auch ohne Konto) — passend zur
-- bisherigen Ankündigung "wir und andere Teilnehmende lesen mit".
drop policy if exists "kommentare_select_all" on public.kommentare;
create policy "kommentare_select_all"
  on public.kommentare for select
  to anon, authenticated
  using (true);

-- Schreiben nur eingeloggt, und nur unter der eigenen user_id.
drop policy if exists "kommentare_insert_own" on public.kommentare;
create policy "kommentare_insert_own"
  on public.kommentare for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Eigene Kommentare dürfen wieder gelöscht werden.
drop policy if exists "kommentare_delete_own" on public.kommentare;
create policy "kommentare_delete_own"
  on public.kommentare for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> kursanmeldungen: zwei neue Spalten teilnahme_bestaetigt /
-- teilnahme_bestaetigt_at, Reiter "Policies" zeigt zusätzlich
-- kursanmeldungen_admin_select + kursanmeldungen_admin_update.
-- Table Editor -> kommentare: neue Tabelle mit RLS enabled und drei Policies.
-- ============================================================================
