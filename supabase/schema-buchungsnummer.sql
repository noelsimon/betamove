-- BETAMOVE — Fortlaufende Buchungsnummer für Kursanmeldungen
-- ============================================================================
-- Baut auf schema.sql auf (liefert kursanmeldungen).
--
-- Jede Kursanmeldung bekommt automatisch eine fortlaufende, für Kund*innen
-- sichtbare Buchungsnummer im Format "BM-00001". Wird direkt beim Insert per
-- Spalten-Default vergeben (kein App-Code nötig), landet dadurch automatisch
-- im Webhook-Payload (to_jsonb(NEW) in manual-triggers.sql) und damit in der
-- Bestätigungsmail sowie im Admin-Dashboard.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

create sequence if not exists public.kursanmeldungen_buchungsnummer_seq;

alter table public.kursanmeldungen add column if not exists buchungsnummer text;

-- Bestehende Buchungen rückwirkend nummerieren, in der Reihenfolge der
-- Anmeldung (nur Zeilen ohne Nummer — bei erneutem Ausführen passiert hier
-- nichts mehr).
do $$
declare
  r record;
begin
  for r in (
    select id from public.kursanmeldungen
    where buchungsnummer is null
    order by created_at asc
  )
  loop
    update public.kursanmeldungen
      set buchungsnummer = 'BM-' || lpad(nextval('public.kursanmeldungen_buchungsnummer_seq')::text, 5, '0')
      where id = r.id;
  end loop;
end $$;

alter table public.kursanmeldungen
  alter column buchungsnummer set default ('BM-' || lpad(nextval('public.kursanmeldungen_buchungsnummer_seq')::text, 5, '0'));
alter table public.kursanmeldungen alter column buchungsnummer set not null;

alter table public.kursanmeldungen drop constraint if exists kursanmeldungen_buchungsnummer_unique;
alter table public.kursanmeldungen add constraint kursanmeldungen_buchungsnummer_unique unique (buchungsnummer);

comment on column public.kursanmeldungen.buchungsnummer is 'Fortlaufende, für Kund*innen sichtbare Buchungsnummer (Format BM-00001) — automatisch per Sequenz vergeben, kein App-Code setzt diesen Wert.';

-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- kursanmeldungen -> Spalte buchungsnummer vorhanden, bei allen bestehenden
--   Zeilen gefüllt (z.B. BM-00001, BM-00002, ... nach Anmeldedatum sortiert).
-- Eine neue Testanmeldung über anmeldung.html bekommt automatisch die
--   nächste freie Nummer.
-- ============================================================================
