-- BETAMOVE — PSA-Prüftool: Artikelnummern, Lebensdauer-Daten, Re-Antrag
-- ============================================================================
-- Baut auf schema-psa-material.sql, schema-psa-sachkundige.sql und
-- schema-konten.sql auf (müssen vorher gelaufen sein).
--
-- 1) Automatische Artikelnummer je Gegenstand (z.B. P-G-0001 für PSA/Gurt,
--    I-0001 für Inventar). Zählweise pro Person konfigurierbar (profiles).
-- 2) Re-Antrag: wer einmal abgelehnt wurde, darf sich erneut bewerben.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) profiles — Einstellung zur Artikelnummer-Zählweise
-- ============================================================================

alter table public.profiles add column if not exists psa_nummerierung_modus text not null default 'pro_kategorie';

alter table public.profiles drop constraint if exists profiles_psa_nummerierung_modus_val;
alter table public.profiles add constraint profiles_psa_nummerierung_modus_val
  check (psa_nummerierung_modus in ('pro_kategorie', 'gemeinsam'));

comment on column public.profiles.psa_nummerierung_modus is 'pro_kategorie (Standard): jede PSA-Kategorie (G, SD, SH, …) zählt eigene Artikelnummern ab 0001. gemeinsam: alle PSA-Kategorien einer Person teilen sich eine fortlaufende Nummer.';


-- ============================================================================
-- 2) psa_material — Artikelnummer-Spalte + automatische Vergabe
-- ============================================================================

alter table public.psa_material add column if not exists materialnummer text;

comment on column public.psa_material.materialnummer is 'Automatisch vergebene Artikelnummer, z.B. P-G-0001 (PSA, Kategorie Gurt) oder I-0001 (Inventar). Wird beim Anlegen per Trigger gesetzt, nicht manuell änderbar.';

create or replace function public.psa_kategorie_code(kategorie text)
returns text
language sql
immutable
as $$
  select case kategorie
    when 'Gurt' then 'G'
    when 'Helm' then 'H'
    when 'Seil (dynamisch)' then 'SD'
    when 'Seil (halbstatisch)' then 'SH'
    when 'Verbindungselement / Karabiner' then 'K'
    when 'Sicherungsgerät' then 'SG'
    when 'Bandschlinge / Express' then 'B'
    else 'S'
  end;
$$;

comment on function public.psa_kategorie_code(text) is 'Kurzcode je PSA-Kategorie für die Artikelnummer (z.B. Gurt -> G).';

create or replace function public.psa_material_set_nummer()
returns trigger
language plpgsql
as $$
declare
  v_mode  text;
  v_code  text;
  v_count int;
begin
  if new.materialnummer is not null then
    return new;
  end if;

  select coalesce(psa_nummerierung_modus, 'pro_kategorie') into v_mode
  from public.profiles where id = new.user_id;
  if v_mode is null then
    v_mode := 'pro_kategorie';
  end if;

  if new.ist_psa then
    v_code := public.psa_kategorie_code(new.kategorie);
    if v_mode = 'pro_kategorie' then
      select count(*) into v_count from public.psa_material
        where user_id = new.user_id
          and kunde_id is not distinct from new.kunde_id
          and ist_psa = true
          and public.psa_kategorie_code(kategorie) = v_code;
    else
      select count(*) into v_count from public.psa_material
        where user_id = new.user_id
          and kunde_id is not distinct from new.kunde_id
          and ist_psa = true;
    end if;
    new.materialnummer := 'P-' || v_code || '-' || lpad((v_count + 1)::text, 4, '0');
  else
    select count(*) into v_count from public.psa_material
      where user_id = new.user_id
        and kunde_id is not distinct from new.kunde_id
        and ist_psa = false;
    new.materialnummer := 'I-' || lpad((v_count + 1)::text, 4, '0');
  end if;

  return new;
end;
$$;

drop trigger if exists psa_material_set_nummer_trg on public.psa_material;
create trigger psa_material_set_nummer_trg
  before insert on public.psa_material
  for each row execute function public.psa_material_set_nummer();

-- Bestehende Gegenstände ohne Nummer einmalig nachträglich nummerieren,
-- in Anlage-Reihenfolge, nach denselben Regeln wie der Trigger.
do $$
declare
  r        record;
  v_counts jsonb := '{}'::jsonb;
  v_key    text;
  v_mode   text;
  v_code   text;
  v_n      int;
begin
  for r in select * from public.psa_material where materialnummer is null order by created_at asc loop
    select coalesce(psa_nummerierung_modus, 'pro_kategorie') into v_mode from public.profiles where id = r.user_id;
    if v_mode is null then
      v_mode := 'pro_kategorie';
    end if;

    if r.ist_psa then
      v_code := public.psa_kategorie_code(r.kategorie);
      if v_mode = 'pro_kategorie' then
        v_key := 'P|' || r.user_id || '|' || coalesce(r.kunde_id::text, '-') || '|' || v_code;
      else
        v_key := 'P|' || r.user_id || '|' || coalesce(r.kunde_id::text, '-');
      end if;
    else
      v_key := 'I|' || r.user_id || '|' || coalesce(r.kunde_id::text, '-');
    end if;

    v_n := coalesce((v_counts ->> v_key)::int, 0) + 1;
    v_counts := jsonb_set(v_counts, array[v_key], to_jsonb(v_n));

    if r.ist_psa then
      update public.psa_material set materialnummer = 'P-' || v_code || '-' || lpad(v_n::text, 4, '0') where id = r.id;
    else
      update public.psa_material set materialnummer = 'I-' || lpad(v_n::text, 4, '0') where id = r.id;
    end if;
  end loop;
end $$;


-- ============================================================================
-- 3) psa_sachkundige — Re-Antrag nach Ablehnung/Entzug zulassen
-- ============================================================================
-- Bisher konnte nur die Kursleitung den Status ändern (auch zurück auf
-- "offen"), wer also abgelehnt/entzogen wurde, konnte sich nie wieder
-- bewerben (die Oberfläche bot dafür auch keinen Weg). Diese Policy erlaubt
-- der betroffenen Person selbst GENAU den Schritt "abgelehnt" -> "offen"
-- mit neuen Antragsdaten — alles andere (z.B. sich selbst freischalten)
-- bleibt wie bisher ausschließlich der Kursleitung vorbehalten.

drop policy if exists "psa_sachkundige_update_own_reapply" on public.psa_sachkundige;
create policy "psa_sachkundige_update_own_reapply"
  on public.psa_sachkundige for update
  to authenticated
  using (auth.uid() = user_id and status = 'abgelehnt')
  with check (auth.uid() = user_id and status = 'offen');


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- profiles -> Spalte psa_nummerierung_modus vorhanden (Standard pro_kategorie).
-- psa_material -> Spalte materialnummer vorhanden, bei bestehenden Zeilen gefüllt.
-- Database -> Functions -> psa_kategorie_code, psa_material_set_nummer vorhanden.
-- Database -> Triggers -> psa_material_set_nummer_trg auf psa_material vorhanden.
-- ============================================================================
