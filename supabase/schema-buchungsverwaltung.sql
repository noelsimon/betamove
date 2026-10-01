-- BETAMOVE — Schema-Erweiterung für vollständige Buchungsverwaltung
-- ============================================================================
-- Baut auf schema.sql, schema-konten.sql, schema-admin-kommentare.sql und
-- schema-pruefungen-zertifikate.sql auf (müssen vorher gelaufen sein).
--
-- Dieses Skript fügt hinzu:
--
--   1) `kursanmeldungen.storniert` / `storniert_at` — eine Buchung kann
--      storniert werden, sowohl von der buchenden Person selbst (nur die
--      eigene Buchung, über die Funktion cancel_kursanmeldung) als auch von
--      der Kursleitung (über die bereits bestehende Admin-Update-Policy aus
--      schema-admin-kommentare.sql — keine neue Policy nötig).
--
--   2) `kursanmeldungen.admin_notiz` — freies Notizfeld, nur für die
--      Kursleitung sicht- und schreibbar (ebenfalls über die bestehende
--      Admin-Policy abgedeckt).
--
-- WICHTIG: Wie bei den vorherigen Dateien — ersetze 'noel.uhlrich@gmail.com'
-- durch die tatsächliche Login-Adresse der Kursleitung, falls nötig.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================


alter table public.kursanmeldungen
  add column if not exists storniert boolean not null default false,
  add column if not exists storniert_at timestamptz,
  add column if not exists admin_notiz text;

comment on column public.kursanmeldungen.storniert is 'Von der buchenden Person selbst oder der Kursleitung storniert';
comment on column public.kursanmeldungen.admin_notiz is 'Freie Notiz der Kursleitung, nicht für die buchende Person sichtbar';


-- Eigene Buchung stornieren: läuft als security-definer-Funktion und ändert
-- ausschließlich storniert/storniert_at der EIGENEN Buchung — wie bei
-- claim_kursanmeldungen_by_email bewusst keine direkte UPDATE-Policy fürs
-- Frontend, damit darüber nicht versehentlich auch teilnahme_bestaetigt oder
-- andere Felder verändert werden könnten.
create or replace function public.cancel_kursanmeldung(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kursanmeldungen
  set storniert = true,
      storniert_at = now()
  where id = p_booking_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.cancel_kursanmeldung(uuid) to authenticated;


-- ============================================================================
-- Nach dem Ausführen prüfen (im Dashboard):
-- Table Editor -> kursanmeldungen: drei neue Spalten storniert /
-- storniert_at / admin_notiz.
-- Database -> Functions: cancel_kursanmeldung sollte gelistet sein.
-- ============================================================================
