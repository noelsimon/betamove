-- BETAMOVE — PSA-Prüftool (Schritt 3, Modell A): Kunde-Verbindung per Code
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-psa-material.sql und
-- schema-psa-sachkundige.sql auf (müssen vorher gelaufen sein).
--
-- Ergänzt das bestehende Modell ("Sachkundige Person legt Kund*in + Material
-- komplett selbst an") um einen zweiten Weg: Ein Kunde mit eigenem
-- BETAMOVE-Konto pflegt sein Material selbst unter "Mein Material" und gibt
-- einer bestimmten Sachkundigen Person per Code Zugriff — Grundzugriff ist
-- immer Lesen + Prüfen, "bearbeiten_erlaubt" gibt zusätzlich das Recht,
-- auch Material für die Person anzulegen/zu ändern.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) psa_sachkundige.verbindungscode — dauerhafter Code je Sachkundiger Person
-- ============================================================================

alter table public.psa_sachkundige add column if not exists verbindungscode text unique;

comment on column public.psa_sachkundige.verbindungscode is 'Dauerhafter Code, den Kund*innen eintragen, um ihr eigenes Material mit dieser Sachkundigen Person zu verbinden. Wird per psa_verbindungscode_erzeugen() gesetzt, nicht direkt per UPDATE.';


-- ============================================================================
-- 2) psa_kunde_verbindungen — Kunde (eigenes Konto) <-> Sachkundige Person
-- ============================================================================

create table if not exists public.psa_kunde_verbindungen (
  id                    uuid primary key default gen_random_uuid(),
  kunde_user_id         uuid not null references auth.users(id) on delete cascade,
  sachkundiger_user_id  uuid not null references auth.users(id) on delete cascade,
  bearbeiten_erlaubt    boolean not null default false,
  created_at            timestamptz not null default now(),

  constraint psa_kunde_verbindungen_unique unique (kunde_user_id, sachkundiger_user_id),
  constraint psa_kunde_verbindungen_nicht_selbst check (kunde_user_id <> sachkundiger_user_id)
);

comment on table public.psa_kunde_verbindungen is 'Verbindung zwischen einem Kundenkonto und einer Sachkundigen Person. Grundzugriff (lesen + prüfen) besteht mit der Verbindung; bearbeiten_erlaubt gibt zusätzlich Schreibrechte auf das Material.';

create index if not exists psa_kunde_verbindungen_sachkundiger_idx on public.psa_kunde_verbindungen (sachkundiger_user_id);

alter table public.psa_kunde_verbindungen enable row level security;

-- Der Kunde verwaltet seine eigenen Verbindungen vollständig selbst
-- (Verbindung lösen, Bearbeiten-Haken setzen). Neue Verbindungen entstehen
-- NICHT direkt per INSERT, sondern über psa_verbindung_herstellen() unten,
-- damit niemand ohne gültigen Code eine Verbindung erzwingen kann.
drop policy if exists "psa_verbindungen_kunde_select" on public.psa_kunde_verbindungen;
create policy "psa_verbindungen_kunde_select"
  on public.psa_kunde_verbindungen for select
  to authenticated
  using (auth.uid() = kunde_user_id);

drop policy if exists "psa_verbindungen_kunde_update" on public.psa_kunde_verbindungen;
create policy "psa_verbindungen_kunde_update"
  on public.psa_kunde_verbindungen for update
  to authenticated
  using (auth.uid() = kunde_user_id)
  with check (auth.uid() = kunde_user_id);

drop policy if exists "psa_verbindungen_kunde_delete" on public.psa_kunde_verbindungen;
create policy "psa_verbindungen_kunde_delete"
  on public.psa_kunde_verbindungen for delete
  to authenticated
  using (auth.uid() = kunde_user_id);

-- Die Sachkundige Person darf sehen, wer ihr Zugriff gewährt hat.
drop policy if exists "psa_verbindungen_sachkundiger_select" on public.psa_kunde_verbindungen;
create policy "psa_verbindungen_sachkundiger_select"
  on public.psa_kunde_verbindungen for select
  to authenticated
  using (auth.uid() = sachkundiger_user_id);


