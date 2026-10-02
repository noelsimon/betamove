-- BETAMOVE — Trainingsbereich (v2): eigener Wochenplan mit Übungen
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql und schema-training.sql auf
-- (müssen vorher gelaufen sein).
--
-- Zweite Ausbaustufe: eigene Übungen anlegen, auf Wochentage verteilen
-- (Reiter "Plan") und dazu wiederholt Ergebnisse eintragen (Reiter
-- "Logbuch", landet weiterhin in trainingslog). Jede Übung hat eine frei
-- wählbare Einheit (z.B. "kg", "Sek.", "Wdh."), damit es für jede Trainingsart
-- passt statt starrer Felder.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) trainingsuebungen
-- ============================================================================

create table if not exists public.trainingsuebungen (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  einheit     text,
  wochentage  int[] not null default '{}',
  notiz       text,
  created_at  timestamptz not null default now(),

  constraint trainingsuebungen_name_len check (char_length(trim(name)) between 1 and 200),
  constraint trainingsuebungen_einheit_len check (einheit is null or char_length(einheit) <= 40),
  constraint trainingsuebungen_notiz_len check (notiz is null or char_length(notiz) <= 1000),
  constraint trainingsuebungen_wochentage_val check (wochentage <@ array[1,2,3,4,5,6,7])
);

comment on table public.trainingsuebungen is 'Eigene Übungen im Wochenplan, je Nutzer*in (Lernkonto)';
comment on column public.trainingsuebungen.einheit is 'Freie Einheit für das Ergebnis, z.B. "kg", "Sek.", "Wdh." — ohne Vorgabe';
comment on column public.trainingsuebungen.wochentage is 'ISO-Wochentage 1=Montag .. 7=Sonntag, an denen die Übung geplant ist';

create index if not exists trainingsuebungen_user_id_idx on public.trainingsuebungen (user_id, created_at desc);

alter table public.trainingsuebungen enable row level security;

drop policy if exists "trainingsuebungen_select_own" on public.trainingsuebungen;
create policy "trainingsuebungen_select_own"
  on public.trainingsuebungen for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsuebungen_insert_own" on public.trainingsuebungen;
create policy "trainingsuebungen_insert_own"
  on public.trainingsuebungen for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsuebungen_update_own" on public.trainingsuebungen;
create policy "trainingsuebungen_update_own"
  on public.trainingsuebungen for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingsuebungen_delete_own" on public.trainingsuebungen;
create policy "trainingsuebungen_delete_own"
  on public.trainingsuebungen for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 2) trainingslog erweitern — Ergebnis kann jetzt an eine eigene Übung
--    geknüpft sein, statt nur die feste Art-Auswahl aus v1 zu nutzen.
--    Bestehende Einträge (typ gesetzt, kein uebung_id) bleiben gültig.
-- ============================================================================

alter table public.trainingslog add column if not exists uebung_id uuid references public.trainingsuebungen(id) on delete set null;
alter table public.trainingslog add column if not exists ergebnis_wert numeric;

alter table public.trainingslog alter column typ drop not null;

alter table public.trainingslog drop constraint if exists trainingslog_typ_val;
alter table public.trainingslog add constraint trainingslog_typ_val
  check (typ is null or typ in ('bouldern', 'seilklettern', 'fingerkraft', 'ausdauer', 'mobility', 'sonstiges'));

alter table public.trainingslog drop constraint if exists trainingslog_typ_or_uebung;
alter table public.trainingslog add constraint trainingslog_typ_or_uebung
  check (typ is not null or uebung_id is not null);

create index if not exists trainingslog_uebung_id_idx on public.trainingslog (uebung_id);

comment on column public.trainingslog.uebung_id is 'Optional: Ergebnis gehört zu einer Übung aus dem eigenen Wochenplan (trainingsuebungen)';
comment on column public.trainingslog.ergebnis_wert is 'Optional: Zahlenwert passend zur Einheit der verknüpften Übung';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> trainingsuebungen: vorhanden, leer, RLS enabled.
-- trainingslog -> Spalten uebung_id und ergebnis_wert vorhanden.
-- ============================================================================
