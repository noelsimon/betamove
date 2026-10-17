-- BETAMOVE — Trainingsbereich (v7): Coach-Freigabe der Trainingsplanung
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-training.sql,
-- schema-trainingsplan.sql, schema-trainingsplan-v3.sql bis -v6.sql auf
-- (müssen vorher gelaufen sein). Setzt außerdem die Admin-Policy-Struktur
-- aus schema-pruefungen-zertifikate.sql voraus (ADMIN_EMAIL-Muster).
--
-- Siebter Ausbauschritt: Nutzer*innen können freiwillig über einen Button im
-- Profil ("Coach-Zugriff") der Kursleitung Lesezugriff auf ihre
-- Trainingsplanung geben — gemeint ist ausschließlich die Plan-Struktur
-- (trainingsplaene, trainingsplan_eintraege: Name, Zyklus, Wochen, Phasen,
-- zugeordnete Workout-Namen je Wochentag). NICHT mit freigegeben werden:
-- Logbuch-Einträge, Übungen, Workout-Details, Ziele — diese bleiben wie
-- bisher ausschließlich für die Person selbst sichtbar. Ohne Freigabe
-- ändert sich nichts; der Zugriff lässt sich jederzeit wieder entziehen.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) profiles — Freigabe-Flag
-- ============================================================================

alter table public.profiles add column if not exists training_coach_freigabe boolean not null default false;

comment on column public.profiles.training_coach_freigabe is 'Freiwillige Freigabe: wenn true, darf die Kursleitung die Trainingsplanung (trainingsplaene/trainingsplan_eintraege) dieser Person lesen. Standard: false (kein Zugriff). Jederzeit durch die Person selbst änderbar.';


-- ============================================================================
-- 2) trainingsplaene — Lesezugriff für Kursleitung, nur wenn freigegeben
-- ============================================================================

drop policy if exists "trainingsplaene_admin_select" on public.trainingsplaene;
create policy "trainingsplaene_admin_select"
  on public.trainingsplaene for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplaene.user_id
        and p.training_coach_freigabe = true
    )
  );


-- ============================================================================
-- 3) trainingsplan_eintraege — Lesezugriff für Kursleitung, nur wenn freigegeben
-- ============================================================================

drop policy if exists "trainingsplan_eintraege_admin_select" on public.trainingsplan_eintraege;
create policy "trainingsplan_eintraege_admin_select"
  on public.trainingsplan_eintraege for select
  to authenticated
  using (
    auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com'
    and exists (
      select 1 from public.profiles p
      where p.id = trainingsplan_eintraege.user_id
        and p.training_coach_freigabe = true
    )
  );


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- profiles -> Spalte training_coach_freigabe vorhanden (Standard false).
-- trainingsplaene, trainingsplan_eintraege -> zusätzliche Policy
--   "..._admin_select" vorhanden (Reiter "Policies").
-- ============================================================================
