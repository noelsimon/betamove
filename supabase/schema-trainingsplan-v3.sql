-- BETAMOVE — Trainingsbereich (v3): Workouts, typisierte Übungen, Timer
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-training.sql und
-- schema-trainingsplan.sql auf (müssen vorher gelaufen sein).
--
-- Dritter Ausbauschritt:
--  - Übungen bekommen einen Typ (frei/fingerkraft/kletterroute) mit eigenen
--    Feldern und optional einer Timer-Konfiguration (Pause oder Intervall).
--  - Mehrere Übungen lassen sich zu einem "Workout" (z.B. "Maximalkraft")
--    bündeln und in Reihenfolge abarbeiten.
--  - Eine abgearbeitete Trainingseinheit (Workout-Historie) hält Datum und
--    Gesamtdauer fest.
--  - Das Logbuch merkt sich pro Eintrag die gemessenen Timer-Zeiten und bei
--    Kletterrouten-Übungen eine Liste von Boulder-/Routenversuchen.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) trainingsuebungen erweitern — Typ, typ-spezifische Felder, Timer-Konfig
-- ============================================================================

alter table public.trainingsuebungen add column if not exists typ text not null default 'frei';
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_typ_val;
alter table public.trainingsuebungen add constraint trainingsuebungen_typ_val
  check (typ in ('frei', 'fingerkraft', 'kletterroute'));

-- Fingerkraft: feste Wiederholungszahl + Griffart an der Übung (nicht am Log-Eintrag)
alter table public.trainingsuebungen add column if not exists wiederholungen int;
alter table public.trainingsuebungen add column if not exists griffart text;
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_wiederholungen_range;
alter table public.trainingsuebungen add constraint trainingsuebungen_wiederholungen_range
  check (wiederholungen is null or wiederholungen between 1 and 200);
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_griffart_len;
alter table public.trainingsuebungen add constraint trainingsuebungen_griffart_len
  check (griffart is null or char_length(griffart) <= 60);

-- Kletterroute: Gerät + welches Grad-System im Logbuch zur Auswahl steht
alter table public.trainingsuebungen add column if not exists geraet text;
alter table public.trainingsuebungen add column if not exists grad_system text;
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_geraet_len;
alter table public.trainingsuebungen add constraint trainingsuebungen_geraet_len
  check (geraet is null or char_length(geraet) <= 60);
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_grad_system_val;
alter table public.trainingsuebungen add constraint trainingsuebungen_grad_system_val
  check (grad_system is null or grad_system in ('fontainebleau', 'uiaa'));

-- Timer: pro Übung optional "Pause" (nur Pausenzeit zählt runter) oder
-- "Intervall" (Start/Pause pro Satz, Intervallzeit beginnt bei jedem Start neu)
alter table public.trainingsuebungen add column if not exists timer_modus text not null default 'keiner';
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_timer_modus_val;
alter table public.trainingsuebungen add constraint trainingsuebungen_timer_modus_val
  check (timer_modus in ('keiner', 'pause', 'intervall'));
alter table public.trainingsuebungen add column if not exists timer_pause_sekunden int;
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_timer_pause_range;
alter table public.trainingsuebungen add constraint trainingsuebungen_timer_pause_range
  check (timer_pause_sekunden is null or timer_pause_sekunden between 5 and 3600);

comment on column public.trainingsuebungen.typ is 'frei (Standard, wie bisher) | fingerkraft | kletterroute — steuert Formular im Plan- und Logbuch';
comment on column public.trainingsuebungen.wiederholungen is 'Nur fingerkraft: feste Wiederholungszahl pro Satz';
comment on column public.trainingsuebungen.griffart is 'Nur fingerkraft: z.B. Full Crimp, Half Crimp, breit, eng';
comment on column public.trainingsuebungen.geraet is 'Nur kletterroute: z.B. Moonboard, Kilterboard, Spraywall';
comment on column public.trainingsuebungen.grad_system is 'Nur kletterroute: fontainebleau oder uiaa — legt die Grad-Auswahl im Logbuch fest';
comment on column public.trainingsuebungen.timer_modus is 'keiner | pause (nur Pausenzeit einstellbar) | intervall (Start/Pause pro Satz)';
comment on column public.trainingsuebungen.timer_pause_sekunden is 'Nur timer_modus=pause: eingestellte Pausenlänge in Sekunden';


-- ============================================================================
-- 2) trainingsworkouts — Vorlagen, die mehrere Übungen bündeln
-- ============================================================================

create table if not exists public.trainingsworkouts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  notiz       text,
  created_at  timestamptz not null default now(),

  constraint trainingsworkouts_name_len check (char_length(trim(name)) between 1 and 200),
  constraint trainingsworkouts_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.trainingsworkouts is 'Workout-Vorlagen (z.B. "Maximalkraft"), bündeln mehrere trainingsuebungen';

create index if not exists trainingsworkouts_user_id_idx on public.trainingsworkouts (user_id, created_at desc);

alter table public.trainingsworkouts enable row level security;

drop policy if exists "trainingsworkouts_select_own" on public.trainingsworkouts;
create policy "trainingsworkouts_select_own"
  on public.trainingsworkouts for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsworkouts_insert_own" on public.trainingsworkouts;
create policy "trainingsworkouts_insert_own"
  on public.trainingsworkouts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsworkouts_update_own" on public.trainingsworkouts;
create policy "trainingsworkouts_update_own"
  on public.trainingsworkouts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingsworkouts_delete_own" on public.trainingsworkouts;
