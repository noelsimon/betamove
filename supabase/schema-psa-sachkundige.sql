-- BETAMOVE — PSA-Prüftool (Schritt 2): Sachkundige-Freischaltung + Kundenmaterial
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-admin-multi.sql und
-- schema-psa-material.sql auf (müssen vorher gelaufen sein).
--
-- Eine Sachkundige Person stellt über ihr eigenes Konto einen Antrag mit
-- Kontaktdaten und Qualifikationsnachweis (psa_sachkundige). Erst nach
-- Freischaltung durch die Kursleitung (admin-psa-sachkundige) darf sie
-- Kund*innen anlegen (kunden) und für sie PSA prüfen (psa_material mit
-- kunde_id). Für das eigene Material (Schritt 1) ändert sich nichts.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) psa_sachkundige — Antrag + Freischaltung, getrennt von admin_emails
-- ============================================================================

create table if not exists public.psa_sachkundige (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references auth.users(id) on delete cascade,
  handynummer             text,
  geburtsdatum            date,
  adresse                 text,
  organisation            text,
  qualifikationsnachweis  text,
  status                  text not null default 'offen',
  freigeschaltet_bis      date,
  created_at              timestamptz not null default now(),

  constraint psa_sachkundige_status_val check (status in ('offen', 'freigeschaltet', 'abgelehnt')),
  constraint psa_sachkundige_handynummer_len check (handynummer is null or char_length(handynummer) <= 40),
  constraint psa_sachkundige_adresse_len check (adresse is null or char_length(adresse) <= 300),
  constraint psa_sachkundige_organisation_len check (organisation is null or char_length(organisation) <= 200),
  constraint psa_sachkundige_qualifikationsnachweis_len check (qualifikationsnachweis is null or char_length(qualifikationsnachweis) <= 500)
);

comment on table public.psa_sachkundige is 'Antrag + Freischaltung als Sachkundige Person fürs PSA-Prüftool — eigene Tabelle, getrennt von admin_emails';
comment on column public.psa_sachkundige.organisation is 'Tätig für BETAMOVE oder extern — bestimmt später das Branding der Prüfbescheinigung';

alter table public.psa_sachkundige enable row level security;

drop policy if exists "psa_sachkundige_select_own_or_admin" on public.psa_sachkundige;
create policy "psa_sachkundige_select_own_or_admin"
  on public.psa_sachkundige for select
  to authenticated
  using (auth.uid() = user_id or public.is_betamove_admin());

drop policy if exists "psa_sachkundige_insert_own" on public.psa_sachkundige;
create policy "psa_sachkundige_insert_own"
  on public.psa_sachkundige for insert
  to authenticated
  with check (auth.uid() = user_id and status = 'offen');

-- Nur die Kursleitung darf einen Antrag freischalten/ablehnen/entziehen.
drop policy if exists "psa_sachkundige_update_admin" on public.psa_sachkundige;
create policy "psa_sachkundige_update_admin"
  on public.psa_sachkundige for update
  to authenticated
  using (public.is_betamove_admin())
  with check (public.is_betamove_admin());


-- ============================================================================
-- 2) ist_sachkundig() — SECURITY DEFINER, analog zu is_betamove_admin()
-- ============================================================================

create or replace function public.ist_sachkundig()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.psa_sachkundige
    where user_id = auth.uid()
      and status = 'freigeschaltet'
      and (freigeschaltet_bis is null or freigeschaltet_bis >= current_date)
  );
$$;

comment on function public.ist_sachkundig() is 'true, wenn die eingeloggte Person als Sachkundige Person freigeschaltet und die Freischaltung noch gültig ist';


-- ============================================================================
-- 3) kunden — von einer Sachkundigen Person erfasst, kein eigenes Konto nötig
-- ============================================================================

create table if not exists public.kunden (
  id             uuid primary key default gen_random_uuid(),
  erstellt_von   uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  kundennummer   text,
  email          text,
  telefon        text,
  created_at     timestamptz not null default now(),

  constraint kunden_name_len check (char_length(trim(name)) between 1 and 200),
  constraint kunden_kundennummer_len check (kundennummer is null or char_length(kundennummer) <= 60),
  constraint kunden_email_len check (email is null or char_length(email) <= 200),
  constraint kunden_telefon_len check (telefon is null or char_length(telefon) <= 40)
);

comment on table public.kunden is 'Von einer Sachkundigen Person erfasste Kund*innen ohne eigenes BETAMOVE-Konto';

create index if not exists kunden_erstellt_von_idx on public.kunden (erstellt_von, created_at desc);

alter table public.kunden enable row level security;

drop policy if exists "kunden_all_own_sachkundig" on public.kunden;
create policy "kunden_all_own_sachkundig"
  on public.kunden for all
  to authenticated
  using (erstellt_von = auth.uid() and public.ist_sachkundig())
  with check (erstellt_von = auth.uid() and public.ist_sachkundig());


-- ============================================================================
-- 4) psa_material erweitern: Kundenmaterial-Zuordnung
-- ============================================================================

alter table public.psa_material add column if not exists kunde_id uuid references public.kunden(id) on delete cascade;
alter table public.psa_material add column if not exists eigentuemer_typ text not null default 'eigen';

alter table public.psa_material drop constraint if exists psa_material_eigentuemer_typ_val;
alter table public.psa_material add constraint psa_material_eigentuemer_typ_val
  check (eigentuemer_typ in ('eigen', 'kunde'));

alter table public.psa_material drop constraint if exists psa_material_kunde_konsistenz;
alter table public.psa_material add constraint psa_material_kunde_konsistenz
  check ((eigentuemer_typ = 'kunde') = (kunde_id is not null));

create index if not exists psa_material_kunde_id_idx on public.psa_material (kunde_id);

comment on column public.psa_material.kunde_id is 'Gesetzt, wenn eigentuemer_typ = kunde — verweist auf kunden.id. user_id bleibt die Sachkundige Person, die prüft.';

-- Insert/Update-Policies aus Schritt 1 ersetzen: Kundenmaterial zusätzlich an
-- ist_sachkundig() geknüpft. Eigenes Material (kunde_id null) unverändert.
drop policy if exists "psa_material_insert_own" on public.psa_material;
create policy "psa_material_insert_own"
  on public.psa_material for insert
  to authenticated
  with check (auth.uid() = user_id and (kunde_id is null or public.ist_sachkundig()));

drop policy if exists "psa_material_update_own" on public.psa_material;
create policy "psa_material_update_own"
  on public.psa_material for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and (kunde_id is null or public.ist_sachkundig()));


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> psa_sachkundige, kunden: vorhanden, leer, RLS enabled.
-- psa_material -> Spalten kunde_id und eigentuemer_typ vorhanden.
-- ============================================================================
