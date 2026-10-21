-- BETAMOVE — PSA-Prüftool (Schritt 1): eigenes Material, PSA + Inventar
-- ============================================================================
-- Baut auf schema.sql und schema-konten.sql auf (müssen vorher gelaufen sein).
--
-- Erste Ausbaustufe des PSA-Prüftools: jedes Konto kann eigene persönliche
-- Schutzausrüstung (PSA, z.B. Gurt/Seil/Karabiner — gesetzliche Prüfpflicht
-- nach DGUV 112-198) und sonstiges Inventar ohne Prüfpflicht (Chalkbag,
-- Kletterschuhe etc.) erfassen, selbst prüfen und verleihen. Kundenmaterial
-- (durch eine freigeschaltete Sachkundige Person für andere geprüft) kommt
-- erst in Schritt 2 dazu — bewusst ohne eigentum_typ/kunde_id hier, damit
-- diese Stufe schon diese Woche allein nutzbar ist.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) psa_material — ein Gegenstand (PSA oder Inventar), je Nutzer*in
-- ============================================================================

create table if not exists public.psa_material (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  ist_psa               boolean not null default true,
  ausleihbar            boolean not null default false,
  aktiv                 boolean not null default true,
  kategorie             text not null,
  materialart           text,
  hersteller            text,
  modellbezeichnung     text,
  seriennummer          text,
  chargennummer         text,
  herstellungsdatum     date,
  kaufdatum             date,
  erste_nutzung         date,
  max_lebensdauer_jahre int,
  pruefrhythmus_monate  int,
  notiz                 text,
  created_at            timestamptz not null default now(),

  constraint psa_material_kategorie_len check (char_length(trim(kategorie)) between 1 and 80),
  constraint psa_material_materialart_val check (materialart is null or materialart in ('textil', 'metall', 'textil_metall')),
  constraint psa_material_hersteller_len check (hersteller is null or char_length(hersteller) <= 120),
  constraint psa_material_modell_len check (modellbezeichnung is null or char_length(modellbezeichnung) <= 160),
  constraint psa_material_seriennummer_len check (seriennummer is null or char_length(seriennummer) <= 120),
  constraint psa_material_chargennummer_len check (chargennummer is null or char_length(chargennummer) <= 120),
  constraint psa_material_lebensdauer_val check (max_lebensdauer_jahre is null or max_lebensdauer_jahre between 1 and 99),
  constraint psa_material_pruefrhythmus_val check (pruefrhythmus_monate is null or pruefrhythmus_monate between 1 and 60),
  constraint psa_material_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.psa_material is 'PSA-Prüftool Schritt 1: eigenes Material (PSA + Inventar) je Nutzer*in';
comment on column public.psa_material.ist_psa is 'true = unterliegt der gesetzlichen Prüfpflicht (DGUV 112-198), false = allgemeines Inventar ohne Prüfpflicht';
comment on column public.psa_material.ausleihbar is 'Erscheint unter "Verleih verwalten", wenn true';
comment on column public.psa_material.pruefrhythmus_monate is 'null = kein Rhythmus (typisch für Inventar); 12 = gesetzliches Minimum bei PSA';

create index if not exists psa_material_user_id_idx on public.psa_material (user_id, created_at desc);

alter table public.psa_material enable row level security;

drop policy if exists "psa_material_select_own" on public.psa_material;
create policy "psa_material_select_own"
  on public.psa_material for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "psa_material_insert_own" on public.psa_material;
create policy "psa_material_insert_own"
  on public.psa_material for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "psa_material_update_own" on public.psa_material;
create policy "psa_material_update_own"
  on public.psa_material for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "psa_material_delete_own" on public.psa_material;
create policy "psa_material_delete_own"
  on public.psa_material for delete
  to authenticated
  using (auth.uid() = user_id);


-- ============================================================================
-- 2) psa_pruefprotokoll — Prüfhistorie eines Gegenstands
-- ============================================================================

create table if not exists public.psa_pruefprotokoll (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.psa_material(id) on delete cascade,
  geprueft_von  uuid not null references auth.users(id),
  pruefdatum    date not null default current_date,
  pruefzeit     time not null default current_time,
  ergebnis      text not null,
  notiz         text,
  created_at    timestamptz not null default now(),

  constraint psa_pruefprotokoll_ergebnis_val check (ergebnis in ('gut', 'mangel', 'aussondern')),
  constraint psa_pruefprotokoll_notiz_len check (notiz is null or char_length(notiz) <= 1000)
);

comment on table public.psa_pruefprotokoll is 'Prüfhistorie zu einem psa_material-Eintrag, mit Zeitstempel als einfache "Unterschrift"';

create index if not exists psa_pruefprotokoll_material_id_idx on public.psa_pruefprotokoll (material_id, pruefdatum desc);

alter table public.psa_pruefprotokoll enable row level security;

drop policy if exists "psa_pruefprotokoll_select_own" on public.psa_pruefprotokoll;
create policy "psa_pruefprotokoll_select_own"
  on public.psa_pruefprotokoll for select
  to authenticated
  using (exists (select 1 from public.psa_material m where m.id = material_id and m.user_id = auth.uid()));

drop policy if exists "psa_pruefprotokoll_insert_own" on public.psa_pruefprotokoll;
create policy "psa_pruefprotokoll_insert_own"
  on public.psa_pruefprotokoll for insert
  to authenticated
  with check (
    geprueft_von = auth.uid()
    and exists (select 1 from public.psa_material m where m.id = material_id and m.user_id = auth.uid())
  );


-- ============================================================================
-- 3) psa_ausleihe — Verleih-Historie eines ausleihbaren Gegenstands
-- ============================================================================

create table if not exists public.psa_ausleihe (
  id                 uuid primary key default gen_random_uuid(),
  material_id        uuid not null references public.psa_material(id) on delete cascade,
  ausgeliehen_an     text not null,
  ausgegeben_am      date not null default current_date,
  rueckgabe_geplant  date,
  zurueckgegeben_am  date,
  created_at         timestamptz not null default now(),

  constraint psa_ausleihe_an_len check (char_length(trim(ausgeliehen_an)) between 1 and 160)
);

comment on table public.psa_ausleihe is 'Verleih-Historie je ausleihbarem psa_material-Eintrag — ersetzt eine separate Verleih-Liste';

create index if not exists psa_ausleihe_material_id_idx on public.psa_ausleihe (material_id, ausgegeben_am desc);

alter table public.psa_ausleihe enable row level security;

drop policy if exists "psa_ausleihe_select_own" on public.psa_ausleihe;
create policy "psa_ausleihe_select_own"
  on public.psa_ausleihe for select
  to authenticated
  using (exists (select 1 from public.psa_material m where m.id = material_id and m.user_id = auth.uid()));

drop policy if exists "psa_ausleihe_write_own" on public.psa_ausleihe;
create policy "psa_ausleihe_write_own"
  on public.psa_ausleihe for all
  to authenticated
  using (exists (select 1 from public.psa_material m where m.id = material_id and m.user_id = auth.uid()))
  with check (exists (select 1 from public.psa_material m where m.id = material_id and m.user_id = auth.uid()));


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> psa_material, psa_pruefprotokoll, psa_ausleihe: vorhanden,
-- leer, RLS enabled.
-- ============================================================================
