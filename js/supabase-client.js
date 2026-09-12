// BETAMOVE — kleiner Helfer, der aus js/supabase-config.js + dem per CDN
// geladenen Supabase-JS-SDK einen fertigen Client baut. Wird von anmeldung.html
// und kontakt.html genutzt. Kein Build-Schritt, kein npm — alles läuft direkt
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

  function bmGetSupabaseClient() {
    const cfg = window.BETAMOVE_SUPABASE;

    if (!cfg || looksLikePlaceholder(cfg.url) || looksLikePlaceholder(cfg.anonKey)) {
      return { client: null, error: 'not_configured' };
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      return { client: null, error: 'sdk_missing' };
    }
    try {
      const client = window.supabase.createClient(cfg.url, cfg.anonKey);
      return { client, error: null };
    } catch (e) {
      return { client: null, error: 'init_failed' };
    }
  }

  window.bmGetSupabaseClient = bmGetSupabaseClient;
})();
