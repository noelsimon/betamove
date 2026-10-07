-- BETAMOVE — Trainingsbereich (v5): Sätze pro Übung, Satz-Ergebnisse im Logbuch
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-training.sql,
-- schema-trainingsplan.sql, schema-trainingsplan-v3.sql und
-- schema-trainingsplan-v4.sql auf (müssen vorher gelaufen sein).
--
-- Fünfter Ausbauschritt: Klassische Übungen können eine Ziel-Satzzahl
-- bekommen (z.B. 3 Sätze). Im Logbuch werden dann entsprechend viele
-- Satz-Zeilen angezeigt, in denen man pro Satz die tatsächlich erreichten
-- Wiederholungen, das Ergebnis (z.B. Gewicht) und — falls die Übung
-- mehrere Spezifikationen hat (z.B. "Breit"/"Eng") — die in diesem Satz
-- verwendete Spezifikation einträgt. So kann z.B. im dritten Satz nur noch
-- 7 statt 8 Wiederholungen erreicht werden, ohne dass das verloren geht.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) trainingsuebungen — Ziel-Anzahl Sätze (nur klassische Übungen relevant)
-- ============================================================================

alter table public.trainingsuebungen add column if not exists saetze int;
alter table public.trainingsuebungen drop constraint if exists trainingsuebungen_saetze_range;
alter table public.trainingsuebungen add constraint trainingsuebungen_saetze_range
  check (saetze is null or saetze between 1 and 50);

comment on column public.trainingsuebungen.saetze is 'Nur klassisch: Ziel-Anzahl Sätze. Ist dieser Wert >1 gesetzt, zeigt das Logbuch eine Zeile pro Satz statt eines einzelnen Ergebnisfelds.';


-- ============================================================================
-- 2) trainingslog — Ergebnisse pro Satz
-- ============================================================================

alter table public.trainingslog add column if not exists satz_ergebnisse jsonb;

comment on column public.trainingslog.satz_ergebnisse is 'Nur klassische Übungen mit saetze>1: Array von {nr, wiederholungen, ergebnis_wert, spezifikation} — ein Eintrag pro Satz.';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- trainingsuebungen -> Spalte saetze vorhanden.
-- trainingslog -> Spalte satz_ergebnisse vorhanden.
-- ============================================================================
