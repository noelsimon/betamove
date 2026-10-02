// BETAMOVE — Qualifikationen aus Supabase (Tabellen `qualifikationen`,
// `qualifikation_anforderungen`, `lerninhalte`).
// Welcher Artikel/Quiz/welche Prüfung zu welcher Qualifikation gehört, wird
// direkt im Adminbereich (admin-qualifikationen) gepflegt statt fest im Code
// zu stehen — derselbe Lerninhalt kann dabei von mehreren Qualifikationen
// wiederverwendet werden, ohne dupliziert zu werden.
//
// Schnittstelle (unverändert gegenüber der früheren festen Liste in
// js/account.js):
//   window.BM_QUALIFICATIONS       — Array, erst gültig NACH BM_QUALIFICATIONS_READY
//   window.BM_QUALIFICATIONS_READY — Promise, löst auf sobald BM_QUALIFICATIONS befüllt ist
//
// WICHTIG für jede Seite, die BM_QUALIFICATIONS liest: erst
// `await window.BM_QUALIFICATIONS_READY`, bevor darauf zugegriffen wird.

window.BM_QUALIFICATIONS = [];

window.BM_QUALIFICATIONS_READY = (async function bmLoadQualifikationen() {
  try {
    if (typeof window.bmGetSupabaseClient !== 'function') return;
    const { client } = window.bmGetSupabaseClient();
    if (!client) return;

    // Für die Anzeige des Kursnamens bei kind="kurs"-Anforderungen.
    if (window.BM_COURSES_READY) { try { await window.BM_COURSES_READY; } catch (e) {} }

    const [qualsRes, reqsRes, inhalteRes] = await Promise.all([
      client.from('qualifikationen').select('*').eq('aktiv', true).order('sort_order', { ascending: true }),
      client.from('qualifikation_anforderungen').select('*').order('sort_order', { ascending: true }),
      client.from('lerninhalte').select('*')
    ]);
    if (qualsRes.error) throw qualsRes.error;
    if (reqsRes.error) throw reqsRes.error;
    if (inhalteRes.error) throw inhalteRes.error;

    const inhalteById = {};
    (inhalteRes.data || []).forEach(li => { inhalteById[li.id] = li; });

    const reqsByQual = {};
    (reqsRes.data || []).forEach(row => {
      if (!reqsByQual[row.qualifikation_id]) reqsByQual[row.qualifikation_id] = [];
      let req = null;
      if (row.kind === 'kurs') {
        const kursId = row.ref_id.replace(/^kurs-/, '');
        const kurs = (window.BM_COURSES || []).find(c => c.id === kursId);
        req = { id: row.ref_id, kind: 'kurs', label: 'Kurs „' + (kurs ? kurs.title : kursId) + '“ absolvieren', url: 'kurse' };
      } else {
        const li = inhalteById[row.ref_id];
        if (li) req = { id: li.id, kind: li.kind, label: li.label, url: li.url };
      }
      if (req) reqsByQual[row.qualifikation_id].push(req);
    });

    window.BM_QUALIFICATIONS = (qualsRes.data || []).map(q => ({
      id: q.id,
      name: q.name,
      level: q.level,
      text: q.text || '',
      requirements: reqsByQual[q.id] || []
    }));
  } catch (e) {
    // Kein Netzwerk/keine Verbindung: Seiten, die BM_QUALIFICATIONS nutzen,
    // zeigen dann eine leere Liste statt eines harten Fehlers.
    window.BM_QUALIFICATIONS = [];
  }
})();
