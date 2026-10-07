-- BETAMOVE — Trainingsbereich (v4): Art, Übungsmaske, Trainingsart, Spezifikationen
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-training.sql,
-- schema-trainingsplan.sql und schema-trainingsplan-v3.sql auf (müssen
-- vorher gelaufen sein).
--
-- Vierter Ausbauschritt — Übung anlegen wird zu einer dreistufigen Auswahl:
--  1) Art (Athletik, Mobilität, Dehnung, Geräte, oder selbst hinzugefügt)
--  2) Übungsmaske (klassisch oder kletterroute — ersetzt die bisherigen
--     Typen "frei"/"fingerkraft", die beide in "klassisch" aufgehen)
--  3) Trainingsart (Maximalkraft, Schnellkraft, Ausdauer, Maximalkraftausdauer)
-- Außerdem: "Griffart" (ein Wert) wird zu "Spezifikationen" (mehrere Werte).
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) trainingsuebung_arten — selbst hinzugefügte Arten (zusätzlich zu den
--    vier fest eingebauten: Athletik, Mobilität, Dehnung, Geräte)
-- ============================================================================

create table if not exists public.trainingsuebung_arten (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),

  constraint trainingsuebung_arten_name_len check (char_length(trim(name)) between 1 and 60)
);

comment on table public.trainingsuebung_arten is 'Selbst hinzugefügte Übungs-Arten, zusätzlich zu den vier eingebauten (Athletik, Mobilität, Dehnung, Geräte)';

create index if not exists trainingsuebung_arten_user_id_idx on public.trainingsuebung_arten (user_id, created_at desc);

alter table public.trainingsuebung_arten enable row level security;

drop policy if exists "trainingsuebung_arten_select_own" on public.trainingsuebung_arten;
create policy "trainingsuebung_arten_select_own"
  on public.trainingsuebung_arten for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsuebung_arten_insert_own" on public.trainingsuebung_arten;
create policy "trainingsuebung_arten_insert_own"
  on public.trainingsuebung_arten for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsuebung_arten_delete_own" on public.trainingsuebung_arten;
create policy "trainingsuebung_arten_delete_own"
  on public.trainingsuebung_arten for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 2) trainingsuebungen erweitern — art, trainingsart, spezifikationen;
--    typ auf nur noch "klassisch" | "kletterroute" umstellen
-- ============================================================================

alter table public.trainingsuebungen add column if not exists art text;
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_art_len;
alter table public.trainingsuebungen add constraint trainingsuebungen_art_len
  check (art is null or char_length(art) <= 60);

alter table public.trainingsuebungen add column if not exists trainingsart text;
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_trainingsart_val;
alter table public.trainingsuebungen add constraint trainingsuebungen_trainingsart_val
  check (trainingsart is null or trainingsart in ('maximalkraft', 'schnellkraft', 'ausdauer', 'maximalkraftausdauer'));

alter table public.trainingsuebungen add column if not exists spezifikationen text[] not null default '{}';
-- Bestehende Werte aus der alten Einzel-Spalte "griffart" übernehmen
update public.trainingsuebungen
  set spezifikationen = array[griffart]
  where griffart is not null and coalesce(array_length(spezifikationen, 1), 0) = 0;

-- "frei" und "fingerkraft" gehen beide in "klassisch" auf — "frei" fällt als
-- eigene Maske weg, die Unterscheidung läuft jetzt über Art/Trainingsart.
-- Wichtig: erst die alte (engere) Prüfregel entfernen, DANN umschreiben —
-- sonst lehnt sie den Zwischenwert "klassisch" selbst ab.
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_typ_val;
update public.trainingsuebungen set typ = 'klassisch' where typ in ('frei', 'fingerkraft');
alter table public.trainingsuebungen add constraint trainingsuebungen_typ_val
  check (typ in ('klassisch', 'kletterroute'));

comment on column public.trainingsuebungen.art is 'Athletik, Mobilität, Dehnung, Geräte oder ein selbst hinzugefügter Wert (siehe trainingsuebung_arten)';
comment on column public.trainingsuebungen.trainingsart is 'maximalkraft | schnellkraft | ausdauer | maximalkraftausdauer';
comment on column public.trainingsuebungen.spezifikationen is 'Mehrere Spezifikationen möglich, z.B. ["Full Crimp", "Beidarmig"] — ersetzt die frühere Einzel-Spalte griffart';
comment on column public.trainingsuebungen.typ is 'klassisch | kletterroute — steuert die Formularmaske im Plan- und Logbuch';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- trainingsuebung_arten -> vorhanden, RLS enabled.
-- trainingsuebungen -> neue Spalten (art, trainingsart, spezifikationen) vorhanden,
--   typ hat nur noch die Werte "klassisch"/"kletterroute".
-- ============================================================================
