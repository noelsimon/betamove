-- BETAMOVE — Sicherheits-Härtung: kunde_id-Zugehörigkeit bei psa_material
-- ============================================================================
-- Baut auf schema-psa-sachkundige.sql auf (muss vorher gelaufen sein).
--
-- Befund aus einer Sicherheitsprüfung: Die bisherigen INSERT/UPDATE-Policies
-- auf psa_material prüften bei Kundenmaterial (kunde_id gesetzt) nur
-- "auth.uid() = user_id" und "ist_sachkundig()" — nicht aber, ob die
-- angegebene kunde_id tatsächlich zu einem von DIESER Sachkundigen Person
-- selbst angelegten kunden-Datensatz gehört (kunden.erstellt_von = auth.uid()).
--
-- Dadurch hätte eine Sachkundige Person theoretisch PSA-Material mit der
-- kunde_id einer FREMDEN Sachkundigen-Kundschaft anlegen/umhängen können,
-- sofern sie deren kunden.id (eine UUID) kennt. Da die kunden-Tabelle selbst
-- strikt nach erstellt_von gefiltert ist, ist diese UUID über die App nicht
-- einsehbar — das Risiko war in der Praxis sehr gering, aber die Prüfung
-- gehört trotzdem ergänzt (keine Lücke ohne Not offenlassen).
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

drop policy if exists "psa_material_insert_own" on public.psa_material;
create policy "psa_material_insert_own"
  on public.psa_material for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (
      kunde_id is null
      or (
        public.ist_sachkundig()
        and exists (select 1 from public.kunden k where k.id = kunde_id and k.erstellt_von = auth.uid())
      )
    )
  );

drop policy if exists "psa_material_update_own" on public.psa_material;
create policy "psa_material_update_own"
  on public.psa_material for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (
      kunde_id is null
      or (
        public.ist_sachkundig()
        and exists (select 1 from public.kunden k where k.id = kunde_id and k.erstellt_von = auth.uid())
      )
    )
  );


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Database -> Policies -> psa_material -> psa_material_insert_own und
-- psa_material_update_own enthalten jetzt die kunden-Zugehörigkeitsprüfung.
-- ============================================================================
