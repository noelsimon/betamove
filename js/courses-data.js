// BETAMOVE — Kursdaten aus Supabase (Tabelle `kurse`).
// Wird von kurse, anmeldung, dem Chatbot (js/main.js) und den Admin-Seiten
// gemeinsam genutzt. Kurse werden direkt im Adminbereich
// (admin-kurse-verwaltung) gepflegt — kein Code-Deployment mehr nötig, wenn
// sich ein Termin, Preis oder Text ändert.
//
// Schnittstelle (unverändert gegenüber der früheren festen Datei):
//   window.BM_COURSES            — Array, erst gültig NACH BM_COURSES_READY
//   window.BM_COURSES_READY      — Promise, löst auf sobald BM_COURSES befüllt ist
//   window.BM_EUR(n)             — Preis formatieren
//   window.BM_COURSES_BY_DATE()  — nach Termin sortiert (ohne Jahrespakete)
//
// WICHTIG für jede Seite, die BM_COURSES liest: erst
// `await window.BM_COURSES_READY` (oder `.then(...)`), bevor darauf
// zugegriffen wird — die Daten kommen jetzt per Fetch aus der Datenbank,
// nicht mehr synchron aus einem festen Array.
//
// WICHTIG für die Script-Reihenfolge im <head>/Body: diese Datei muss NACH
// supabase-config.js und supabase-client.js eingebunden werden, da sie beim
// Laden sofort window.bmGetSupabaseClient() aufruft. Steht sie davor, bricht
// sie den Fetch still ab und BM_COURSES bleibt für immer leer (kein Fehler
// in der Konsole, nur eine leere Kursliste auf der Seite).

window.BM_COURSES = [];

window.BM_EUR = function (n) { return n.toLocaleString('de-DE') + ' €'; };

// Kurse (ohne Jahresausbildungspakete) nach Termin sortiert: bald startende
// Kurse zuerst, Kurse ohne festen Termin immer ans Ende.
window.BM_COURSES_BY_DATE = function (list) {
  const arr = (list || window.BM_COURSES).filter(c => !c.isPaket);
  return arr.slice().sort((a, b) => {
    if (a.sortDate && b.sortDate) return a.sortDate.localeCompare(b.sortDate);
    if (a.sortDate && !b.sortDate) return -1;
    if (!a.sortDate && b.sortDate) return 1;
    return 0;
  });
};

// DB-Zeile (snake_case) -> bisheriges Objektformat (camelCase), damit alle
// bestehenden Konsument*innen unverändert funktionieren.
function bmMapCourseRow(row) {
  return {
    id: row.id,
    title: row.title,
    level: row.level,
    levelBadge: row.level_badge || undefined,
    dauer: row.dauer,
    price: row.price,
    img: row.img || undefined,
    imgPosition: row.img_position || undefined,
    date: row.termin_text,
    sortDate: row.sort_date,
    ort: row.ort,
    teaser: row.teaser || undefined,
    beschreibung: row.beschreibung || undefined,
    lernziel: row.lernziel || undefined,
    inhalte: row.inhalte || undefined,
    voraussetzungen: row.voraussetzungen || undefined,
    equipment: row.equipment || undefined,
    hinweis: row.hinweis || undefined,
    keywords: row.keywords || undefined,
    isPaket: !!row.ist_paket,
    maxTeilnehmer: row.max_teilnehmer || undefined
  };
}

window.BM_COURSES_READY = (async function bmLoadCourses() {
  try {
    if (typeof window.bmGetSupabaseClient !== 'function') return;
    const { client } = window.bmGetSupabaseClient();
    if (!client) return;
    const [coursesRes, countsRes] = await Promise.all([
      client.from('kurse').select('*').eq('aktiv', true).order('sort_date', { ascending: true, nullsFirst: false }),
      client.rpc('kurs_buchungszahlen')
    ]);
    if (coursesRes.error) throw coursesRes.error;
    const counts = {};
    (countsRes.data || []).forEach(row => { counts[row.kurs_id] = row.anzahl; });
    window.BM_COURSES = (coursesRes.data || []).map(row => {
      const c = bmMapCourseRow(row);
      c.gebucht = counts[c.id] || 0;
      c.plaetzeFrei = c.maxTeilnehmer ? Math.max(0, c.maxTeilnehmer - c.gebucht) : null;
      c.ausgebucht = c.maxTeilnehmer ? c.gebucht >= c.maxTeilnehmer : false;
      return c;
    });
  } catch (e) {
    // Kein Netzwerk/keine Verbindung: Seiten, die BM_COURSES nutzen, zeigen
    // dann ihren eigenen "nicht erreichbar"-Hinweis statt harter Fehler.
    window.BM_COURSES = [];
  }
})();