-- ============================================================================
-- 3) profiles — Name sichtbar machen für verbundene Gegenseite
-- ============================================================================
-- profiles hat bisher nur "eigenes Profil oder Admin" als SELECT-Policy.
-- Für die Anzeige in der Kundenliste/Verbindungsliste braucht jede Seite
-- den Namen der jeweils anderen Seite der Verbindung.

drop policy if exists "profiles_select_verbunden_sachkundiger" on public.profiles;
create policy "profiles_select_verbunden_sachkundiger"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.psa_kunde_verbindungen v
      where v.kunde_user_id = profiles.id
        and v.sachkundiger_user_id = auth.uid()
    )
  );

drop policy if exists "profiles_select_verbunden_kunde" on public.profiles;
create policy "profiles_select_verbunden_kunde"
  on public.profiles for select
  to authenticated
  using (
    exists (
      select 1 from public.psa_kunde_verbindungen v
      where v.sachkundiger_user_id = profiles.id
        and v.kunde_user_id = auth.uid()
    )
  );


-- ============================================================================
-- 4) psa_verbindungscode_erzeugen() — Code für die eigene Sachkundigen-Zeile
-- ============================================================================
-- SECURITY DEFINER statt einer breiten UPDATE-Policy auf psa_sachkundige,
-- damit die Sachkundige Person NUR den Code setzen kann (nicht z.B. den
-- eigenen status auf 'freigeschaltet' ändern). Gibt den bestehenden Code
-- zurück, falls schon einer vergeben ist (idempotent).

create or replace function public.psa_verbindungscode_erzeugen()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      text;
  v_existing  text;
  v_versuch   int := 0;
  v_chars     text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne 0/O/1/I
  i           int;
begin
  if not public.ist_sachkundig() then
    raise exception 'Nur freigeschaltete Sachkundige Personen können einen Verbindungscode erzeugen';
  end if;

  select verbindungscode into v_existing from public.psa_sachkundige where user_id = auth.uid();
  if v_existing is not null then
    return v_existing;
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1);
    end loop;

    begin
      update public.psa_sachkundige set verbindungscode = v_code where user_id = auth.uid();
      return v_code;
    exception when unique_violation then
      v_versuch := v_versuch + 1;
      if v_versuch > 10 then
        raise exception 'Konnte keinen eindeutigen Code erzeugen, bitte erneut versuchen';
      end if;
    end;
  end loop;
end;
$$;

comment on function public.psa_verbindungscode_erzeugen() is 'Erzeugt (oder liefert bestehenden) Verbindungscode für die eingeloggte, freigeschaltete Sachkundige Person.';


-- ============================================================================
-- 5) psa_verbindung_herstellen(code) — Kunde trägt Code ein
-- ============================================================================
-- SECURITY DEFINER, damit der Kunde den Code gegen psa_sachkundige prüfen
-- kann, ohne eine SELECT-Policy auf fremde psa_sachkundige-Zeilen zu brauchen
-- (die u.a. Handynummer/Adresse/Qualifikationsnachweis enthalten).

