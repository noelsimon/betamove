-- BETAMOVE — Weitere Teilnehmer*innen pro Kursanmeldung
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql und schema-admin-kommentare.sql auf
-- (müssen vorher gelaufen sein, liefern kursanmeldungen + das
-- ADMIN_EMAIL-Policy-Muster).
--
-- Beim Ausfüllen der Kontaktdaten in der Kursanmeldung (anmeldung.html)
-- kann die anmeldende Person zusätzlich weitere Teilnehmer*innen angeben
-- (z.B. bei einer gemeinsamen Buchung für mehrere Leute). Nur die
-- anmeldende Person selbst schließt den Vertrag ab (bleibt wie bisher in
-- kursanmeldungen); die weiteren Personen werden lediglich mit Name und
-- einer freien Notiz unter der Buchung gespeichert und auf der Admin-Seite
-- (admin-kurse) als "enthaltene Teilnehmer*innen" angezeigt.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


create table if not exists public.kursanmeldung_teilnehmer (
  id            uuid primary key default gen_random_uuid(),
  anmeldung_id  uuid not null references public.kursanmeldungen(id) on delete cascade,
  name          text not null,
  notiz         text,
  created_at    timestamptz not null default now(),

  constraint kursanmeldung_teilnehmer_name_len check (char_length(trim(name)) between 1 and 150),
  constraint kursanmeldung_teilnehmer_notiz_len check (notiz is null or char_length(notiz) <= 500)
);

comment on table public.kursanmeldung_teilnehmer is 'Weitere Teilnehmer*innen (Name + Notiz) unter einer Kursanmeldung — nur die anmeldende Person selbst schließt den Vertrag ab, siehe kursanmeldungen';

create index if not exists kursanmeldung_teilnehmer_anmeldung_id_idx on public.kursanmeldung_teilnehmer (anmeldung_id);

alter table public.kursanmeldung_teilnehmer enable row level security;

-- Wie bei kursanmeldungen: öffentliches Formular darf nur einfügen, keine
-- Lese-Policy für "anon"/"authenticated" — siehe Sicherheitsprinzip in
-- schema.sql.
drop policy if exists "kursanmeldung_teilnehmer_insert_only" on public.kursanmeldung_teilnehmer;
create policy "kursanmeldung_teilnehmer_insert_only"
  on public.kursanmeldung_teilnehmer
  for insert
  to anon, authenticated
  with check (
    char_length(trim(name)) between 1 and 150
    and (notiz is null or char_length(notiz) <= 500)
  );

-- Kursleitung darf alle Teilnehmer*innen-Einträge lesen (Anzeige auf admin-kurse).
drop policy if exists "kursanmeldung_teilnehmer_admin_select" on public.kursanmeldung_teilnehmer;
create policy "kursanmeldung_teilnehmer_admin_select"
  on public.kursanmeldung_teilnehmer for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'noel.uhlrich@gmail.com');


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- kursanmeldung_teilnehmer -> vorhanden, RLS enabled, zwei Policies
--   (Insert + admin_select).
-- ============================================================================
