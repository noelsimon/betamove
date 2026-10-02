-- BETAMOVE — Trainingsbereich: Ziele, Logbuch (v1)
-- ============================================================================
-- Baut auf schema.sql und schema-konten.sql auf (müssen vorher gelaufen sein).
--
-- Erster Ausbauschritt des Trainingsbereichs im Konto: eigene Ziele setzen
-- und Trainingseinheiten loggen (Datum, Art, Dauer, Anstrengung, Notiz).
-- Die Stoppuhr auf konto-training.html braucht keine Datenbank, läuft rein
-- im Browser. Admin-seitige Trainingspläne und eine ausführlichere
-- Statistik-Auswertung sind bewusst nicht Teil dieser ersten Version.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) trainingsziele
-- ============================================================================

create table if not exists public.trainingsziele (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  text        text not null,
  erreicht    boolean not null default false,
  erreicht_am timestamptz,
  created_at  timestamptz not null default now(),

  constraint trainingsziele_text_len check (char_length(trim(text)) between 1 and 300)
);

comment on table public.trainingsziele is 'Eigene Trainingsziele je Nutzer*in (Lernkonto), z.B. "Erste 7a", "3x/Woche trainieren"';

create index if not exists trainingsziele_user_id_idx on public.trainingsziele (user_id, created_at desc);

alter table public.trainingsziele enable row level security;

drop policy if exists "trainingsziele_select_own" on public.trainingsziele;
create policy "trainingsziele_select_own"
  on public.trainingsziele for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsziele_insert_own" on public.trainingsziele;
create policy "trainingsziele_insert_own"
  on public.trainingsziele for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsziele_update_own" on public.trainingsziele;
create policy "trainingsziele_update_own"
  on public.trainingsziele for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingsziele_delete_own" on public.trainingsziele;
create policy "trainingsziele_delete_own"
  on public.trainingsziele for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 2) trainingslog — Logbuch
-- ============================================================================

create table if not exists public.trainingslog (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  datum          date not null default current_date,
  typ            text not null,
  dauer_minuten  int,
  anstrengung    int,
  notiz          text,
  created_at     timestamptz not null default now(),

  constraint trainingslog_typ_val check (typ in ('bouldern', 'seilklettern', 'fingerkraft', 'ausdauer', 'mobility', 'sonstiges')),
  constraint trainingslog_dauer_range check (dauer_minuten is null or dauer_minuten between 1 and 600),
  constraint trainingslog_anstrengung_range check (anstrengung is null or anstrengung between 1 and 10),
  constraint trainingslog_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.trainingslog is 'Logbuch-Einträge je Trainingseinheit (Lernkonto)';
comment on column public.trainingslog.anstrengung is 'RPE-Skala 1-10, optional — vgl. Artikel "Bouldern ohne Verletzung"';

create index if not exists trainingslog_user_id_idx on public.trainingslog (user_id, datum desc);

alter table public.trainingslog enable row level security;

drop policy if exists "trainingslog_select_own" on public.trainingslog;
create policy "trainingslog_select_own"
  on public.trainingslog for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingslog_insert_own" on public.trainingslog;
create policy "trainingslog_insert_own"
  on public.trainingslog for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingslog_update_own" on public.trainingslog;
create policy "trainingslog_update_own"
  on public.trainingslog for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "trainingslog_delete_own" on public.trainingslog;
create policy "trainingslog_delete_own"
  on public.trainingslog for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> trainingsziele und trainingslog: vorhanden, leer, RLS enabled.
-- ============================================================================
