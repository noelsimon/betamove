-- BETAMOVE — Coach darf Trainingsplanung auch bearbeiten (nicht nur lesen)
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-trainingsplan-v6.sql und
-- schema-trainingsplan-v7.sql auf (müssen vorher gelaufen sein — v7 liefert
-- training_coach_freigabe und die admin-SELECT-Policies auf trainingsplaene/
-- trainingsplan_eintraege).
--
-- Bisher konnte die Kursleitung bei aktivierter Freigabe die Trainings-
-- planung einer Person nur LESEN. Jetzt kann die Person zusätzlich, über
-- einen zweiten Button im Profil, auch Änderungen erlauben — die
-- Kursleitung kann dann Trainingspläne für diese Person anlegen, bearbeiten,
-- aktivieren/deaktivieren und löschen (inkl. der Wochen-Zuordnungen).
-- Logbuch, Übungen und Ergebnisse bleiben davon komplett unberührt.
--
-- Wichtig: training_coach_bearbeiten ist absichtlich UNABHÄNGIG von
-- training_coach_freigabe geprüft (beide Flags einzeln in den Policies),
-- damit die Schreibrechte korrekt entzogen sind, sobald eines der beiden
-- false wird — das Frontend setzt bearbeiten beim Entziehen der Freigabe
-- zwar ohnehin mit zurück, aber die Datenbank verlässt sich nicht allein
-- darauf.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) profiles — Bearbeiten-Freigabe-Flag
-- ============================================================================

alter table public.profiles add column if not exists training_coach_bearbeiten boolean not null default false;

comment on column public.profiles.training_coach_bearbeiten is 'Freiwillige Zusatz-Freigabe (zusätzlich zu training_coach_freigabe): wenn true, darf die Kursleitung die Trainingsplanung (trainingsplaene/trainingsplan_eintraege) dieser Person auch anlegen/ändern/löschen, nicht nur lesen. Standard: false.';


-- ============================================================================
-- 2) trainingsplaene — Schreibzugriff für Kursleitung, nur wenn erlaubt
-- ============================================================================

drop policy if exists "trainingsplaene_admin_insert" on public.trainingsplaene;
create policy "trainingsplaene_admin_insert"
  on public.trainingsplaene for insert
  to authenticated
  with check (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplaene_admin_update" on public.trainingsplaene;
create policy "trainingsplaene_admin_update"
  on public.trainingsplaene for update
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  )
  with check (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplaene_admin_delete" on public.trainingsplaene;
create policy "trainingsplaene_admin_delete"
  on public.trainingsplaene for delete
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_bearbeiten = true
    )
  );


-- ============================================================================
-- 3) trainingsplan_eintraege — Schreibzugriff für Kursleitung, nur wenn erlaubt
-- ============================================================================

drop policy if exists "trainingsplan_eintraege_admin_insert" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_insert"
  on public.trainingsplan_eintraege for insert
  to authenticated
  with check (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplan_eintraege_admin_update" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_update"
  on public.trainingsplan_eintraege for update
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  )
  with check (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  );

drop policy if exists "trainingsplan_eintraege_admin_delete" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_delete"
  on public.trainingsplan_eintraege for delete
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_bearbeiten = true
    )
  );


-- ============================================================================
-- 4) trainingsworkouts — Lesezugriff für Kursleitung, nur wenn Bearbeiten
--    erlaubt ist (um im Wochen-Editor ein Workout zuordnen zu können)
-- ============================================================================

drop policy if exists "trainingsworkouts_admin_select" on public.trainingsworkouts;
create policy "trainingsworkouts_admin_select"
  on public.trainingsworkouts for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsworkouts.user_id
        and p.training_coach_bearbeiten = true
    )
  );


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- profiles -> Spalte training_coach_bearbeiten vorhanden (Standard false).
-- trainingsplaene, trainingsplan_eintraege -> je 3 weitere Policies
--   (admin_insert/admin_update/admin_delete) vorhanden.
-- trainingsworkouts -> zusätzliche Policy "trainingsworkouts_admin_select" vorhanden.
-- ============================================================================
