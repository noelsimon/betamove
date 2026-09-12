// BETAMOVE — Supabase-Konfiguration (PLATZHALTER — noch keine echten Werte)
// ============================================================================
// TODO vor Veröffentlichung: die beiden Werte unten durch die echten Werte aus
// deinem Supabase-Projekt ersetzen.
// Zu finden im Supabase-Dashboard: Project Settings -> API
//   - "Project URL"        -> hier als `url` eintragen (z. B. "https://abcdefghijkl.supabase.co")
//   - "anon" / "public" key -> hier als `anonKey` eintragen
//
// WICHTIG: NICHT den "service_role"-Key hier eintragen! Der anon-Key ist
// bewusst dazu gedacht, öffentlich im Frontend zu stehen — er darf nur das,
// was die Row-Level-Security-Policies in supabase/schema.sql erlauben
// (ausschließlich INSERT in kursanmeldungen/kontaktanfragen, kein Lesen).
// Der service_role-Key hebelt RLS komplett aus und gehört NIE in den Browser.
//
// Ohne echte Werte (so wie jetzt) zeigen die Formulare auf anmeldung.html und
// kontakt.html beim Absenden einen sauberen Hinweis ("nicht verbunden") statt
// eines kaputten Fehlers — siehe js/supabase-client.js.
window.BETAMOVE_SUPABASE = {
  url: 'DEINE-SUPABASE-PROJECT-URL',
  anonKey: 'DEIN-SUPABASE-ANON-KEY',
};
