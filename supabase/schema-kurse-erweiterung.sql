-- BETAMOVE — Erweiterung für die neue Kursanmeldung (Mehrfachauswahl,
-- Ausbildungsart beim Rabatt, Gutscheincode)
-- ============================================================================
-- Baut auf schema.sql auf (muss vorher gelaufen sein). Fügt zwei neue,
-- optionale Spalten zu kursanmeldungen hinzu:
--
--   rabatt_art      — bei Studierenden-/Azubi-Rabatt: "Studium", "Ausbildung"
--                      oder "Praktikum" (frei, NULL wenn kein Rabatt gewählt)
--   gutschein_code  — eingegebener Gutscheincode, so wie eingetippt (NULL
--                      wenn keiner eingegeben wurde). Die Gültigkeitsprüfung
--                      (aktuell: BETAMOVE15) läuft im Frontend, hier wird nur
--                      gespeichert, was eingegeben wurde.
--
-- Mehrere Kurse in einer Anmeldung (z.B. Mehrseillängen + Vorstieg) werden
-- weiterhin in den bestehenden Spalten kurs_id/kurs_titel gespeichert, als
-- kommagetrennte Liste ("msl,halle") — keine Schemaänderung dafür nötig,
-- die Spalten waren schon immer normaler Text mit genug Platz.
--
-- So ausführen: Supabase-Dashboard -> SQL Editor -> New query -> Inhalt
-- einfügen -> Run. Mehrfach ausführbar.

alter table public.kursanmeldungen
  add column if not exists rabatt_art text,
  add column if not exists gutschein_code text;

do $$
begin
  alter table public.kursanmeldungen
    add constraint kursanmeldungen_rabatt_art_len
    check (rabatt_art is null or char_length(rabatt_art) <= 60);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.kursanmeldungen
    add constraint kursanmeldungen_gutschein_len
    check (gutschein_code is null or char_length(gutschein_code) <= 40);
exception when duplicate_object then null;
end $$;
