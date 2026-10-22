-- BETAMOVE — PSA-Prüftool: Nutzungshäufigkeit je Gegenstand
-- ============================================================================
-- Baut auf schema-psa-material.sql auf (muss vorher gelaufen sein).
--
-- Neues, optionales Feld: wie oft ein PSA-Gegenstand im Schnitt genutzt wird,
-- angegeben in "Mal pro Monat" (z.B. 1, 4, 8, 12, 20, 30). Rein informativ
-- für die Sachkundige Person bei der Einschätzung des Verschleißes — ändert
-- nichts am Prüfrhythmus selbst.
--
-- Rein additiv: bestehende Zeilen (auch der gerade importierte
-- Vereins-Bestand) bleiben unverändert, die neue Spalte ist für sie einfach
-- leer (NULL).
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

alter table public.psa_material add column if not exists nutzungshaeufigkeit_pro_monat int;

alter table public.psa_material drop constraint if exists psa_material_nutzungshaeufigkeit_val;
alter table public.psa_material add constraint psa_material_nutzungshaeufigkeit_val
  check (nutzungshaeufigkeit_pro_monat is null or nutzungshaeufigkeit_pro_monat between 1 and 60);

comment on column public.psa_material.nutzungshaeufigkeit_pro_monat is 'Geschätzte Nutzungshäufigkeit in Mal pro Monat (z.B. 1, 4, 8, 12, 20, 30) — optionale Einschätzung für die Verschleißbeurteilung, kein Prüfrhythmus.';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> psa_material -> Spalte nutzungshaeufigkeit_pro_monat
-- vorhanden, bei bestehenden Zeilen leer.
-- ============================================================================
