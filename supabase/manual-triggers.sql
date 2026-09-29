-- BETAMOVE — Manuelle Trigger für E-Mail-Benachrichtigungen (Workaround)
-- ============================================================================
-- Wofür: Das Supabase-Dashboard-Feature "Database → Webhooks" liefert bei
-- diesem Projekt den Fehler "schema supabase_functions does not exist"
-- (bekannter Bug bei manchen Projekten, tritt unabhängig von aktivierten
-- Erweiterungen auf). Dieses Skript umgeht das komplett: Es legt die Trigger
-- direkt per SQL an, über die Erweiterung `pg_net` (Funktionen im Schema
-- `net`) — technisch macht das exakt dasselbe wie ein Database Webhook, nur
-- ohne den kaputten UI-Teil.
--
-- WICHTIG (v2 — Bugfix): Die erste Version dieses Skripts hatte einen
-- ernsten Fehler: Wenn `net.http_post` aus irgendeinem Grund einen Fehler
-- wirft (z.B. Berechtigungsproblem, Extension-Eigenheit), reißt das in
-- Postgres standardmäßig die GESAMTE Transaktion mit — also auch den
-- eigentlichen INSERT der Kursanmeldung/Kontaktanfrage selbst! Das darf nie
-- passieren (das war von Anfang an das Grundprinzip: ein E-Mail-Problem darf
-- eine echte Anmeldung niemals verhindern). Diese Version fängt jeden Fehler
-- beim HTTP-Aufruf ab (BEGIN … EXCEPTION … END) und schreibt ihn nur als
-- Datenbank-Warnung ins Log — der INSERT läuft in jedem Fall durch.
--
-- Falls du die v1 dieses Skripts schon einmal ausgeführt hattest: einfach
-- dieses (neue) Skript erneut komplett ausführen, "create or replace
-- function" überschreibt die alten, fehlerhaften Funktionen sauber.
--
-- Voraussetzung: Beide Edge Functions (notify-kursanmeldung,
-- notify-kontaktanfrage) müssen bereits mit dem echten Code deployt sein
-- (siehe EMAIL-SETUP.md Schritt 4) — dieses Skript ersetzt nur Schritt 5
-- ("Database Webhook einrichten").
--
-- So ausführen: Supabase-Dashboard → SQL Editor → New query → diesen
-- kompletten Inhalt einfügen → Run.

create extension if not exists pg_net with schema extensions;

-- ============================================================================
-- 1) Trigger für kursanmeldungen -> notify-kursanmeldung
-- ============================================================================

create or replace function public.trg_fn_notify_kursanmeldung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://nzmszupobienfwjaqcmw.supabase.co/functions/v1/notify-kursanmeldung',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_X6iX2mVHFCD6wczKEAPnpA_gaWXFZuA'
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'kursanmeldungen',
        'record', to_jsonb(NEW)
      )
    );
  exception when others then
    -- Niemals die Anmeldung selbst blockieren, egal was beim Mail-Trigger
    -- schiefgeht — nur als Warnung loggen (sichtbar in Postgres-Logs).
    raise warning 'trg_fn_notify_kursanmeldung: net.http_post fehlgeschlagen: %', sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_kursanmeldung on public.kursanmeldungen;
create trigger trg_notify_kursanmeldung
  after insert on public.kursanmeldungen
  for each row execute function public.trg_fn_notify_kursanmeldung();

-- ============================================================================
-- 2) Trigger für kontaktanfragen -> notify-kontaktanfrage
-- ============================================================================

create or replace function public.trg_fn_notify_kontaktanfrage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://nzmszupobienfwjaqcmw.supabase.co/functions/v1/notify-kontaktanfrage',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer sb_publishable_X6iX2mVHFCD6wczKEAPnpA_gaWXFZuA'
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'kontaktanfragen',
        'record', to_jsonb(NEW)
      )
    );
  exception when others then
    raise warning 'trg_fn_notify_kontaktanfrage: net.http_post fehlgeschlagen: %', sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists trg_notify_kontaktanfrage on public.kontaktanfragen;
create trigger trg_notify_kontaktanfrage
  after insert on public.kontaktanfragen
  for each row execute function public.trg_fn_notify_kontaktanfrage();

-- ============================================================================
-- Hinweis zum Bearer-Token oben: das ist der öffentliche "publishable"/anon
-- Key (kein Geheimnis, siehe supabase/schema.sql) — er wird hier nur benutzt,
-- damit die Edge Function den Aufruf als legitim erkennt (Supabase verlangt
-- standardmäßig einen gültigen Schlüssel im Authorization-Header). Falls du
-- deinen anon key später einmal rotierst, muss er hier oben in beiden
-- Funktionen (Zeile mit "Authorization") aktualisiert werden.
--
-- Test danach: linkes Hauptmenü -> Database -> Triggers sollte
-- "trg_notify_kursanmeldung" und "trg_notify_kontaktanfrage" zeigen (grüner
-- Haken = aktiv).
--
-- Falls die Mail trotzdem nicht ankommt, jetzt aber die Anmeldung selbst
-- funktioniert: Database -> Logs -> Postgres Logs nach "warning" und
-- "notify_kursanmeldung" filtern, dort steht dann die genaue Fehlermeldung
-- vom net.http_post-Aufruf.
-- ============================================================================
