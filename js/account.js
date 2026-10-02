// BETAMOVE — Lernkonto: Auth, Profil, Lernfortschritt, Qualifikationen.
// ============================================================================
// Läuft auf jeder Seite (geladen nach js/main.js). Ohne Supabase-Konfiguration
// oder ohne eingeloggte Person tut dieses Skript nichts außer der stillen
// Grundprüfung — die Seite funktioniert dann genau wie vorher (anonym, nur
// lokal per bmProgress). Erst mit einem echten, eingeloggten Konto werden
// Profil, gebuchte Kurse und Qualifikationen aus Supabase geladen.
//
// Datenmodell (siehe supabase/schema-konten.sql):
//   profiles         — 1 Zeile pro Konto (Vorname, Nachname, E-Mail, Level)
//   lernfortschritt  — 1 Zeile pro erledigtem Inhalt (Artikel/Quiz/Prüfung/Kurs)
//   kursanmeldungen  — bekommt zusätzlich eine user_id, wenn beim Buchen
//                       eine Person eingeloggt ist (siehe anmeldung)

(function () {
  // Login-Adresse der Kursleitung — muss exakt zu den Admin-Policies in
  // supabase/schema-admin-kommentare.sql passen (auth.jwt() ->> 'email').
  const ADMIN_EMAIL = 'noel.uhlrich@gmail.com';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // --------------------------------------------------------------------
  // Kursname zu einer kurs_id — liest live aus der Kurse-Tabelle
  // (window.BM_COURSES), damit hier nichts doppelt gepflegt werden muss.
  // --------------------------------------------------------------------
  function courseTitle(id) {
    const c = (window.BM_COURSES || []).find(c => c.id === id);
    return c ? c.title : null;
  }

  // --------------------------------------------------------------------
  // Qualifikationen — einzige Quelle der Wahrheit für Fortschritt & Zertifikate.
  // Jede Anforderung verweist auf eine item_id aus `lernfortschritt`
  // (kind 'artikel' | 'quiz' | 'pruefung' | 'kurs').
  // --------------------------------------------------------------------
  const QUALIFICATIONS = [
    {
      id: 'sicherungsschein-toprope',
      name: 'Sicherungsschein Toprope',
      level: 'Einstieg',
      text: 'Sicher Toprope sichern, weich fangen und Gewichtsunterschiede einschätzen – die Basis für alles Weitere.',
      requirements: [
        { id: 'quiz-sichern', kind: 'quiz', label: 'Quiz „Sichern ohne Mythen“ bestehen', url: 'quiz-sichern' },
        { id: 'pruefung-sturztraining', kind: 'pruefung', label: 'Online-Prüfung Sturz- und Sicherungstraining bestehen', url: 'pruefung-sturztraining' },
        { id: 'kurs-sturz', kind: 'kurs', label: 'Kurs „Sturz- und Sicherungstraining“ absolvieren', url: 'kurse' }
      ]
    },
    {
      id: 'vorstiegsschein-indoor',
      name: 'Vorstiegsschein Indoor',
      level: 'Einstieg',
      text: 'Im Vorstieg klettern und sichern in der Halle, auf aktuellem Stand der Lehrmeinung.',
      requirements: [
        { id: 'pruefung-sicherungsschein', kind: 'pruefung', label: 'Online-Prüfung Sicherungstheorie bestehen', url: 'pruefung-sicherungsschein' },
        { id: 'sicherungsgeraete', kind: 'artikel', label: 'Artikel „Sicherungsgeräte im Überblick“ durcharbeiten', url: 'artikel-sicherungsgeraete' },
        { id: 'kurs-update', kind: 'kurs', label: 'Kurs „Sicherungs-Update“ absolvieren', url: 'kurse' }
      ]
    },
    {
      id: 'freigabe-naturfels',
      name: 'Freigabe Naturfels',
      level: 'Aufbau',
      text: 'Der erste Schritt vom Hallen- ins Felsklettern, mit dem richtigen Material im Rucksack.',
      requirements: [
        { id: 'halle-an-den-fels', kind: 'artikel', label: 'Artikel „Halle an den Fels“ durcharbeiten', url: 'artikel-halle-an-den-fels' },
        { id: 'quiz-fels', kind: 'quiz', label: 'Quiz „Der erste Tag am Fels“ bestehen', url: 'quiz-fels' },
        { id: 'kletterschuhe-finden', kind: 'artikel', label: 'Artikel „Kletterschuhe finden“ lesen', url: 'artikel-kletterschuhe-finden' },
        { id: 'pruefung-naturfels', kind: 'pruefung', label: 'Online-Prüfung Naturfels bestehen', url: 'pruefung-naturfels' },
        { id: 'kurs-halle', kind: 'kurs', label: 'Kurs „Von der Halle an den Fels“ absolvieren', url: 'kurse' }
      ]
    },
    {
      id: 'mehrseillaengen-kompetenz',
      name: 'Mehrseillängen-Kompetenz',
      level: 'Fortgeschritten',
      text: 'Sicher unterwegs auf mehreren Seillängen – Standplatzbau und Taktik inklusive.',
      requirements: [
        { id: 'mehrseillaengen-taktik', kind: 'artikel', label: 'Artikel „Richtig Mehrseillängen planen“ durcharbeiten', url: 'artikel-mehrseillaengen-taktik' },
        { id: 'pruefung-mehrseillaengen', kind: 'pruefung', label: 'Online-Prüfung Mehrseillängen bestehen', url: 'pruefung-mehrseillaengen' },
        { id: 'kurs-msl', kind: 'kurs', label: 'Kurs „Mehrseillängen für Fortgeschrittene“ absolvieren', url: 'kurse' }
      ]
    }
  ];

  // Für die Zertifikat-Seite (zertifikat.html) les- und wiederverwendbar.
  window.BM_QUALIFICATIONS = QUALIFICATIONS;

  // Alle Nicht-Kurs-Inhalte (Artikel/Quiz/Prüfung), dedupliziert — Basis für
  // "Mein Lernstand" / "Weiterlernen".
  const CONTENT_ITEMS = (function () {
    const seen = {};
    const out = [];
    QUALIFICATIONS.forEach(q => q.requirements.forEach(r => {
      if (r.kind !== 'kurs' && !seen[r.id]) { seen[r.id] = true; out.push(r); }
    }));
    return out;
  })();

  function badgeFor(done, total) {
    if (total > 0 && done >= total) return { label: 'Abgeschlossen', bg: 'var(--color-accent-2-500)', fg: '#ffffff' };
    if (done > 0) return { label: 'In Arbeit', bg: 'var(--color-accent-100)', fg: 'var(--color-accent-800)' };
    return { label: 'Offen', bg: 'var(--color-neutral-200)', fg: 'var(--color-neutral-800)' };
  }

  function qualProgress(qual, progress) {
    const total = qual.requirements.length;
    const done = qual.requirements.filter(r => progress[r.id] && progress[r.id].passed).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0, badge: badgeFor(done, total) };
  }

  // --------------------------------------------------------------------
  // Supabase-Zugriff
  // --------------------------------------------------------------------
  let cachedClient;
  function getClient() {
    if (cachedClient !== undefined) return cachedClient;
    if (typeof window.bmGetSupabaseClient !== 'function') { cachedClient = null; return cachedClient; }
    const { client } = window.bmGetSupabaseClient();
    cachedClient = client;
    return cachedClient;
  }

  async function getSession() {
    const client = getClient();
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data && data.session ? data.session : null;
    } catch (e) { return null; }
  }

  async function ensureProfile(client, user, extra) {
    const meta = user.user_metadata || {};
    const payload = Object.assign({
      id: user.id,
      vorname: meta.vorname || 'Kletterer*in',
      nachname: meta.nachname || '',
      email: user.email || '',
      level: meta.level || null
    }, extra || {});
    try {
      await client.from('profiles').upsert(payload, { onConflict: 'id', ignoreDuplicates: false });
    } catch (e) { /* Netzwerk/Policy-Problem: Seite bleibt trotzdem nutzbar */ }
  }

  async function fetchProfile(client, userId) {
    try {
      const { data } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
      return data || null;
    } catch (e) { return null; }
  }

  async function fetchProgress(client, userId) {
    const map = {};
    try {
      const { data } = await client.from('lernfortschritt').select('*').eq('user_id', userId);
      (data || []).forEach(row => { map[row.item_id] = row; });
    } catch (e) { /* leer bleibt leer */ }
    return map;
  }

  async function fetchBookings(client, userId) {
    try {
      const { data } = await client.from('kursanmeldungen').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      return data || [];
    } catch (e) { return []; }
  }

  // Von anderen Seiten aufrufbar (Artikel "Als gelesen markieren", Quiz- und
  // Prüfungs-Auswertung, Kurs-Toggle): schreibt EINE Zeile in lernfortschritt,
  // wenn eine Person eingeloggt ist. Ohne Konto passiert nichts — die Seiten
  // funktionieren dann wie bisher rein lokal über bmProgress.
  window.bmSyncLernfortschritt = async function (itemId, kind, opts) {
    const client = getClient();
    if (!client) return;
    const session = await getSession();
    if (!session) return;
    const payload = {
      user_id: session.user.id,
      item_id: itemId,
      kind: kind,
      score: opts && typeof opts.score === 'number' ? opts.score : null,
      total: opts && typeof opts.total === 'number' ? opts.total : null,
      passed: !opts || opts.passed !== false
    };
    try {
      await client.from('lernfortschritt').upsert(payload, { onConflict: 'user_id,item_id' });
    } catch (e) { /* still lokal weiter, kein UI-Fehler nötig */ }
  };

  // Für die Kursbuchung (anmeldung): liefert die eingeloggte user_id
  // oder null, damit die Buchung optional mit dem Konto verknüpft wird.
  window.bmCurrentUserId = async function () {
    const session = await getSession();
    return session ? session.user.id : null;
  };

  // Für die Prüfungsseiten: prüft, ob die aktuell eingeloggte Person diese
  // Prüfung ablegen darf. Prüfungen sind grundsätzlich nur mit Konto nutzbar
  // und müssen zusätzlich von der Kursleitung freigeschaltet sein (siehe
  // admin-pruefungen, supabase/schema-pruefungen-zertifikate.sql).
  // Rückgabe: 'no-client' | 'no-session' | 'locked' | 'unlocked' | 'error'.
  window.bmCheckExamGate = async function (examId) {
    const client = getClient();
    if (!client) return 'no-client';
    const session = await getSession();
    if (!session) return 'no-session';
    try {
      const { data, error } = await client.from('pruefungsfreigaben').select('id').eq('user_id', session.user.id).eq('pruefung_id', examId).maybeSingle();
      if (error) throw error;
      return data ? 'unlocked' : 'locked';
    } catch (e) {
      return 'error';
    }
  };

  // Prüfungsergebnis serverseitig auswerten lassen (supabase/schema-
  // sicherheitsfixes.sql, Funktion submit_pruefung) statt es nur vom Browser
  // zu übernehmen — die Funktion prüft Freischaltung und Antworten selbst
  // nach und trägt erst dann ein Ergebnis in lernfortschritt ein.
  // Rückgabe: { score, total, passed } oder null ohne Konto/Verbindung.
  window.bmSubmitExam = async function (examId, answers) {
    const client = getClient();
    if (!client) return null;
    try {
      const { data, error } = await client.rpc('submit_pruefung', { p_pruefung_id: examId, p_answers: answers });
      if (error) throw error;
      return (data && data[0]) || null;
    } catch (e) {
      return null;
    }
  };

  // --------------------------------------------------------------------
  // Admin-Seiten (admin-kurse, admin-pruefungen, admin-kurse-verwaltung):
  // gemeinsamer Zugriffsschutz statt pro Seite dupliziertem Code. Erwartet
  // auf der Seite die Elemente #statusBox und #adminArea. Gibt
  // { client, session } zurück, oder null, wenn die Seite wegen
  // fehlendem/falschem Login bereits den Status angezeigt hat.
  // --------------------------------------------------------------------
  function showAdminStatus(html) {
    const box = document.getElementById('statusBox');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = html;
    const area = document.getElementById('adminArea');
    if (area) area.hidden = true;
  }

  window.bmGuardAdminPage = async function () {
    const client = getClient();
    if (!client) {
      const cfgErr = typeof window.bmGetSupabaseClient === 'function' ? window.bmGetSupabaseClient().error : null;
      showAdminStatus(cfgErr
        ? '<p style="margin:0;font-size:15.5px;color:var(--color-accent-700)">Admin-Bereich ist gerade nicht erreichbar (' + escapeHtml(cfgErr) + ').</p>'
        : '<p style="margin:0;font-size:15.5px;color:var(--color-accent-700)">Admin-Bereich ist gerade nicht erreichbar.</p>');
      return null;
    }

    const session = await getSession();
    if (!session) {
      const here = (location.pathname.split('/').pop() || 'admin-kurse').replace(/\.html$/i, '');
      showAdminStatus('<p style="margin:0 0 16px;font-size:15.5px">Bitte melde dich mit deinem Admin-Konto an.</p><a href="login?next=' + encodeURIComponent(here) + '" class="btn btn-primary" style="font-size:15px;padding:12px 22px">Anmelden</a>');
      return null;
    }
    if (session.user.email !== ADMIN_EMAIL) {
      showAdminStatus('<p style="margin:0;font-size:15.5px;color:var(--color-accent-700)">Dieser Bereich ist nur für die Kursleitung zugänglich.</p>');
      return null;
    }

    document.getElementById('statusBox').hidden = true;
    const area = document.getElementById('adminArea');
    if (area) area.hidden = false;
    return { client, session };
  };

  window.bmEscapeHtml = escapeHtml;

  // --------------------------------------------------------------------
  // Kleine Kette an gemeinsamer UI: Header-Login-Link + stiller Abgleich
  // der lokal gespeicherten "gelesen"-Markierungen (bmProgress) auf jeder
  // Seite, nicht nur im Konto-Bereich.
  // --------------------------------------------------------------------
  function syncNavHeader(session) {
    const navLogin = document.querySelector('.nav-login');
    if (navLogin && session) {
      navLogin.setAttribute('href', 'konto');
      const span = navLogin.querySelector('span');
      if (span) span.textContent = 'Mein Konto';
    }
  }

  async function syncHeaderAndLocalProgress() {
    const session = await getSession();
    syncNavHeader(session);
    if (!session) return;
    const client = getClient();
    if (!client) return;
    const progress = await fetchProgress(client, session.user.id);
    try {
      Object.keys(progress).forEach(itemId => { if (progress[itemId].passed) bmProgress.markDone(itemId); });
    } catch (e) { /* bmProgress kommt aus main.js, sollte immer da sein */ }
  }

  // --------------------------------------------------------------------
  // Konto-Seiten: Login-Zwang, Sidebar füllen, Logout verdrahten.
  // Gibt { client, session, profile, progress, bookings } zurück oder null,
  // wenn die Seite wegen fehlendem Login bereits weggeleitet wurde.
  // --------------------------------------------------------------------
  async function guardAccountPage() {
    const client = getClient();
    const banner = document.querySelector('.preview-banner');

    if (!client) {
      if (banner) { banner.hidden = false; banner.innerHTML = '<span>Kontofunktionen sind gerade nicht verfügbar (Supabase nicht erreichbar). Bitte später erneut versuchen.</span>'; }
      return null;
    }

    const session = await getSession();
    if (!session) {
      const here = location.pathname.split('/').pop() || 'konto';
      location.href = 'login?next=' + encodeURIComponent(here);
      return null;
    }
    if (banner) banner.remove();
    syncNavHeader(session);
    if (window.BM_COURSES_READY) { try { await window.BM_COURSES_READY; } catch (e) {} }

    await ensureProfile(client, session.user);
    // Gäste-Buchungen mit der gleichen E-Mail nachträglich mit diesem Konto
    // verknüpfen (siehe claim_kursanmeldungen_by_email in
    // supabase/schema-admin-kommentare.sql).
    try { await client.rpc('claim_kursanmeldungen_by_email'); } catch (e) { /* Funktion evtl. noch nicht angelegt — Seite bleibt trotzdem nutzbar */ }
    const [profile, progress, bookings] = await Promise.all([
      fetchProfile(client, session.user.id),
      fetchProgress(client, session.user.id),
      fetchBookings(client, session.user.id)
    ]);

    // Kursteilnahme kommt nicht mehr aus einem Selbst-Toggle, sondern aus der
    // Bestätigung der Kursleitung auf der jeweiligen Buchung (siehe
    // admin-kurse). Alte, selbst gesetzte "kurs-*"-Einträge aus der Zeit vor
    // dieser Umstellung werden hier bewusst verworfen und komplett durch den
    // aktuellen Buchungsstatus ersetzt.
    Object.keys(progress).forEach(key => { if (key.indexOf('kurs-') === 0) delete progress[key]; });
    bookings.forEach(b => {
      if (b.teilnahme_bestaetigt && !b.storniert) {
        progress['kurs-' + b.kurs_id] = { passed: true, created_at: b.teilnahme_bestaetigt_at || b.created_at };
      }
    });

    const navEl = document.querySelector('[data-r="konto-nav"]');
    if (navEl && session.user.email === ADMIN_EMAIL && !navEl.querySelector('[data-admin-link]')) {
      const adminLink = document.createElement('a');
      adminLink.href = 'admin-kurse';
      adminLink.dataset.adminLink = 'true';
      adminLink.style.cssText = 'text-decoration:none;font-size:15.5px;font-weight:500;padding:13px 18px;border-radius:999px;background:#ffffff;color:var(--color-accent-700);border:2px dashed var(--color-accent-300);display:flex;align-items:center;gap:10px';
      adminLink.textContent = 'Kursverwaltung (Admin)';
      navEl.appendChild(adminLink);
    }

    const vorname = (profile && profile.vorname) || session.user.user_metadata.vorname || 'Kletterer*in';
    const nachname = (profile && profile.nachname) || session.user.user_metadata.nachname || '';
    const email = (profile && profile.email) || session.user.email || '';
    const level = (profile && profile.level) || '';
    const initials = ((vorname[0] || '') + (nachname[0] || '')).toUpperCase() || 'BM';

    document.querySelectorAll('[data-acc="initials"]').forEach(el => el.textContent = initials);
    document.querySelectorAll('[data-acc="name"]').forEach(el => el.textContent = (vorname + ' ' + nachname).trim());
    document.querySelectorAll('[data-acc="firstname"]').forEach(el => el.textContent = vorname);
    document.querySelectorAll('[data-acc="email"]').forEach(el => el.textContent = email);
    document.querySelectorAll('[data-acc="level"]').forEach(el => {
      if (level) { el.textContent = level; el.hidden = false; } else { el.hidden = true; }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try { await client.auth.signOut(); } catch (e) {}
        location.href = '/';
      });
    }

    return { client, session, profile: profile || { vorname, nachname, email, level }, progress, bookings };
  }

  // Kursteilnahme ist nicht mehr klickbar — die Bestätigung kommt von der
  // Kursleitung (siehe admin-kurse), hier wird nur noch der Status angezeigt.
  function paintCourseStatus(progress) {
    document.querySelectorAll('.toggle-course[data-course]').forEach(el => {
      const courseId = el.dataset.course;
      const itemId = 'kurs-' + courseId;
      const done = !!(progress[itemId] && progress[itemId].passed);
      el.dataset.active = String(done);
    });
  }

  // --------------------------------------------------------------------
  // Seite: konto — Übersicht
  // --------------------------------------------------------------------
  async function renderKonto(ctx) {
    const { progress, bookings } = ctx;
    const qualStats = QUALIFICATIONS.map(q => Object.assign({ qual: q }, qualProgress(q, progress)));
    const qualDone = qualStats.filter(q => q.done >= q.total).length;
    const activeBookings = bookings.filter(b => !b.storniert).length;
    const examCount = CONTENT_ITEMS.filter(c => c.kind === 'pruefung' && progress[c.id] && progress[c.id].passed).length;

    const statQual = document.getElementById('statQual');
    if (statQual) statQual.textContent = qualDone + '/' + QUALIFICATIONS.length;
    const statContent = document.getElementById('statContent');
    if (statContent) statContent.textContent = String(activeBookings);
    const statExams = document.getElementById('statExams');
    if (statExams) statExams.textContent = String(examCount);

    renderGebuchteKurse(ctx);

    // Nächster offener Schritt: erste offene Anforderung über alle Qualifikationen
    const nextBox = document.getElementById('nextStepBox');
    let nextReq = null;
    for (const q of QUALIFICATIONS) {
      for (const r of q.requirements) {
        if (!(progress[r.id] && progress[r.id].passed)) { nextReq = r; break; }
      }
      if (nextReq) break;
    }
    if (nextBox) {
      if (nextReq) {
        nextBox.hidden = false;
        const t = document.getElementById('nextStepTitle'); if (t) t.textContent = nextReq.label.replace(/ (bestehen|durcharbeiten|lesen|absolvieren)$/, '');
        const l = document.getElementById('nextStepLink'); if (l) l.setAttribute('href', nextReq.url);
      } else {
        nextBox.hidden = true;
      }
    }

    // Qualifikationen-Liste (kompakt)
    const qualList = document.getElementById('qualList');
    if (qualList) {
      qualList.innerHTML = qualStats.map(q => `
        <a href="konto-qualifikationen" class="hover-border" style="text-decoration:none;color:inherit;background:#ffffff;border:1px solid var(--color-divider);border-radius:calc(var(--radius-lg) * 1.15);padding:22px 26px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <h3 style="margin:0;font-size:20px">${escapeHtml(q.qual.name)}</h3>
            <span style="margin-left:auto;font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 11px;border-radius:999px;background:${q.badge.bg};color:${q.badge.fg}">${q.badge.label}</span>
          </div>
          <div style="height:8px;border-radius:999px;background:var(--color-surface);overflow:hidden"><div style="height:100%;width:${q.pct}%;background:var(--color-accent);border-radius:999px"></div></div>
          <span style="font-size:14px;opacity:0.7">${q.done} von ${q.total} Anforderungen erfüllt</span>
        </a>`).join('');
    }

    // Prüfungsnachweise
    const examList = document.getElementById('examList');
    if (examList) {
      const exams = CONTENT_ITEMS.filter(c => c.kind === 'pruefung' && progress[c.id] && progress[c.id].passed);
      examList.innerHTML = exams.length ? exams.map(e => {
        const row = progress[e.id];
        const date = row.created_at ? new Date(row.created_at).toLocaleDateString('de-DE') : '';
        return `<div style="background:#ffffff;border-radius:var(--radius-md);padding:16px 18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:150px">
            <div style="font-size:16.5px;font-weight:600">${escapeHtml(e.label)}</div>
            <div style="font-size:14px;opacity:0.7;margin-top:3px">${row.score != null ? row.score + '/' + row.total + ' richtig · ' : ''}${date}</div>
          </div>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.7">Noch kein Prüfungsnachweis — leg die Online-Prüfung ab, sobald du bereit bist.</p>';
    }

    // Weiterlernen: bis zu 3 offene Inhalte
    const weiterlernenList = document.getElementById('weiterlernenList');
    if (weiterlernenList) {
      const open = CONTENT_ITEMS.filter(c => !(progress[c.id] && progress[c.id].passed)).slice(0, 3);
      const typeLabel = { artikel: 'Artikel', quiz: 'Quiz', pruefung: 'Online-Prüfung' };
      weiterlernenList.innerHTML = open.length ? open.map(c => `
        <a href="${c.url}" style="display:flex;gap:12px;justify-content:space-between;align-items:baseline;text-decoration:none;color:var(--color-text);font-size:15.5px;padding-bottom:10px;border-bottom:1px solid var(--color-divider)"><span>${escapeHtml(c.label)}</span><span style="font-size:13px;opacity:0.6;flex:none">${typeLabel[c.kind] || ''}</span></a>
      `).join('') : '<p style="margin:0;font-size:15px;opacity:0.7">Alles bearbeitet — schau auf konto-qualifikationen, ob noch ein Kurs fehlt.</p>';
    }
  }

  // --------------------------------------------------------------------
  // Seite: konto-profil
  // --------------------------------------------------------------------
  async function renderProfil(ctx) {
    const { client, session, profile } = ctx;
    const fields = {
      vorname: document.getElementById('fVorname'),
      nachname: document.getElementById('fNachname'),
      email: document.getElementById('fEmail'),
      level: document.getElementById('fLevel')
    };
    if (fields.vorname) fields.vorname.value = profile.vorname || '';
    if (fields.nachname) fields.nachname.value = profile.nachname || '';
    if (fields.email) fields.email.value = profile.email || session.user.email || '';
    document.querySelectorAll('.level-opt').forEach(btn => {
      btn.dataset.active = String(btn.textContent.trim() === profile.level);
      btn.addEventListener('click', () => {
        document.querySelectorAll('.level-opt').forEach(b => b.dataset.active = String(b === btn));
      });
    });

    const saveBtn = document.getElementById('saveProfileBtn');
    const savedMsg = document.getElementById('profileSaved');
    const errMsg = document.getElementById('profileError');
    if (saveBtn) {
      saveBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (savedMsg) savedMsg.hidden = true;
        if (errMsg) errMsg.hidden = true;
        const activeLevel = document.querySelector('.level-opt[data-active="true"]');
        const payload = {
          id: session.user.id,
          vorname: (fields.vorname && fields.vorname.value.trim()) || profile.vorname,
          nachname: (fields.nachname && fields.nachname.value.trim()) || profile.nachname,
          email: profile.email || session.user.email,
          level: activeLevel ? activeLevel.textContent.trim() : profile.level
        };
        try {
          const { error } = await client.from('profiles').upsert(payload, { onConflict: 'id' });
          if (error) throw error;
          if (savedMsg) savedMsg.hidden = false;
        } catch (err) {
          if (errMsg) { errMsg.hidden = false; errMsg.textContent = 'Konnte nicht gespeichert werden. Bitte später erneut versuchen.'; }
        }
      });
    }
  }

  // --------------------------------------------------------------------
  // Seite: konto-lernen
  // --------------------------------------------------------------------
  async function renderLernen(ctx) {
    const { progress } = ctx;
    const total = CONTENT_ITEMS.length;
    const done = CONTENT_ITEMS.filter(c => progress[c.id] && progress[c.id].passed).length;
    const bar = document.getElementById('lernenBar');
    if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
    const label = document.getElementById('lernenLabel');
    if (label) label.textContent = done + ' von ' + total + ' Inhalten bearbeitet';

    const doneList = document.getElementById('bearbeitetList');
    if (doneList) {
      const typeLabel = { artikel: 'Gelesen', quiz: null, pruefung: null };
      const items = CONTENT_ITEMS.filter(c => progress[c.id] && progress[c.id].passed);
      doneList.innerHTML = items.length ? items.map(c => {
        const row = progress[c.id];
        const right = row.score != null ? row.score + '/' + row.total : (typeLabel[c.kind] || 'Erledigt');
        return `<a href="${c.url}" style="display:flex;gap:12px;justify-content:space-between;align-items:baseline;text-decoration:none;color:var(--color-text);font-size:15.5px;padding-bottom:11px;border-bottom:1px solid var(--color-divider)"><span>${escapeHtml(c.label)}</span><span style="font-size:13.5px;opacity:0.65;flex:none">${escapeHtml(right)}</span></a>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.7">Noch nichts bearbeitet — schau auf wissen vorbei.</p>';
    }

    const coursesList = document.getElementById('kurseList');
    if (coursesList) {
      const courseIds = (window.BM_COURSES || []).filter(c => !c.isPaket).map(c => c.id);
      coursesList.innerHTML = courseIds.map(id => {
        const itemId = 'kurs-' + id;
        const doneRow = progress[itemId];
        return `<div class="toggle-course" data-course="${id}" style="display:flex;gap:12px;align-items:center;background:#ffffff;border-radius:var(--radius-md);padding:14px 16px;width:100%">
          <span class="toggle-course-mark" style="width:22px;height:22px;flex:none;border-radius:6px;border:2px solid var(--color-divider);display:grid;place-items:center;font-size:12px;font-weight:700;color:#ffffff"></span>
          <span style="flex:1;min-width:0"><span style="display:block;font-size:15.5px;font-weight:600">${escapeHtml(courseTitle(id))}</span><span style="display:block;font-size:13px;opacity:0.6">${doneRow ? 'Bestätigt von der Kursleitung' : 'Noch offen'}</span></span>
        </div>`;
      }).join('');
      paintCourseStatus(progress);
      paintCourseToggles();
    }

    renderGebuchteKurse(ctx);
  }

  // Eigene gebuchte Kurse (aus kursanmeldungen, über user_id verknüpft) —
  // unabhängig vom Bestätigungsstatus, damit auch offene/anstehende
  // Buchungen sichtbar sind.
  function renderGebuchteKurse(ctx) {
    const list = document.getElementById('gebuchteKurseList');
    if (!list) return;
    const { client, bookings } = ctx;
    if (!bookings.length) {
      list.innerHTML = '<p style="margin:0;font-size:15px;opacity:0.7">Noch keine Buchung über dieses Konto — <a href="anmeldung">jetzt einen Kurs buchen</a>.</p>';
      return;
    }

    function row(b) {
      const title = courseTitle(b.kurs_id) || b.kurs_titel || b.kurs_id;
      const date = b.created_at ? new Date(b.created_at).toLocaleDateString('de-DE') : '';
      if (b.storniert) {
        const cancelDate = b.storniert_at ? new Date(b.storniert_at).toLocaleDateString('de-DE') : '';
        return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;opacity:0.65">
          <span style="flex:1;min-width:150px"><span style="display:block;font-size:15.5px;font-weight:600;text-decoration:line-through">${escapeHtml(title)}</span><span style="display:block;font-size:13px;opacity:0.7">Storniert am ${escapeHtml(cancelDate)}</span></span>
        </div>`;
      }
      return `<div data-booking-row data-id="${b.id}" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;background:#ffffff;border-radius:var(--radius-md);padding:14px 16px">
        <span style="flex:1;min-width:150px"><span style="display:block;font-size:15.5px;font-weight:600">${escapeHtml(title)}</span><span style="display:block;font-size:13px;opacity:0.6">Gebucht am ${escapeHtml(date)}</span></span>
        <span style="font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 11px;border-radius:999px;background:var(--color-neutral-200);color:var(--color-neutral-800);flex:none">Gebucht</span>
        ${b.teilnahme_bestaetigt ? '<span style="font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 11px;border-radius:999px;background:var(--color-accent-2-500);color:#ffffff;flex:none">Teilnahme bestätigt</span>' : ''}
        <button type="button" data-cancel-btn style="cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text);flex:none">Stornieren</button>
      </div>`;
    }

    function paint() { list.innerHTML = bookings.map(row).join(''); wireCancelButtons(); }

    function wireCancelButtons() {
      list.querySelectorAll('[data-booking-row]').forEach(el => {
        const btn = el.querySelector('[data-cancel-btn]');
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const b = bookings.find(x => x.id === el.dataset.id);
          if (!b) return;
          const title = courseTitle(b.kurs_id) || b.kurs_titel || b.kurs_id;
          if (!confirm('„' + title + '" wirklich stornieren?')) return;
          btn.disabled = true;
          try {
            const { error } = await client.rpc('cancel_kursanmeldung', { p_booking_id: b.id });
            if (error) throw error;
            b.storniert = true;
            b.storniert_at = new Date().toISOString();
            paint();
          } catch (e) {
            btn.disabled = false;
            alert('Stornieren hat gerade nicht geklappt. Bitte später erneut versuchen.');
          }
        });
      });
    }

    paint();
  }

  function paintCourseToggles() {
    document.querySelectorAll('.toggle-course[data-course]').forEach(btn => {
      const mark = btn.querySelector('.toggle-course-mark');
      const done = btn.dataset.active === 'true';
      if (mark) {
        mark.style.background = done ? 'var(--color-accent)' : 'var(--color-neutral-300)';
        mark.style.borderColor = done ? 'var(--color-accent)' : 'var(--color-divider)';
        mark.textContent = done ? '✓' : '';
      }
    });
  }

  // --------------------------------------------------------------------
  // Seite: konto-qualifikationen
  // --------------------------------------------------------------------
  async function renderQualifikationen(ctx) {
    const { progress } = ctx;
    const root = document.getElementById('qualCards');
    if (!root) return;
    root.innerHTML = QUALIFICATIONS.map(q => {
      const p = qualProgress(q, progress);
      const rows = q.requirements.map(r => {
        const done = !!(progress[r.id] && progress[r.id].passed);
        if (r.kind === 'kurs') {
          return `<div style="display:flex;gap:13px;align-items:center;flex-wrap:wrap;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 18px">
            <span style="width:24px;height:24px;flex:none;border-radius:50%;border:2px solid ${done ? 'var(--color-accent)' : 'var(--color-divider)'};background:${done ? 'var(--color-accent)' : 'var(--color-neutral-300)'};color:#ffffff;display:grid;place-items:center;font-size:12px;font-weight:700">${done ? '✓' : ''}</span>
            <span style="flex:1;min-width:180px;font-size:16px">${escapeHtml(r.label)}</span>
            <span style="font-size:13.5px;font-weight:600;color:${done ? 'var(--color-accent-2-700)' : 'var(--color-text)'};flex:none">${done ? 'Bestätigt von der Kursleitung' : 'Bestätigung steht noch aus'}</span>
          </div>`;
        }
        return `<div style="display:flex;gap:13px;align-items:center;flex-wrap:wrap;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 18px">
          <span style="width:24px;height:24px;flex:none;border-radius:50%;border:2px solid ${done ? 'var(--color-accent)' : 'var(--color-divider)'};background:${done ? 'var(--color-accent)' : 'var(--color-neutral-300)'};color:#ffffff;display:grid;place-items:center;font-size:12px;font-weight:700">${done ? '✓' : ''}</span>
          <span style="flex:1;min-width:180px;font-size:16px">${escapeHtml(r.label)}</span>
          <span style="font-size:13.5px;font-weight:600;color:${done ? 'var(--color-accent-2-700)' : 'var(--color-text)'};flex:none">${done ? 'Erledigt' : 'Offen'}</span>
          <a href="${r.url}" style="font-size:13.5px;font-weight:600;color:var(--color-accent-700);flex:none">Öffnen →</a>
        </div>`;
      }).join('');
      const footer = p.done >= p.total
        ? `<div style="margin-top:20px;padding-top:20px;border-top:1px solid var(--color-divider);display:flex;flex-wrap:wrap;gap:16px;align-items:center">
            <p style="margin:0;flex:1;min-width:240px;font-size:15.5px;color:var(--color-accent-2-800)">Alle Anforderungen erfüllt — dein Zertifikat ist fertig.</p>
            <a href="zertifikat?q=${encodeURIComponent(q.id)}" class="btn btn-primary" style="font-size:14.5px;padding:11px 20px;flex:none">Zertifikat ansehen</a>
          </div>`
        : `<p style="margin:18px 0 0;font-size:14.5px;opacity:0.6">Das Zertifikat steht zum Download bereit, sobald alle Anforderungen erfüllt sind.</p>`;
      return `<div style="background:#ffffff;border:2px solid var(--color-divider);border-radius:calc(var(--radius-lg) * 1.15);padding:28px 32px">
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
          <span class="tag tag-neutral" style="font-size:11.5px">${escapeHtml(q.level)}</span>
          <h3 style="margin:0;font-size:24px">${escapeHtml(q.name)}</h3>
          <span style="margin-left:auto;font-size:11.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:6px 13px;border-radius:999px;background:${p.badge.bg};color:${p.badge.fg}">${p.badge.label}</span>
        </div>
        <p style="margin:0 0 18px;font-size:16px;opacity:0.82">${escapeHtml(q.text)}</p>
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px">
          <div style="flex:1;height:9px;border-radius:999px;background:var(--color-surface);overflow:hidden"><div style="height:100%;width:${p.pct}%;background:var(--color-accent);border-radius:999px"></div></div>
          <span style="font-size:14.5px;font-weight:600;opacity:0.7;flex:none">${p.done}/${p.total} erfüllt</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:11px">${rows}</div>
        ${footer}
      </div>`;
    }).join('');
    paintCourseStatus(progress);
  }

  // --------------------------------------------------------------------
  // Seite: konto-weg — dieselben Qualifikationen als Wegkarte
  // --------------------------------------------------------------------
  async function renderWeg(ctx) {
    const { progress } = ctx;
    const totalReq = QUALIFICATIONS.reduce((n, q) => n + q.requirements.length, 0);
    const doneReq = QUALIFICATIONS.reduce((n, q) => n + q.requirements.filter(r => progress[r.id] && progress[r.id].passed).length, 0);
    const bar = document.getElementById('wegBar');
    if (bar) bar.style.width = (totalReq ? Math.round((doneReq / totalReq) * 100) : 0) + '%';
    const label = document.getElementById('wegLabel');
    if (label) label.textContent = doneReq + ' von ' + totalReq + ' Schritten';

    const root = document.getElementById('wegPath');
    if (!root) return;
    root.innerHTML = QUALIFICATIONS.map(q => {
      const nodes = q.requirements.map(r => {
        const done = !!(progress[r.id] && progress[r.id].passed);
        const isKurs = r.kind === 'kurs';
        const tag = isKurs ? 'div' : 'a';
        const openAttr = isKurs ? '' : ` href="${r.url}"`;
        return `<${tag}${openAttr} style="font:inherit;text-align:left;text-decoration:none;color:inherit;display:flex;gap:12px;align-items:flex-start;background:${done ? 'var(--color-accent-100)' : '#ffffff'};border:2px solid ${done ? 'var(--color-accent)' : 'var(--color-divider)'};border-radius:var(--radius-md);padding:16px 18px;width:100%">
          <span style="width:24px;height:24px;flex:none;border-radius:7px;border:2px solid ${done ? 'var(--color-accent)' : 'var(--color-divider)'};background:${done ? 'var(--color-accent)' : 'var(--color-neutral-300)'};color:#ffffff;display:grid;place-items:center;font-size:13px;font-weight:700;margin-top:1px">${done ? '✓' : ''}</span>
          <span style="min-width:0"><span style="display:block;font-size:16px;font-weight:600;line-height:1.3">${escapeHtml(r.label.replace(/^(Artikel|Quiz|Online-Prüfung|Kurs) „?/, '').replace(/[“"]? (bestehen|durcharbeiten|lesen|absolvieren)$/, ''))}</span>${isKurs ? `<span style="display:block;font-size:13px;opacity:0.65;margin-top:2px">${done ? 'Bestätigt von der Kursleitung' : 'Bestätigung steht noch aus'}</span>` : ''}</span>
        </${tag}>`;
      }).join('');
      return `<div style="display:flex;flex-direction:column;gap:12px">
        <div style="background:var(--color-accent-700);color:#ffffff;border-radius:var(--radius-md);padding:14px 18px">
          <div style="font-family:var(--font-heading);font-size:17px;line-height:1.25">${escapeHtml(q.name)}</div>
          <div style="font-size:13px;opacity:0.85;margin-top:2px">${escapeHtml(q.level)}</div>
        </div>
        ${nodes}
      </div>`;
    }).join('');
  }

  // --------------------------------------------------------------------
  // Kommentare unter Wissensartikeln ("Fragen & Kommentare")
  // --------------------------------------------------------------------
  function formatCommentDate(iso) {
    try { return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  async function wireComments() {
    const root = document.querySelector('[data-comments-for]');
    if (!root) return;
    const articleId = root.dataset.commentsFor;
    const loginBox = document.getElementById('commentLoginBox');
    const form = document.getElementById('commentForm');
    const list = document.getElementById('commentList');
    if (!list) return;

    const client = getClient();
    if (!client) { list.innerHTML = '<p style="margin:0;font-size:15px;opacity:0.7">Kommentare sind gerade nicht erreichbar.</p>'; return; }

    async function loadComments() {
      list.innerHTML = '<p style="margin:0;font-size:15px;opacity:0.55">Lädt …</p>';
      let rows = [];
      try {
        const { data } = await client.from('kommentare').select('*').eq('artikel_id', articleId).order('created_at', { ascending: true });
        rows = data || [];
      } catch (e) { /* bleibt leer */ }
      if (!rows.length) {
        list.innerHTML = '<p style="margin:0;font-size:16px;opacity:0.6">Noch keine Kommentare – stell die erste Frage.</p>';
        return;
      }
      list.innerHTML = rows.map(c => `
        <div style="border-bottom:1px solid var(--color-divider);padding-bottom:16px">
          <div style="display:flex;gap:10px;align-items:baseline;margin-bottom:6px">
            <span style="font-size:15px;font-weight:600">${escapeHtml(c.autor_name)}</span>
            <span style="font-size:13px;opacity:0.55">${formatCommentDate(c.created_at)}</span>
          </div>
          <p style="margin:0;font-size:15.5px;white-space:pre-wrap;opacity:0.9">${escapeHtml(c.text)}</p>
        </div>`).join('');
    }

    const session = await getSession();
    if (session && form) {
      if (loginBox) loginBox.hidden = true;
      form.hidden = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textEl = document.getElementById('commentText');
        const text = textEl.value.trim();
        if (!text) return;
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const profile = await fetchProfile(client, session.user.id);
        const autorName = (profile && profile.vorname) || session.user.user_metadata.vorname || 'Kletterer*in';
        try {
          await client.from('kommentare').insert({ artikel_id: articleId, user_id: session.user.id, autor_name: autorName, text });
          textEl.value = '';
          await loadComments();
        } catch (e) { /* stiller Fehlschlag, Formular bleibt ausgefüllt */ }
        submitBtn.disabled = false;
      });
    } else if (loginBox) {
      loginBox.hidden = false;
      const link = loginBox.querySelector('a');
      if (link) link.href = 'login?next=' + encodeURIComponent((location.pathname.split('/').pop() || '').replace(/\.html$/i, '') || 'wissen');
    }

    await loadComments();
  }

  // --------------------------------------------------------------------
  // Einstieg
  // --------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/i, '');
    const accountPages = {
      'konto': renderKonto,
      'konto-profil': renderProfil,
      'konto-lernen': renderLernen,
      'konto-qualifikationen': renderQualifikationen,
      'konto-weg': renderWeg
    };

    if (accountPages[page]) {
      const ctx = await guardAccountPage();
      if (ctx) await accountPages[page](ctx);
      return;
    }

    // Alle anderen Seiten: nur stiller Abgleich (Header-Link, gelesen-Status)
    // plus Kommentare, falls die Seite einen Kommentarbereich hat.
    syncHeaderAndLocalProgress();
    wireComments();
  });
})();
