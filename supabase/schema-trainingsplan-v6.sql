-- BETAMOVE — Trainingsbereich (v6): Körpergewicht, Trainingspläne/Mesozyklen
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-training.sql,
-- schema-trainingsplan.sql, schema-trainingsplan-v3.sql, -v4.sql und -v5.sql
-- auf (müssen vorher gelaufen sein).
--
-- Sechster Ausbauschritt:
--  - Profil bekommt ein optionales Körpergewicht (für %-Körpergewicht-
--    Anzeigen bei kg-Übungen im Logbuch, z.B. Zusatzgewicht am Hangboard).
--  - Ein Trainingsplan bündelt mehrere Wochen zu einem Mesozyklus
--    (z.B. "Hypertrophie", "Maximalkraft") mit einer Wochenanzahl und je
--    Woche einer Phase (z.B. "Grundlage", "Deload") sowie zugeordneten
--    Workouts an bestimmten Wochentagen. Nur ein Plan kann gleichzeitig
--    "aktiv" sein. Ob ein zugeordnetes Workout schon erledigt wurde, wird
--    nicht gespeichert, sondern aus den vorhandenen trainingseinheiten
--    (Datum + workout_id) live berechnet.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) profiles — optionales Körpergewicht
-- ============================================================================

alter table public.profiles add column if not exists koerpergewicht_kg numeric;
alter table public.profiles drop constraint if exists profiles_koerpergewicht_range;
alter table public.profiles add constraint profiles_koerpergewicht_range
  check (koerpergewicht_kg is null or koerpergewicht_kg between 20 and 300);

comment on column public.profiles.koerpergewicht_kg is 'Freiwillige Selbstangabe, nur für %-Körpergewicht-Anzeigen bei kg-Übungen im Trainings-Logbuch';


-- ============================================================================
-- 2) trainingsplan_zyklen — selbst hinzugefügte Zyklus-Typen (zusätzlich zu
--    den fest eingebauten: Hypertrophie, Maximalkraft, Kraftausdauer,
--    Schnellkraft, Ausdauer, Deload/Regeneration)
-- ============================================================================

create table if not exists public.trainingsplan_zyklen (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),

  constraint trainingsplan_zyklen_name_len check (char_length(trim(name)) between 1 and 60)
);

comment on table public.trainingsplan_zyklen is 'Selbst hinzugefügte Trainingsplan-Zyklus-Typen, zusätzlich zu den eingebauten (Hypertrophie, Maximalkraft, Kraftausdauer, Schnellkraft, Ausdauer, Deload/Regeneration)';

create index if not exists trainingsplan_zyklen_user_id_idx on public.trainingsplan_zyklen (user_id, created_at desc);

alter table public.trainingsplan_zyklen enable row level security;

drop policy if exists "trainingsplan_zyklen_select_own" on public.trainingsplan_zyklen;
create policy "trainingsplan_zyklen_select_own"
  on public.trainingsplan_zyklen for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsplan_zyklen_insert_own" on public.trainingsplan_zyklen;
create policy "trainingsplan_zyklen_insert_own"
  on public.trainingsplan_zyklen for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsplan_zyklen_delete_own" on public.trainingsplan_zyklen;
create policy "trainingsplan_zyklen_delete_own"
  on public.trainingsplan_zyklen for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 3) trainingsplaene — ein Mesozyklus (z.B. "Winter-Hypertrophie")
-- ============================================================================