create or replace function public.psa_verbindung_herstellen(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sachkundiger_id uuid;
  v_id              uuid;
begin
  select user_id into v_sachkundiger_id
  from public.psa_sachkundige
  where verbindungscode = upper(trim(code))
    and status = 'freigeschaltet'
    and (freigeschaltet_bis is null or freigeschaltet_bis >= current_date);

  if v_sachkundiger_id is null then
    raise exception 'Ungültiger oder abgelaufener Code';
  end if;

  if v_sachkundiger_id = auth.uid() then
    raise exception 'Du kannst dich nicht mit dir selbst verbinden';
  end if;

  insert into public.psa_kunde_verbindungen (kunde_user_id, sachkundiger_user_id)
  values (auth.uid(), v_sachkundiger_id)
  on conflict (kunde_user_id, sachkundiger_user_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.psa_kunde_verbindungen
    where kunde_user_id = auth.uid() and sachkundiger_user_id = v_sachkundiger_id;
  end if;

  return v_id;
end;
$$;

comment on function public.psa_verbindung_herstellen(text) is 'Kunde trägt den Code einer Sachkundigen Person ein; legt (idempotent) eine psa_kunde_verbindungen-Zeile an und gibt deren id zurück.';


-- ============================================================================
-- 6) psa_material — Zugriff für verbundene Sachkundige Person
-- ============================================================================
-- Gilt nur für eigenes Material (kunde_id is null) — Kundenmaterial-Zeilen
-- aus dem bestehenden Modell (eigentuemer_typ = 'kunde') sind davon nicht
-- betroffen, die laufen weiterhin ausschließlich über die Sachkundige Person
-- selbst als user_id.

drop policy if exists "psa_material_select_verbunden" on public.psa_material;
create policy "psa_material_select_verbunden"
  on public.psa_material for select
  to authenticated
  using (
    kunde_id is null
    and exists (
      select 1 from public.psa_kunde_verbindungen v
      where v.kunde_user_id = psa_material.user_id
        and v.sachkundiger_user_id = auth.uid()
    )
  );

drop policy if exists "psa_material_insert_verbunden" on public.psa_material;
create policy "psa_material_insert_verbunden"
  on public.psa_material for insert
  to authenticated
  with check (
    kunde_id is null
    and exists (
      select 1 from public.psa_kunde_verbindungen v
      where v.kunde_user_id = psa_material.user_id
        and v.sachkundiger_user_id = auth.uid()
        and v.bearbeiten_erlaubt = true
    )
  );

drop policy if exists "psa_material_update_verbunden" on public.psa_material;
create policy "psa_material_update_verbunden"
  on public.psa_material for update
  to authenticated
  using (
    kunde_id is null
    and exists (
      select 1 from public.psa_kunde_verbindungen v
      where v.kunde_user_id = psa_material.user_id
        and v.sachkundiger_user_id = auth.uid()
        and v.bearbeiten_erlaubt = true
    )
  )
  with check (
    kunde_id is null
    and exists (
      select 1 from public.psa_kunde_verbindungen v
      where v.kunde_user_id = psa_material.user_id
        and v.sachkundiger_user_id = auth.uid()
        and v.bearbeiten_erlaubt = true
    )
  );


-- ============================================================================
-- 7) psa_pruefprotokoll — verbundene Sachkundige Person darf immer prüfen
-- ============================================================================
-- Bewusst UNABHÄNGIG von bearbeiten_erlaubt: "prüfen" ist der Kernzweck der
-- Verbindung und immer erlaubt, auch wenn Material-Bearbeiten (noch) nicht
-- freigegeben ist.

drop policy if exists "psa_pruefprotokoll_select_verbunden" on public.psa_pruefprotokoll;
create policy "psa_pruefprotokoll_select_verbunden"
  on public.psa_pruefprotokoll for select
  to authenticated
  using (
    exists (
      select 1 from public.psa_material m
      join public.psa_kunde_verbindungen v on v.kunde_user_id = m.user_id
      where m.id = psa_pruefprotokoll.material_id
        and m.kunde_id is null
        and v.sachkundiger_user_id = auth.uid()
    )
  );

drop policy if exists "psa_pruefprotokoll_insert_verbunden" on public.psa_pruefprotokoll;
create policy "psa_pruefprotokoll_insert_verbunden"
  on public.psa_pruefprotokoll for insert
  to authenticated
  with check (
    geprueft_von = auth.uid()
    and exists (
      select 1 from public.psa_material m
      join public.psa_kunde_verbindungen v on v.kunde_user_id = m.user_id
      where m.id = psa_pruefprotokoll.material_id
        and m.kunde_id is null
        and v.sachkundiger_user_id = auth.uid()
    )
  );


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> psa_kunde_verbindungen: vorhanden, leer, RLS enabled.
-- psa_sachkundige -> Spalte verbindungscode vorhanden.
-- Database -> Functions -> psa_verbindungscode_erzeugen, psa_verbindung_herstellen vorhanden.
-- ============================================================================
