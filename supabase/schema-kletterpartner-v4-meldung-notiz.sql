-- ============================================================================
-- Kletterpartner v4 — Optionales Freitextfeld beim Melden
-- ============================================================================
-- Beim Melden kann jetzt zusätzlich zum Grund ein optionaler Freitext
-- mitgegeben werden, um mehr Kontext zu liefern.
--
-- Vor dem Ausführen: in Supabase SQL-Editor einfügen und ausführen.
-- ============================================================================

alter table public.kletterpartner_meldungen
  add column if not exists notiz text;

alter table public.kletterpartner_meldungen
  drop constraint if exists kletterpartner_meldungen_notiz_len;
alter table public.kletterpartner_meldungen
  add constraint kletterpartner_meldungen_notiz_len check (notiz is null or char_length(notiz) <= 500);
