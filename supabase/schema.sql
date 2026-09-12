-- BETAMOVE — Supabase-Schema für Phase 1
-- ============================================================================
-- Wofür: Tabellen + Row-Level-Security für die zwei öffentlichen Formulare
-- der Website (anmeldung.html, kontakt.html). Kein Server, kein Backend nötig
-- — das Frontend schreibt per Supabase-JS-Client direkt gegen diese Tabellen
-- (siehe js/supabase-client.js).
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> "New query" -> diesen
-- kompletten Dateiinhalt einfügen -> "Run". Einmalig direkt nach Anlage des
-- Supabase-Projekts (EU-Region). Das Skript ist so geschrieben, dass es sich
-- gefahrlos mehrfach ausführen lässt (IF NOT EXISTS / DROP POLICY IF EXISTS),
-- z. B. falls du später eine Policy anpassen willst.
--
-- Sicherheitsprinzip (siehe auch PROJEKTPLAN.md Abschnitt 3.2):
-- Der Supabase "anon key" ist ein öffentlicher Client-Schlüssel, kein
-- Geheimnis — er landet sichtbar im Frontend-Code. Die eigentliche
-- Absicherung kommt ausschließlich aus Row-Level-Security (RLS): beide
-- Tabellen erlauben mit diesem Key NUR das Einfügen (INSERT) neuer Zeilen.
-- Es gibt bewusst KEINE Lese-Policy (SELECT) für die Rolle "anon" — ohne
-- eine solche Policy verweigert Supabase jeden Lesezugriff von außen
-- automatisch. Nur du selbst siehst die Daten, im Supabase-Dashboard
-- (dort läufst du als Projektinhaberin, nicht als "anon").
--
-- Wichtig: Falls du diese Tabellen später im Dashboard ansiehst und aus
-- Versehen eine SELECT-Policy für "anon" hinzufügst, wäre das ein Datenleck
-- (jeder mit dem anon key könnte dann alle Anmeldungen/Anfragen lesen). Lass
-- die Tabellen wie hier eingerichtet.

create extension if not exists pgcrypto; -- liefert gen_random_uuid(); bei Supabase i. d. R. schon aktiv


-- ============================================================================
-- 1) kursanmeldungen — Formular auf anmeldung.html (4-Schritte-Kursanmeldung)
-- ============================================================================

create table if not exists public.kursanmeldungen (
  id              uuid primary key default gen_random_uuid(),
  vorname         text not null,
  nachname        text not null,
  email           text not null,
  telefon         text,
  kurs_id         text not null,          -- z.B. "halle", "paket-komplett" (Slug aus anmeldung.html)
  kurs_titel      text not null,          -- z.B. "Von der Halle an den Fels" (Klartext, für die Dashboard-Ansicht)
  level           text not null,          -- z.B. "Einsteiger*in", "Vorstieg 5. Grad"
  leihmaterial    text[] not null default '{}', -- z.B. {"Gurt","Helm"} — leeres Array = kein Leihmaterial gewünscht
  rabatt_typ      text not null default 'none',  -- 'none' oder 'student' (Studierenden-/Azubi-Rabatt, Nachweis wird vor Ort geprüft)
  anmerkungen     text,
  agb_akzeptiert  boolean not null default false, -- Bestätigung "AGB + Datenschutz gelesen" aus dem Formular
  created_at      timestamptz not null default now(),

  -- Validierung direkt in der Datenbank (unabhängig davon, was das Frontend
  -- schickt — schützt auch gegen direkte API-Aufrufe, die am Formular vorbei
  -- gehen):
  constraint kursanmeldungen_vorname_len check (char_length(trim(vorname)) between 1 and 100),
  constraint kursanmeldungen_nachname_len check (char_length(trim(nachname)) between 1 and 100),
  constraint kursanmeldungen_email_format check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  constraint kursanmeldungen_telefon_len check (telefon is null or char_length(telefon) <= 40),
  constraint kursanmeldungen_kurs_id_len check (char_length(kurs_id) <= 60),
  constraint kursanmeldungen_kurs_titel_len check (char_length(kurs_titel) <= 200),
  constraint kursanmeldungen_level_len check (char_length(level) <= 60),
  constraint kursanmeldungen_rabatt_typ_val check (rabatt_typ in ('none', 'student')),
  constraint kursanmeldungen_anmerkungen_len check (anmerkungen is null or char_length(anmerkungen) <= 2000),
  constraint kursanmeldungen_agb_muss_akzeptiert check (agb_akzeptiert = true)
);

comment on table public.kursanmeldungen is 'Kursanmeldungen aus anmeldung.html (BETAMOVE, Phase 1)';

alter table public.kursanmeldungen enable row level security;

-- Realtime bewusst NICHT für diese Tabelle aktivieren (kein Eintrag in der
-- "supabase_realtime"-Publication) — sonst könnten Clients mit dem anon key
-- neue Zeilen live per Realtime-Subscription mitlesen, obwohl es keine
-- SELECT-Policy gibt.

drop policy if exists "kursanmeldungen_insert_only" on public.kursanmeldungen;
create policy "kursanmeldungen_insert_only"
  on public.kursanmeldungen
  for insert
  to anon
  with check (
    char_length(trim(vorname)) between 1 and 100
    and char_length(trim(nachname)) between 1 and 100
    and email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and char_length(level) <= 60
    and rabatt_typ in ('none', 'student')
    and (anmerkungen is null or char_length(anmerkungen) <= 2000)
    and agb_akzeptiert = true
  );

-- Kein SELECT/UPDATE/DELETE für "anon" — Supabase verweigert das automatisch,
-- solange RLS aktiv ist und keine passende Policy existiert.


-- ============================================================================
-- 2) kontaktanfragen — Kontaktformular auf kontakt.html
-- ============================================================================

create table if not exists public.kontaktanfragen (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  betreff     text,
  nachricht   text not null,
  created_at  timestamptz not null default now(),

  constraint kontaktanfragen_name_len check (char_length(trim(name)) between 1 and 100),
  constraint kontaktanfragen_email_format check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  constraint kontaktanfragen_betreff_len check (betreff is null or char_length(betreff) <= 200),
  constraint kontaktanfragen_nachricht_len check (char_length(trim(nachricht)) between 1 and 3000)
);

comment on table public.kontaktanfragen is 'Kontaktanfragen aus kontakt.html (BETAMOVE, Phase 1)';

alter table public.kontaktanfragen enable row level security;

drop policy if exists "kontaktanfragen_insert_only" on public.kontaktanfragen;
create policy "kontaktanfragen_insert_only"
  on public.kontaktanfragen
  for insert
  to anon
  with check (
    char_length(trim(name)) between 1 and 100
    and email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and char_length(trim(nachricht)) between 1 and 3000
  );


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> kursanmeldungen / kontaktanfragen -> Reiter "Policies":
-- beide Tabellen sollten "RLS enabled" zeigen und genau eine Policy
-- ("... _insert_only", Befehl INSERT, Rolle anon).
-- ============================================================================
