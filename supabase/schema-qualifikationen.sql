-- BETAMOVE — Qualifikationen aus der Datenbank statt fester Liste in js/account.js
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-pruefungen-zertifikate.sql
-- und schema-kursverwaltung.sql auf (müssen vorher gelaufen sein).
--
-- Bisher stand fest im Code (js/account.js), welche Artikel/Quiz/Prüfung zu
-- welcher Qualifikation (z.B. "Freigabe Naturfels") gehören. Ab jetzt kannst
-- du das im Adminbereich (admin-qualifikationen) selbst zusammenstellen:
--
--   1) `lerninhalte` — Katalog aller Artikel/Quiz/Prüfungen, die zugeordnet
--      werden können (an echte Seiten gebunden, deshalb kein "neuer Inhalt"
--      ohne Code — aber frei wiederverwendbar über beliebig viele
--      Qualifikationen hinweg, statt dupliziert zu werden).
--   2) `qualifikationen` — die Qualifikationen selbst (Name, Level, Text).
--   3) `qualifikation_anforderungen` — welche lerninhalte (oder welcher Kurs)
--      zu welcher Qualifikation gehören.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar — die Seed-Daten
-- unten (bisherige 4 Qualifikationen + ihre Anforderungen) werden nur beim
-- ersten Mal eingefügt, spätere Bearbeitungen im Adminbereich werden also
-- nie überschrieben.
-- ============================================================================


-- ============================================================================
-- 1) lerninhalte — Katalog aller Artikel/Quiz/Prüfungen
-- ============================================================================

create table if not exists public.lerninhalte (
  id    text primary key,
  kind  text not null,
  label text not null,
  url   text not null,

  constraint lerninhalte_id_len check (char_length(id) between 1 and 80),
  constraint lerninhalte_kind_val check (kind in ('artikel', 'quiz', 'pruefung'))
);

comment on table public.lerninhalte is 'Katalog aller Artikel/Quiz/Prüfungen, die einer Qualifikation als Anforderung zugeordnet werden können';

alter table public.lerninhalte enable row level security;

drop policy if exists "lerninhalte_select_all" on public.lerninhalte;
create policy "lerninhalte_select_all"
  on public.lerninhalte for select
  to anon, authenticated
  using (true);

drop policy if exists "lerninhalte_admin_insert" on public.lerninhalte;
create policy "lerninhalte_admin_insert"
  on public.lerninhalte for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "lerninhalte_admin_update" on public.lerninhalte;
create policy "lerninhalte_admin_update"
  on public.lerninhalte for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "lerninhalte_admin_delete" on public.lerninhalte;
create policy "lerninhalte_admin_delete"
  on public.lerninhalte for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