create policy "trainingsworkouts_delete_own"
  on public.trainingsworkouts for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 3) trainingsworkout_uebungen — welche Übungen in welcher Reihenfolge
-- ============================================================================

create table if not exists public.trainingsworkout_uebungen (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  workout_id  uuid not null references public.trainingsworkouts(id) on delete cascade,
  uebung_id   uuid not null references public.trainingsuebungen(id) on delete cascade,
  reihenfolge int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.trainingsworkout_uebungen is 'Verknüpfung Workout <-> Übung mit Reihenfolge';

create index if not exists trainingsworkout_uebungen_workout_idx on public.trainingsworkout_uebungen (workout_id, reihenfolge);

alter table public.trainingsworkout_uebungen enable row level security;

drop policy if exists "trainingsworkout_uebungen_select_own" on public.trainingsworkout_uebungen;
create policy "trainingsworkout_uebungen_select_own"
  on public.trainingsworkout_uebungen for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsworkout_uebungen_insert_own" on public.trainingsworkout_uebungen;
create policy "trainingsworkout_uebungen_insert_own"
  on public.trainingsworkout_uebungen for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsworkout_uebungen_update_own" on public.trainingsworkout_uebungen;
create policy "trainingsworkout_uebungen_update_own"
  on public.trainingsworkout_uebungen for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingsworkout_uebungen_delete_own" on public.trainingsworkout_uebungen;
create policy "trainingsworkout_uebungen_delete_own"
  on public.trainingsworkout_uebungen for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 4) trainingseinheiten — Historie abgeschlossener Workout-Durchläufe
-- ============================================================================

create table if not exists public.trainingseinheiten (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  workout_id     uuid references public.trainingsworkouts(id) on delete set null,
  workout_name   text,
  datum          date not null default current_date,
  dauer_sekunden int,
  notiz          text,
  created_at     timestamptz not null default now(),

  constraint trainingseinheiten_dauer_range check (dauer_sekunden is null or dauer_sekunden between 0 and 86400),
  constraint trainingseinheiten_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.trainingseinheiten is 'Historie: ein abgeschlossener Workout-Durchlauf (Gesamtzeit, Datum)';
comment on column public.trainingseinheiten.workout_name is 'Name-Schnappschuss zum Zeitpunkt des Abschlusses, bleibt lesbar falls die Vorlage später umbenannt/gelöscht wird';

create index if not exists trainingseinheiten_user_id_idx on public.trainingseinheiten (user_id, datum desc);

alter table public.trainingseinheiten enable row level security;

drop policy if exists "trainingseinheiten_select_own" on public.trainingseinheiten;
create policy "trainingseinheiten_select_own"
  on public.trainingseinheiten for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingseinheiten_insert_own" on public.trainingseinheiten;
create policy "trainingseinheiten_insert_own"
  on public.trainingseinheiten for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingseinheiten_update_own" on public.trainingseinheiten;
create policy "trainingseinheiten_update_own"
  on public.trainingseinheiten for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingseinheiten_delete_own" on public.trainingseinheiten;
create policy "trainingseinheiten_delete_own"
  on public.trainingseinheiten for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 5) trainingslog erweitern — Verknüpfung zur Einheit, Timer-Zeiten,
--    Routen-Versuche (Kletterroute: mehrere Boulder/Routen pro Eintrag)
-- ============================================================================

alter table public.trainingslog add column if not exists einheit_id uuid references public.trainingseinheiten(id) on delete set null;
alter table public.trainingslog add column if not exists aktive_zeit_sekunden int;
alter table public.trainingslog add column if not exists intervall_sekunden int[];
alter table public.trainingslog add column if not exists pausen_anzahl int;
alter table public.trainingslog add column if not exists routen_versuche jsonb;

alter table public.trainingslog drop constraint if exists trainingslog_aktive_zeit_range;
alter table public.trainingslog add constraint trainingslog_aktive_zeit_range
  check (aktive_zeit_sekunden is null or aktive_zeit_sekunden between 0 and 86400);
alter table public.trainingslog drop constraint if exists trainingslog_pausen_anzahl_range;
alter table public.trainingslog add constraint trainingslog_pausen_anzahl_range
  check (pausen_anzahl is null or pausen_anzahl between 0 and 500);

create index if not exists trainingslog_einheit_id_idx on public.trainingslog (einheit_id);

comment on column public.trainingslog.einheit_id is 'Optional: Eintrag gehört zu einer abgearbeiteten Workout-Einheit (trainingseinheiten)';
comment on column public.trainingslog.aktive_zeit_sekunden is 'Gemessene Aktivzeit dieser Übung (Summe bei Intervall-Timer)';
comment on column public.trainingslog.intervall_sekunden is 'Nur timer_modus=intervall: Dauer jedes einzelnen Satzes/Intervalls in Sekunden';
comment on column public.trainingslog.pausen_anzahl is 'Nur timer_modus=pause: Anzahl genutzter Pausen-Durchläufe';
comment on column public.trainingslog.routen_versuche is 'Nur kletterroute-Übungen: Array von {grad, name, versuche, getoppt} — mehrere Boulder/Routen pro Logbuch-Eintrag';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- trainingsuebungen -> neue Spalten (typ, wiederholungen, griffart, geraet,
--   grad_system, timer_modus, timer_pause_sekunden) vorhanden.
-- trainingsworkouts, trainingsworkout_uebungen, trainingseinheiten -> vorhanden, RLS enabled.
-- trainingslog -> neue Spalten (einheit_id, aktive_zeit_sekunden,
--   intervall_sekunden, pausen_anzahl, routen_versuche) vorhanden.
-- ============================================================================
