-- BETAMOVE — Zyklus-Ansicht: Mikrozyklus-Länge je Trainingsplan
-- ============================================================================
-- Baut auf schema-trainingsplan-v6.sql auf (liefert trainingsplaene).
--
-- Neuer Reiter "Zyklus" im Trainingsbereich zeigt den aktiven Trainingsplan
-- als Belastungs-/Entlastungs-Blöcke (z.B. 3 oder 4 Wochen). Die Blocklänge
-- ist je Plan einstellbar; welche Woche als "Entlastung" gilt, wird weiterhin
-- rein am Phase-Text der jeweiligen Woche erkannt (kein separates Flag) —
-- mikrozyklus_wochen bestimmt nur, wie die Wochen zu Blöcken gruppiert werden.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

alter table public.trainingsplaene add column if not exists mikrozyklus_wochen int not null default 4;
alter table public.trainingsplaene drop constraint if exists trainingsplaene_mikrozyklus_wochen_range;
alter table public.trainingsplaene add constraint trainingsplaene_mikrozyklus_wochen_range
  check (mikrozyklus_wochen between 2 and 8);

comment on column public.trainingsplaene.mikrozyklus_wochen is 'Länge des Belastungs-/Entlastungs-Blocks in Wochen (z.B. 3 oder 4) für die Zyklus-Ansicht; die Erkennung der Entlastungswoche selbst läuft weiterhin über den Phase-Text der jeweiligen Planwoche.';

-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- trainingsplaene -> Spalte mikrozyklus_wochen vorhanden (Standard 4).
-- ============================================================================
