-- BETAMOVE — Trainingsbereich (v8): Eigene Übungs-Vorlagen
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-training.sql,
-- schema-trainingsplan.sql, schema-trainingsplan-v3.sql bis -v7.sql auf
-- (müssen vorher gelaufen sein).
--
-- Achter Ausbauschritt: Nutzer*innen können eine eigene Übung mit einem
-- Klick ("Als Vorlage speichern") als wiederverwendbare Vorlage sichern.
-- Diese taucht dann neben den eingebauten Vorlagen (Kletter-Kraftübungen,
-- Antagonisten & Prävention) im "Neue Übung"-Formular auf. Eine Vorlage ist
-- ein reiner Schnappschuss der Übungs-Einstellungen (ohne Wochentage, ohne
-- Bezug zur ursprünglichen Übung) — Löschen oder Ändern der Original-Übung
-- hat keine Auswirkung auf die Vorlage.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


create table if not exists public.trainingsuebung_vorlagen (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  name                  text not null,
  art                   text,
  typ                   text not null default 'klassisch',
  trainingsart          text,
  einheit               text,
  wiederholungen        int,
  saetze                int,
  spezifikationen       text[] not null default '{}',
  geraet                text,
  grad_system           text,
  timer_modus           text not null default 'keiner',
  timer_pause_sekunden  int,
  notiz                 text,
  created_at            timestamptz not null default now(),

  constraint trainingsuebung_vorlagen_name_len check (char_length(trim(name)) between 1 and 200),
  constraint trainingsuebung_vorlagen_art_len check (art is null or char_length(art) <= 60),
  constraint trainingsuebung_vorlagen_typ_val check (typ in ('klassisch', 'kletterroute')),
  constraint trainingsuebung_vorlagen_trainingsart_val check (trainingsart is null or trainingsart in ('maximalkraft', 'schnellkraft', 'ausdauer', 'maximalkraftausdauer')),
  constraint trainingsuebung_vorlagen_wiederholungen_range check (wiederholungen is null or wiederholungen between 1 and 200),
  constraint trainingsuebung_vorlagen_saetze_range check (saetze is null or saetze between 1 and 50),
  constraint trainingsuebung_vorlagen_geraet_len check (geraet is null or char_length(geraet) <= 60),
  constraint trainingsuebung_vorlagen_grad_system_val check (grad_system is null or grad_system in ('fontainebleau', 'uiaa')),
  constraint trainingsuebung_vorlagen_timer_modus_val check (timer_modus in ('keiner', 'pause', 'intervall')),
  constraint trainingsuebung_vorlagen_timer_pause_range check (timer_pause_sekunden is null or timer_pause_sekunden between 5 and 3600),
  constraint trainingsuebung_vorlagen_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.trainingsuebung_vorlagen is 'Eigene, selbst gespeicherte Übungs-Vorlagen je Nutzer*in — reiner Schnappschuss, unabhängig von der Original-Übung';

create index if not exists trainingsuebung_vorlagen_user_id_idx on public.trainingsuebung_vorlagen (user_id, created_at desc);

alter table public.trainingsuebung_vorlagen enable row level security;

drop policy if exists "trainingsuebung_vorlagen_select_own" on public.trainingsuebung_vorlagen;
create policy "trainingsuebung_vorlagen_select_own"
  on public.trainingsuebung_vorlagen for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "trainingsuebung_vorlagen_insert_own" on public.trainingsuebung_vorlagen;
create policy "trainingsuebung_vorlagen_insert_own"
  on public.trainingsuebung_vorlagen for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "trainingsuebung_vorlagen_delete_own" on public.trainingsuebung_vorlagen;
create policy "trainingsuebung_vorlagen_delete_own"
  on public.trainingsuebung_vorlagen for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- trainingsuebung_vorlagen -> vorhanden, RLS enabled, drei Policies (select/insert/delete).
-- ============================================================================