insert into public.lerninhalte (id, kind, label, url) values
  ('bouldern-ohne-verletzung', 'artikel', 'Artikel „Bouldern ohne Verletzung“ durcharbeiten', 'artikel-bouldern-ohne-verletzung'),
  ('erste-hilfe-fels', 'artikel', 'Artikel „Erste Hilfe am Fels“ durcharbeiten', 'artikel-erste-hilfe-fels'),
  ('gardasee', 'artikel', 'Artikel „Kletterurlaub am Gardasee“ durcharbeiten', 'artikel-gardasee'),
  ('halle-an-den-fels', 'artikel', 'Artikel „Halle an den Fels“ durcharbeiten', 'artikel-halle-an-den-fels'),
  ('kletterschuhe-finden', 'artikel', 'Artikel „Kletterschuhe finden“ lesen', 'artikel-kletterschuhe-finden'),
  ('kletterverletzungen', 'artikel', 'Artikel „Kletterverletzungen“ durcharbeiten', 'artikel-kletterverletzungen'),
  ('mehrseillaengen-taktik', 'artikel', 'Artikel „Richtig Mehrseillängen planen“ durcharbeiten', 'artikel-mehrseillaengen-taktik'),
  ('projektieren', 'artikel', 'Artikel „Kletterrouten projektieren“ durcharbeiten', 'artikel-projektieren'),
  ('psa-pflege', 'artikel', 'Artikel „PSA und ihre Pflege“ durcharbeiten', 'artikel-psa-pflege'),
  ('sardinien', 'artikel', 'Artikel „Kletterurlaub auf Sardinien“ durcharbeiten', 'artikel-sardinien'),
  ('sicherungsgeraete', 'artikel', 'Artikel „Sicherungsgeräte im Überblick“ durcharbeiten', 'artikel-sicherungsgeraete'),
  ('quiz-fels', 'quiz', 'Quiz „Der erste Tag am Fels“ bestehen', 'quiz-fels'),
  ('quiz-sichern', 'quiz', 'Quiz „Sichern ohne Mythen“ bestehen', 'quiz-sichern'),
  ('pruefung-mehrseillaengen', 'pruefung', 'Online-Prüfung Mehrseillängen bestehen', 'pruefung-mehrseillaengen'),
  ('pruefung-naturfels', 'pruefung', 'Online-Prüfung Naturfels bestehen', 'pruefung-naturfels'),
  ('pruefung-sicherungsschein', 'pruefung', 'Online-Prüfung Sicherungstheorie bestehen', 'pruefung-sicherungsschein'),
  ('pruefung-sturztraining', 'pruefung', 'Online-Prüfung Sturz- und Sicherungstraining bestehen', 'pruefung-sturztraining')
on conflict (id) do nothing;


-- ============================================================================
-- 2) qualifikationen
-- ============================================================================

create table if not exists public.qualifikationen (
  id         text primary key,
  name       text not null,
  level      text not null,
  text       text,
  sort_order int not null default 0,
  aktiv      boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint qualifikationen_id_len check (char_length(id) between 1 and 80)
);

comment on table public.qualifikationen is 'Qualifikationen (z.B. "Freigabe Naturfels") — Anforderungen dazu stehen in qualifikation_anforderungen';
comment on column public.qualifikationen.aktiv is 'Nur aktive Qualifikationen erscheinen in Konto/Zertifikat — zum Offline-Nehmen auf false setzen';

-- set_updated_at() existiert bereits (siehe schema-kursverwaltung.sql),
-- "create or replace" hier nur zur Absicherung, falls diese Datei zuerst läuft.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists qualifikationen_set_updated_at on public.qualifikationen;
create trigger qualifikationen_set_updated_at
  before update on public.qualifikationen
  for each row execute function public.set_updated_at();

alter table public.qualifikationen enable row level security;

drop policy if exists "qualifikationen_select_active" on public.qualifikationen;
create policy "qualifikationen_select_active"
  on public.qualifikationen for select
  to anon, authenticated
  using (aktiv = true);

drop policy if exists "qualifikationen_admin_select" on public.qualifikationen;
create policy "qualifikationen_admin_select"
  on public.qualifikationen for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "qualifikationen_admin_insert" on public.qualifikationen;
create policy "qualifikationen_admin_insert"
  on public.qualifikationen for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "qualifikationen_admin_update" on public.qualifikationen;
create policy "qualifikationen_admin_update"
  on public.qualifikationen for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "qualifikationen_admin_delete" on public.qualifikationen;
create policy "qualifikationen_admin_delete"
  on public.qualifikationen for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

insert into public.qualifikationen (id, name, level, text, sort_order) values
  ('sicherungsschein-toprope', 'Sicherungsschein Toprope', 'Einstieg', 'Sicher Toprope sichern, weich fangen und Gewichtsunterschiede einschätzen – die Basis für alles Weitere.', 1),
  ('vorstiegsschein-indoor', 'Vorstiegsschein Indoor', 'Einstieg', 'Im Vorstieg klettern und sichern in der Halle, auf aktuellem Stand der Lehrmeinung.', 2),
  ('freigabe-naturfels', 'Freigabe Naturfels', 'Aufbau', 'Der erste Schritt vom Hallen- ins Felsklettern, mit dem richtigen Material im Rucksack.', 3),
  ('mehrseillaengen-kompetenz', 'Mehrseillängen-Kompetenz', 'Fortgeschritten', 'Sicher unterwegs auf mehreren Seillängen – Standplatzbau und Taktik inklusive.', 4)
