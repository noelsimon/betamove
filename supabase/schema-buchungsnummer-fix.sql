-- BETAMOVE — Fix: anon konnte wegen fehlender Sequence-Rechte keine
-- Kursanmeldung mehr abschicken (Buchungsnummer-Migration)
-- ============================================================================
-- Baut auf schema-buchungsnummer.sql auf.
--
-- Die Spalte kursanmeldungen.buchungsnummer erzeugt ihren Wert über
-- nextval() auf einer eigenen Sequenz (kursanmeldungen_buchungsnummer_seq).
-- Eine manuell per "create sequence" angelegte Sequenz vergibt in Postgres
-- KEINE automatischen Rechte an die Rollen anon/authenticated — dadurch ist
-- jede neue Kursanmeldung übers öffentliche Formular mit "permission denied
-- for sequence kursanmeldungen_buchungsnummer_seq" fehlgeschlagen, sobald
-- die Spalte ihren Default-Wert berechnen wollte.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

grant usage, select on sequence public.kursanmeldungen_buchungsnummer_seq to anon, authenticated;

-- ============================================================================
-- Nach dem Ausführen prüfen: eine Testanmeldung über anmeldung.html sollte
-- jetzt wieder erfolgreich durchlaufen (Erfolgs-Screen statt Fehlermeldung).
-- ============================================================================
