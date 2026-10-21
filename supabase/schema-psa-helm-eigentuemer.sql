-- BETAMOVE — PSA-Prüftool: Materialart "Plastik/Styropor" + Eigentümer-Name
-- ============================================================================
-- Baut auf schema-psa-material.sql auf (muss vorher gelaufen sein).
--
-- 1) Neue Materialart "Plastik/Styropor" zulassen (für Helme).
-- 2) Neue Spalte eigentuemer_name: wenn bei einem Kunden-Gegenstand nicht der
--    Kunde selbst, sondern z.B. ein*e Teilnehmer*in der tatsächliche
--    Eigentümer ist, kann dessen Name hier erfasst werden.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

alter table public.psa_material drop constraint if exists psa_material_materialart_val;
alter table public.psa_material add constraint psa_material_materialart_val
  check (materialart is null or materialart in ('textil', 'metall', 'textil_metall', 'plastik_styropor'));

alter table public.psa_material add column if not exists eigentuemer_name text;

alter table public.psa_material drop constraint if exists psa_material_eigentuemer_name_len;
alter table public.psa_material add constraint psa_material_eigentuemer_name_len
  check (eigentuemer_name is null or char_length(eigentuemer_name) <= 200);

comment on column public.psa_material.eigentuemer_name is 'Nur bei Kunden-Material relevant: Name der tatsächlichen Eigentümerin/des Eigentümers (z.B. Teilnehmer*in), falls dieser nicht mit dem Kunden-Datensatz identisch ist. NULL = der Kunde selbst ist Eigentümer.';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Database -> Tables -> psa_material -> Spalte eigentuemer_name vorhanden.
-- Database -> Tables -> psa_material -> Constraint psa_material_materialart_val
--   erlaubt jetzt auch 'plastik_styropor'.
-- ============================================================================