on conflict (id) do nothing;


-- ============================================================================
-- 3) qualifikation_anforderungen — welcher Lerninhalt/Kurs zu welcher
--    Qualifikation gehört
-- ============================================================================
-- kind = 'kurs': ref_id ist "kurs-<kurse.id>" (z.B. "kurs-sturz" für den Kurs
-- mit der id "sturz" in der Tabelle `kurse`) — dieselbe Konvention, die schon
-- für den admin-bestätigten Buchungsstatus in lernfortschritt verwendet wird.
-- kind = 'artikel'/'quiz'/'pruefung': ref_id verweist auf lerninhalte.id.

create table if not exists public.qualifikation_anforderungen (
  id               uuid primary key default gen_random_uuid(),
  qualifikation_id text not null references public.qualifikationen(id) on delete cascade,
  kind             text not null,
  ref_id           text not null,
  sort_order       int not null default 0,

  constraint qualifikation_anforderungen_kind_val check (kind in ('artikel', 'quiz', 'pruefung', 'kurs')),
  unique (qualifikation_id, kind, ref_id)
);

comment on table public.qualifikation_anforderungen is 'Zuordnung: welcher Lerninhalt oder Kurs zu welcher Qualifikation gehört';

alter table public.qualifikation_anforderungen enable row level security;

drop policy if exists "qualifikation_anforderungen_select_all" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_select_all"
  on public.qualifikation_anforderungen for select
  to anon, authenticated
  using (true);

drop policy if exists "qualifikation_anforderungen_admin_insert" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_admin_insert"
  on public.qualifikation_anforderungen for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "qualifikation_anforderungen_admin_update" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_admin_update"
  on public.qualifikation_anforderungen for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "qualifikation_anforderungen_admin_delete" on public.qualifikation_anforderungen;
create policy "qualifikation_anforderungen_admin_delete"
  on public.qualifikation_anforderungen for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

insert into public.qualifikation_anforderungen (qualifikation_id, kind, ref_id, sort_order) values
  ('sicherungsschein-toprope', 'quiz', 'quiz-sichern', 1),
  ('sicherungsschein-toprope', 'pruefung', 'pruefung-sturztraining', 2),
  ('sicherungsschein-toprope', 'kurs', 'kurs-sturz', 3),

  ('vorstiegsschein-indoor', 'pruefung', 'pruefung-sicherungsschein', 1),
  ('vorstiegsschein-indoor', 'artikel', 'sicherungsgeraete', 2),
  ('vorstiegsschein-indoor', 'kurs', 'kurs-update', 3),

  ('freigabe-naturfels', 'artikel', 'halle-an-den-fels', 1),
  ('freigabe-naturfels', 'quiz', 'quiz-fels', 2),
  ('freigabe-naturfels', 'artikel', 'kletterschuhe-finden', 3),
  ('freigabe-naturfels', 'pruefung', 'pruefung-naturfels', 4),
  ('freigabe-naturfels', 'kurs', 'kurs-halle', 5),

  ('mehrseillaengen-kompetenz', 'artikel', 'mehrseillaengen-taktik', 1),
  ('mehrseillaengen-kompetenz', 'pruefung', 'pruefung-mehrseillaengen', 2),
  ('mehrseillaengen-kompetenz', 'kurs', 'kurs-msl', 3)
on conflict (qualifikation_id, kind, ref_id) do nothing;


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> lerninhalte: 17 Zeilen. qualifikationen: 4 Zeilen.
-- qualifikation_anforderungen: 14 Zeilen. Alle drei mit RLS enabled.
-- ============================================================================
