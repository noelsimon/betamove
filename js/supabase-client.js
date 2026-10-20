// BETAMOVE — kleiner Helfer, der aus js/supabase-config.js + dem per CDN
// geladenen Supabase-JS-SDK einen fertigen Client baut. Wird von anmeldung
// und kontakt genutzt. Kein Build-Schritt, kein npm — alles läuft direkt
// im Browser über <script>-Tags.
//
// Absichtlich defensiv: wenn die Konfiguration noch Platzhalterwerte enthält
// (Standardzustand, bevor ein echtes Supabase-Projekt eingetragen wurde) oder
// das SDK aus irgendeinem Grund nicht geladen hat, wirft diese Funktion NICHT,
// sondern gibt einen Fehlergrund zurück — die aufrufende Seite zeigt daraus
// einen normalen, verständlichen Hinweis im Formular statt eines kaputten
// JS-Fehlers in der Konsole.
(function () {
  function looksLikePlaceholder(value) {
    return !value || /^DEINE?-SUPABASE/.test(String(value).trim());
  }

  // WICHTIG: genau EIN Client pro Seite, nicht pro Aufruf. Ein neuer
  // Supabase-Client via createClient() startet seine Session-Prüfung/
  // Token-Erneuerung jedes Mal neu — rief eine Seite bmGetSupabaseClient()
  // an mehreren Stellen auf (z.B. einmal zum Prüfen "bist du eingeloggt?"
  // und kurz danach nochmal für den eigentlichen Insert), liefen das zwei
  // unabhängige Client-Instanzen, die nicht zuverlässig denselben,
  // aktuellen Login-Status hatten — das hat Kursanmeldungen vereinzelt mit
  // "new row violates row-level security policy" scheitern lassen, auch
  // wenn die Person korrekt eingeloggt war.
  let cachedResult;

  function bmGetSupabaseClient() {
    if (cachedResult) return cachedResult;

    const cfg = window.BETAMOVE_SUPABASE;

    if (!cfg || looksLikePlaceholder(cfg.url) || looksLikePlaceholder(cfg.anonKey)) {
      return { client: null, error: 'not_configured' };
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return { client: null, error: 'sdk_missing' };
    }
    try {
      const client = window.supabase.createClient(cfg.url, cfg.anonKey);
      cachedResult = { client, error: null };
      return cachedResult;
    } catch (e) {
      return { client: null, error: 'init_failed' };
    }
  }

  window.bmGetSupabaseClient = bmGetSupabaseClient;
})();
