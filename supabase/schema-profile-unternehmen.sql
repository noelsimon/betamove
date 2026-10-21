-- BETAMOVE — Unternehmenskonto-Angabe im Profil (Kundenseite)
-- ============================================================================
-- Baut auf schema-konten.sql auf (muss vorher gelaufen sein).
--
-- Bisher wurde jedes Konto implizit als Privatperson behandelt: auf der
-- Prüfbescheinigung erschien immer vorname+nachname, auch wenn das geprüfte
-- Material tatsächlich einer Kletterschule/einem Unternehmen gehört (z.B.
-- weil eine Mitarbeiterin ihr privates BETAMOVE-Konto nutzt, um per
-- Verbindungscode mit einer Sachkundigen Person verbunden zu sein).
--
-- Neu: jede Person kann in ihrem Profil angeben, dass ihr Konto für ein
-- Unternehmen steht (ist_unternehmen) und einen Firmennamen (+ optional
-- Anschrift) hinterlegen. Auf Prüfbescheinigungen erscheint dann der
-- Firmenname statt des privaten Namens, mit dem privaten Namen zusätzlich
-- als "Ansprechpartner*in" zur Nachvollziehbarkeit.
--
-- Läuft über die bereits bestehende "profiles_update_own"-Policy (keine
-- neue Policy/RPC nötig) — das sind reine, unkritische Profildaten wie
-- vorname/nachname/level es auch schon sind.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

alter table public.profiles add column if not exists ist_unternehmen boolean not null default false;
alter table public.profiles add column if not exists firmenname text;
alter table public.profiles add column if not exists firmenadresse text;

alter table public.profiles drop constraint if exists profiles_firmenname_len;
alter table public.profiles add constraint profiles_firmenname_len
  check (firmenname is null or char_length(firmenname) <= 200);

alter table public.profiles drop constraint if exists profiles_firmenadresse_len;
alter table public.profiles add constraint profiles_firmenadresse_len
  check (firmenadresse is null or char_length(firmenadresse) <= 300);

comment on column public.profiles.ist_unternehmen is 'true, wenn dieses Konto für ein Unternehmen/eine Kletterschule steht (nicht für eine Privatperson) — bestimmt den Namen auf Prüfbescheinigungen.';
comment on column public.profiles.firmenname is 'Nur relevant, wenn ist_unternehmen = true — erscheint auf Prüfbescheinigungen statt vorname+nachname.';
comment on column public.profiles.firmenadresse is 'Optionale Anschrift des Unternehmens, nur relevant, wenn ist_unternehmen = true.';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> profiles -> Spalten ist_unternehmen, firmenname,
-- firmenadresse vorhanden.
-- ============================================================================
