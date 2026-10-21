-- BETAMOVE — PSA-Prüftool: Unternehmensdaten für die Prüfbescheinigung
-- ============================================================================
-- Baut auf schema-psa-sachkundige.sql auf (muss vorher gelaufen sein).
--
-- Bisher wurde "Tätig für" (organisation) nur einmalig beim Antrag auf
-- Sachkundige-Freischaltung erfasst und war danach nirgends mehr änderbar.
-- Neu: eine bereits freigeschaltete Sachkundige Person kann in ihrem Profil
-- jederzeit Firmenname + Firmenanschrift hinterlegen bzw. ändern — beides
-- erscheint dann auf der Prüfbescheinigung (Übersicht + PDF).
--
-- Die Änderung läuft über eine eigene RPC (nicht per direktem Table-Update),
-- damit die Person dabei NUR organisation/unternehmen_adresse setzen kann,
-- nicht z.B. den eigenen status oder freigeschaltet_bis.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

alter table public.psa_sachkundige add column if not exists unternehmen_adresse text;

alter table public.psa_sachkundige drop constraint if exists psa_sachkundige_unternehmen_adresse_len;
alter table public.psa_sachkundige add constraint psa_sachkundige_unternehmen_adresse_len
  check (unternehmen_adresse is null or char_length(unternehmen_adresse) <= 300);

comment on column public.psa_sachkundige.unternehmen_adresse is 'Anschrift des Unternehmens, für das geprüft wird (nur relevant, wenn organisation nicht BETAMOVE ist) — erscheint auf der Prüfbescheinigung.';

create or replace function public.psa_sachkundige_update_unternehmensdaten(p_organisation text, p_adresse text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.psa_sachkundige
    where user_id = auth.uid() and status = 'freigeschaltet'
  ) then
    raise exception 'Nicht als Sachkundige Person freigeschaltet.';
  end if;

  if p_organisation is not null and char_length(p_organisation) > 200 then
    raise exception 'Firmenname zu lang.';
  end if;
  if p_adresse is not null and char_length(p_adresse) > 300 then
    raise exception 'Adresse zu lang.';
  end if;

  update public.psa_sachkundige
  set organisation = nullif(trim(coalesce(p_organisation, 'BETAMOVE')), ''),
      unternehmen_adresse = nullif(trim(coalesce(p_adresse, '')), '')
  where user_id = auth.uid();
end;
$$;

comment on function public.psa_sachkundige_update_unternehmensdaten(text, text) is 'Erlaubt einer freigeschalteten Sachkundigen Person, Firmenname und -anschrift für die Prüfbescheinigung nachträglich zu ändern, ohne direkten Table-Update-Zugriff auf psa_sachkundige (schützt status/freigeschaltet_bis usw.).';


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> psa_sachkundige -> Spalte unternehmen_adresse vorhanden.
-- Database -> Functions -> psa_sachkundige_update_unternehmensdaten vorhanden.
-- ============================================================================