create table if not exists public.trainingsplaene (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  zyklus         text,
  start_datum    date not null default current_date,
  wochen_anzahl  int not null default 4,
  aktiv          boolean not null default false,
  notiz          text,
  created_at     timestamptz not null default now(),

  constraint trainingsplaene_name_len check (char_length(trim(name)) between 1 and 200),
  constraint trainingsplaene_zyklus_len check (zyklus is null or char_length(zyklus) <= 60),
  constraint trainingsplaene_wochen_range check (wochen_anzahl between 1 and 26),
  constraint trainingsplaene_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.trainingsplaene is 'Ein Trainingsplan/Mesozyklus (z.B. "Winter-Hypertrophie"), gliedert sich in wochen_anzahl Wochen (siehe trainingsplan_eintraege)';
comment on column public.trainingsplaene.zyklus is 'Zyklus-Typ, z.B. Hypertrophie, Maximalkraft, Kraftausdauer — eingebaut oder aus trainingsplan_zyklen';
comment on column public.trainingsplaene.aktiv is 'Nur ein Plan gleichzeitig aktiv je Nutzer*in (siehe Unique-Index unten) — der aktive Plan wird im Logbuch als "diese Woche" angezeigt';

create index if not exists trainingsplaene_user_id_idx on public.trainingsplaene (user_id, created_at desc);
create unique index if not exists trainingsplaene_one_aktiv_per_user on public.trainingsplaene (user_id) where aktiv;

alter table public.trainingsplaene enable row level security;

drop policy if exists "trainingsplaene_select_own" on public.trainingsplaene;
create policy "trainingsplaene_select_own"
  on public.trainingsplaene for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsplaene_insert_own" on public.trainingsplaene;
create policy "trainingsplaene_insert_own"
  on public.trainingsplaene for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsplaene_update_own" on public.trainingsplaene;
create policy "trainingsplaene_update_own"
  on public.trainingsplaene for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingsplaene_delete_own" on public.trainingsplaene;
create policy "trainingsplaene_delete_own"
  on public.trainingsplaene for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 4) trainingsplan_eintraege — pro Plan-Woche zugeordnete Workouts an
--    bestimmten Wochentagen, inkl. Phase der jeweiligen Woche
-- ============================================================================

create table if not exists public.trainingsplan_eintraege (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  plan_id       uuid not null references public.trainingsplaene(id) on delete cascade,
  woche_nr      int not null,
  wochentag     int not null,
  phase         text,
  workout_id    uuid references public.trainingsworkouts(id) on delete set null,
  workout_name  text,
  notiz         text,
  created_at    timestamptz not null default now(),

  constraint trainingsplan_eintraege_woche_range check (woche_nr between 1 and 26),
  constraint trainingsplan_eintraege_wochentag_range check (wochentag between 1 and 7),
  constraint trainingsplan_eintraege_phase_len check (phase is null or char_length(phase) <= 60),
  constraint trainingsplan_eintraege_notiz_len check (notiz is null or char_length(notiz) <= 500)
);

comment on table public.trainingsplan_eintraege is 'Ein Workout an einem Wochentag innerhalb einer Plan-Woche. "Erledigt" wird nicht gespeichert, sondern anhand trainingseinheiten (workout_id + datum im Wochenzeitraum) live berechnet.';
comment on column public.trainingsplan_eintraege.phase is 'Phase dieser Plan-Woche, z.B. Grundlage, Aufbau, Maximalkraft, Peak, Deload — gleicher Wert für alle Einträge derselben Woche';
comment on column public.trainingsplan_eintraege.workout_name is 'Name-Schnappschuss, bleibt lesbar falls das Workout später umbenannt/gelöscht wird';

create index if not exists trainingsplan_eintraege_plan_idx on public.trainingsplan_eintraege (plan_id, woche_nr, wochentag);

alter table public.trainingsplan_eintraege enable row level security;

drop policy if exists "trainingsplan_eintraege_select_own" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_select_own"
  on public.trainingsplan_eintraege for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsplan_eintraege_insert_own" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_insert_own"
  on public.trainingsplan_eintraege for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsplan_eintraege_update_own" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_update_own"
  on public.trainingsplan_eintraege for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingsplan_eintraege_delete_own" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_delete_own"
  on public.trainingsplan_eintraege for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- profiles -> Spalte koerpergewicht_kg vorhanden.
-- trainingsplan_zyklen, trainingsplaene, trainingsplan_eintraege -> vorhanden, RLS enabled.
-- trainingsplaene -> Unique-Index "trainingsplaene_one_aktiv_per_user" vorhanden.
-- ============================================================================
