-- BETAMOVE — Gutscheine & Rabatt-Einstellungen (Admin-verwaltet)
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql und schema-admin-kommentare.sql auf
-- (müssen vorher gelaufen sein, liefern das ADMIN_EMAIL-Policy-Muster).
--
-- Bisher waren der Studierenden-/Azubi-Rabatt (fest 15 %) und der eine
-- Gutscheincode "BETAMOVE15" direkt im Code von anmeldung.html hartkodiert.
-- Mit diesem Schema werden beide über eine neue Admin-Seite (admin-rabatte)
-- verwaltbar: beliebig viele Gutscheine (Rabatt-Codes oder Geschenk-
-- gutscheine, jeweils ein fester Euro-Betrag) und ein einstellbarer
-- Studierendenrabatt-Prozentsatz.
--
-- Sicherheitshinweis: Das öffentliche Anmeldeformular muss einen
-- eingegebenen Gutscheincode prüfen können, OHNE die komplette
-- Gutschein-Liste (inkl. aller Geschenkgutschein-Codes!) öffentlich lesbar
-- zu machen — sonst könnte jede*r über die Supabase-API alle aktiven
-- Gutscheincodes abgreifen. Deshalb gibt es für "gutscheine" KEINE
-- Lese-Policy für "anon"/"authenticated", sondern nur eine SECURITY
-- DEFINER-Funktion, die zu einem eingegebenen Code den Wert zurückgibt
-- (oder NULL) — genau wie admin-kurse-verwaltung das schon für
-- Buchungszahlen über kurs_buchungszahlen() macht.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


-- ============================================================================
-- 1) gutscheine — Rabatt-Codes und Geschenkgutscheine (admin-verwaltet)
-- ============================================================================

create table if not exists public.gutscheine (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  typ         text not null default 'rabatt',
  wert_eur    numeric not null,
  aktiv       boolean not null default true,
  notiz       text,
  created_at  timestamptz not null default now(),

  constraint gutscheine_code_len check (char_length(trim(code)) between 3 and 40),
  constraint gutscheine_typ_val check (typ in ('rabatt', 'geschenk')),
  constraint gutscheine_wert_range check (wert_eur > 0 and wert_eur <= 10000),
  constraint gutscheine_notiz_len check (notiz is null or char_length(notiz) <= 500)
);

comment on table public.gutscheine is 'Admin-verwaltete Gutscheine: typ=rabatt (Marketing-/Rabattcode) oder typ=geschenk (Geschenkgutschein), jeweils ein fester Euro-Betrag. Kein direkter Lesezugriff für anon — siehe gutschein_wert().';

create unique index if not exists gutscheine_code_upper_unique on public.gutscheine (upper(code));

alter table public.gutscheine enable row level security;

drop policy if exists "gutscheine_admin_select" on public.gutscheine;
create policy "gutscheine_admin_select"
  on public.gutscheine for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "gutscheine_admin_insert" on public.gutscheine;
create policy "gutscheine_admin_insert"
  on public.gutscheine for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "gutscheine_admin_update" on public.gutscheine;
create policy "gutscheine_admin_update"
  on public.gutscheine for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "gutscheine_admin_delete" on public.gutscheine;
create policy "gutscheine_admin_delete"
  on public.gutscheine for delete
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

-- Öffentliche Prüfung EINES eingegebenen Codes, ohne die Tabelle offenzulegen.
create or replace function public.gutschein_wert(code_input text)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select wert_eur from public.gutscheine
  where upper(code) = upper(trim(code_input)) and aktiv = true
  limit 1;
$$;

grant execute on function public.gutschein_wert(text) to anon, authenticated;


-- ============================================================================
-- 2) rabatt_einstellungen — einstellbarer Studierenden-/Azubi-Rabatt
-- ============================================================================

create table if not exists public.rabatt_einstellungen (
  id                        int primary key default 1,
  studenten_rabatt_prozent  int not null default 15,
  updated_at                timestamptz not null default now(),

  constraint rabatt_einstellungen_single_row check (id = 1),
  constraint rabatt_einstellungen_prozent_range check (studenten_rabatt_prozent between 0 and 100)
);

comment on table public.rabatt_einstellungen is 'Genau eine Zeile (id=1): aktueller Studierenden-/Azubi-Rabatt in Prozent, über admin-rabatte änderbar.';

insert into public.rabatt_einstellungen (id) values (1) on conflict (id) do nothing;

alter table public.rabatt_einstellungen enable row level security;

drop policy if exists "rabatt_einstellungen_admin_select" on public.rabatt_einstellungen;
create policy "rabatt_einstellungen_admin_select"
  on public.rabatt_einstellungen for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

drop policy if exists "rabatt_einstellungen_admin_update" on public.rabatt_einstellungen;
create policy "rabatt_einstellungen_admin_update"
  on public.rabatt_einstellungen for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com')
  with check (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');

-- Öffentlicher Lesezugriff auf GENAU diesen einen Prozentwert (keine
-- Tabellen-Policy für anon nötig/gewünscht, falls hier später mal weitere,
-- nicht-öffentliche Einstellungen dazukommen).
create or replace function public.studenten_rabatt_prozent()
returns int
language sql
security definer
set search_path = public
stable
as $$
  select studenten_rabatt_prozent from public.rabatt_einstellungen where id = 1;
$$;

grant execute on function public.studenten_rabatt_prozent() to anon, authenticated;


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- gutscheine, rabatt_einstellungen -> vorhanden, RLS enabled.
-- rabatt_einstellungen -> genau eine Zeile mit studenten_rabatt_prozent=15.
-- Database -> Functions -> gutschein_wert, studenten_rabatt_prozent vorhanden.
-- ============================================================================
