-- ============================================================================
-- Kletterpartner v3 — Pflicht-Datum für Anzeigen + automatisches Ablaufen
-- ============================================================================
-- Jede Anzeige braucht jetzt ein konkretes Termin-Datum (wann_datum) und
-- läuft spätestens 4 Wochen nach Veröffentlichung automatisch ab
-- (laeuft_ab) — danach taucht sie für alle außer dich selbst nicht mehr
-- auf. Das läuft komplett über die Datenbank-Policy, es ist dafür kein
-- separater Cron-Job/Dienst nötig.
--
-- Vor dem Ausführen: in Supabase SQL-Editor einfügen und ausführen.
-- ============================================================================

alter table public.kletterpartner_anzeigen
  add column if not exists wann_datum date,
  add column if not exists laeuft_ab date;

-- Bestehende Anzeigen (ohne Datum) rückwirkend befüllen, damit die
-- anschließende NOT-NULL-Regel nicht fehlschlägt
update public.kletterpartner_anzeigen set wann_datum = created_at::date where wann_datum is null;
update public.kletterpartner_anzeigen set laeuft_ab = created_at::date + 28 where laeuft_ab is null;

alter table public.kletterpartner_anzeigen
  alter column wann_datum set not null,
  alter column laeuft_ab set not null,
  alter column laeuft_ab set default (current_date + 28);

alter table public.kletterpartner_anzeigen
  drop constraint if exists kletterpartner_anzeigen_laeuft_ab_max;
alter table public.kletterpartner_anzeigen
  add constraint kletterpartner_anzeigen_laeuft_ab_max check (laeuft_ab <= created_at::date + 28);

-- Select-Policy: eine abgelaufene Anzeige (laeuft_ab in der Vergangenheit)
-- verhält sich für alle außer der eigenen Person wie aktiv = false
drop policy if exists "kletterpartner_anzeigen_select" on public.kletterpartner_anzeigen;
create policy "kletterpartner_anzeigen_select"
  on public.kletterpartner_anzeigen for select
  to authenticated
  using ((aktiv = true and laeuft_ab >= current_date) or auth.uid() = user_id);

-- profiles-Policy entsprechend nachziehen, sonst bliebe der Name hinter
-- einer abgelaufenen Anzeige fälschlich für alle sichtbar
drop policy if exists "profiles_select_kletterpartner" on public.profiles;
create policy "profiles_select_kletterpartner"
  on public.profiles for select
  to authenticated
  using (
    exists (select 1 from public.kletterpartner_anzeigen a where a.user_id = profiles.id and a.aktiv = true and a.laeuft_ab >= current_date)
    or exists (select 1 from public.kletterpartner_anzeigen_antworten r where r.user_id = profiles.id)
    or exists (
      select 1 from public.kletterpartner_unterhaltungen u
      where (u.user_a = profiles.id or u.user_b = profiles.id)
        and (u.user_a = auth.uid() or u.user_b = auth.uid())
    )
  );
