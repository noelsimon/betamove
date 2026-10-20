-- BETAMOVE — claim_kursanmeldungen_by_email() case-insensitiv machen
-- ============================================================================
-- Hintergrund: Supabase Auth behandelt E-Mail-Adressen case-sensitiv — zwei
-- Konten mit "Anna@Example.de" und "anna@example.de" galten bisher technisch
-- als zwei verschiedene Adressen, obwohl es für die Person "dieselbe Mail"
-- ist. js/account.js (Login/Registrierung) und anmeldung.html schreiben neue
-- E-Mails jetzt konsequent klein geschrieben in die Datenbank — das verhindert
-- künftig doppelte Konten per Groß-/Kleinschreibung.
--
-- Diese Funktion gleicht Gäste-Buchungen (kursanmeldungen ohne user_id) beim
-- Login anhand der E-Mail ab (siehe schema-admin-kommentare.sql). Damit das
-- auch für ÄLTERE Buchungen funktioniert, die noch nicht klein geschrieben
-- gespeichert wurden, vergleicht sie jetzt case-insensitiv (lower() auf
-- beiden Seiten) statt auf exakte Übereinstimmung zu bestehen.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> diesen
-- kompletten Inhalt einfügen -> Run. Mehrfach ausführbar.
-- ============================================================================

create or replace function public.claim_kursanmeldungen_by_email()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kursanmeldungen
  set user_id = auth.uid()
  where user_id is null
    and lower(email) = lower(auth.jwt() ->> 'email');
end;
$$;
