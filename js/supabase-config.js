// BETAMOVE — Supabase-Konfiguration
// ============================================================================
// Projekt-URL + publishable key sind eingetragen (Stand: siehe Git-Historie).
//
// WICHTIG: Das hier ist bewusst der "publishable"/"anon"-Key, kein Geheimnis —
// er darf öffentlich im Frontend/Repo stehen. Er darf nur das, was die
// Row-Level-Security-Policies in supabase/schema.sql erlauben (ausschließlich
// INSERT in kursanmeldungen/kontaktanfragen, kein Lesen). Der "secret"/
// "service_role"-Key gehört NIE hierher oder in den Browser.
//
// Voraussetzung, damit das Einfügen tatsächlich funktioniert: der komplette
// Inhalt von supabase/schema.sql muss einmalig im Supabase SQL-Editor
// ausgeführt worden sein (legt die Tabellen + RLS-Policies an). Ohne diesen
// Schritt existieren die Tabellen nicht, und jeder Insert schlägt fehl.
//
// Falls `url`/`anonKey` doch mal wieder Platzhalter sind (z. B. in einer
// Kopie dieses Repos), zeigen die Formulare auf anmeldung.html und
// kontakt.html beim Absenden einen sauberen Hinweis ("nicht verbunden") statt
// eines kaputten Fehlers — siehe js/supabase-client.js.
window.BETAMOVE_SUPABASE = {
  url: 'https://nzmszupobienfwjaqcmw.supabase.co',
  anonKey: 'sb_publishable_X6iX2mVHFCD6wczKEAPnpA_gaWXFZuA',
};
