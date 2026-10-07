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
  // (kind 'artikel' | 'quiz' | 'pruefung' | 'kurs'). Kommt seit
  // js/qualifikationen-data.js aus der Datenbank (admin-qualifikationen)
  // statt fest im Code zu stehen — window.BM_QUALIFICATIONS ist erst NACH
  // window.BM_QUALIFICATIONS_READY gültig, deshalb hier als Funktion
  // gelesen statt einmalig in eine Konstante kopiert.
  // --------------------------------------------------------------------
  function qualifications() { return window.BM_QUALIFICATIONS || []; }

  // Alle Nicht-Kurs-Inhalte (Artikel/Quiz/Prüfung), dedupliziert — Basis für
  // "Mein Lernstand" / "Weiterlernen".
  function contentItems() {
    const seen = {};
    const out = [];
    qualifications().forEach(q => q.requirements.forEach(r => {
      if (r.kind !== 'kurs' && !seen[r.id]) { seen[r.id] = true; out.push(r); }
    }));
    return out;
  }

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

  // supabase-js wartet beim Laden pro Tab auf eine browserweite Sperre, damit
  // sich mehrere offene Tabs beim Token-Erneuern nicht in die Quere kommen —
  // diese Wartezeit hat werksseitig KEIN Timeout. Hält ein anderer offener
  // Tab (z.B. ein alter, vergessener) die Sperre fest, hängt getSession()
  // sonst für immer. Deshalb hier mit eigenem Timeout, damit die Seite nicht
  // dauerhaft auf "Lädt dein Konto …" stehen bleibt.
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { isTimeout: true })), ms);
      promise.then(
        v => { clearTimeout(timer); resolve(v); },
        e => { clearTimeout(timer); reject(e); }
      );
    });
  }

  async function getSession() {
    const client = getClient();
    if (!client) return null;
    try {
      const { data } = await withTimeout(client.auth.getSession(), 7000);
      return data && data.session ? data.session : null;
    } catch (e) { return null; }
  }

  // Wie getSession(), unterscheidet aber zusätzlich "wirklich nicht
  // eingeloggt" von "Laden hängt fest" — guardAccountPage() braucht das, um
  // im Hänger-Fall nicht fälschlich zum Login weiterzuleiten.
  async function getSessionOrTimeout() {
    const client = getClient();
    if (!client) return { session: null, timedOut: false };
    try {
      const { data } = await withTimeout(client.auth.getSession(), 7000);
      return { session: data && data.session ? data.session : null, timedOut: false };
    } catch (e) {
      return { session: null, timedOut: !!(e && e.isTimeout) };
    }
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

  // Artikel/Quiz, die vor dem Login (oder in einem anderen Browser) nur
  // lokal als "gelesen"/"bestanden" markiert wurden, nachträglich mit dem
  // Konto synchronisieren — ohne das ging die Markierung beim ersten Login
  // verloren, weil bisher nur Konto -> Browser abgeglichen wurde, nicht
  // umgekehrt. Prüfungen sind bewusst ausgenommen: die laufen ausschließlich
  // über die serverseitige Auswertung (siehe bmSubmitExam/submit_pruefung).
  function backfillLocalProgress(progress) {
    try {
      contentItems().forEach(item => {
        if (item.kind === 'pruefung') return;
        const already = progress[item.id] && progress[item.id].passed;
        if (!already && bmProgress.isDone(item.id)) {
          window.bmSyncLernfortschritt(item.id, item.kind);
        }
      });
    } catch (e) {}
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
    if (window.BM_QUALIFICATIONS_READY) { try { await window.BM_QUALIFICATIONS_READY; } catch (e) {} }
    backfillLocalProgress(progress);
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

    const { session, timedOut } = await getSessionOrTimeout();
    if (!session) {
      if (timedOut) {
        if (banner) {
          banner.hidden = false;
          banner.innerHTML = '<span>Das Laden dauert ungewöhnlich lange — meist hilft es, alle anderen BETAMOVE-Tabs/-Fenster zu schließen und diese Seite neu zu laden.</span> <button type="button" id="bmReloadBtn" style="cursor:pointer;font:inherit;font-size:13.5px;font-weight:600;padding:8px 16px;border-radius:999px;border:0;background:#ffffff;color:var(--color-accent-700)">Neu laden</button>';
          const reloadBtn = document.getElementById('bmReloadBtn');
          if (reloadBtn) reloadBtn.addEventListener('click', () => location.reload());
        }
        return null;
      }
      const here = location.pathname.split('/').pop() || 'konto';
      location.href = 'login?next=' + encodeURIComponent(here);
      return null;
    }
    if (banner) banner.remove();
    syncNavHeader(session);
    if (window.BM_COURSES_READY) { try { await window.BM_COURSES_READY; } catch (e) {} }
    if (window.BM_QUALIFICATIONS_READY) { try { await window.BM_QUALIFICATIONS_READY; } catch (e) {} }

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
    backfillLocalProgress(progress);

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
      // js/main.js hat das Mobile-Dropdown schon aus den vorhandenen Links
      // gebaut, bevor dieser (asynchrone) Admin-Link dazukam — hier nachtragen.
      const mobileSelect = document.querySelector('.konto-mobile-row select');
      if (mobileSelect && !mobileSelect.querySelector('[data-admin-link]')) {
        const opt = document.createElement('option');
        opt.value = adminLink.getAttribute('href');
        opt.textContent = adminLink.textContent;
        opt.dataset.adminLink = 'true';
        mobileSelect.appendChild(opt);
      }
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

    document.querySelectorAll('#logoutBtn, [data-logout-btn]').forEach(logoutBtn => {
      logoutBtn.addEventListener('click', async () => {
        try { await client.auth.signOut(); } catch (e) {}
        location.href = '/';
      });
    });

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
    const qualStats = qualifications().map(q => Object.assign({ qual: q }, qualProgress(q, progress)));
    const qualDone = qualStats.filter(q => q.done >= q.total).length;
    const activeBookings = bookings.filter(b => !b.storniert).length;
    const examCount = contentItems().filter(c => c.kind === 'pruefung' && progress[c.id] && progress[c.id].passed).length;

    const statQual = document.getElementById('statQual');
    if (statQual) statQual.textContent = qualDone + '/' + qualifications().length;
    const statContent = document.getElementById('statContent');
    if (statContent) statContent.textContent = String(activeBookings);
    const statExams = document.getElementById('statExams');
    if (statExams) statExams.textContent = String(examCount);

    renderGebuchteKurse(ctx);

    // Nächster offener Schritt: erste offene Anforderung über alle Qualifikationen
    const nextBox = document.getElementById('nextStepBox');
    let nextReq = null;
    for (const q of qualifications()) {
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
      const exams = contentItems().filter(c => c.kind === 'pruefung' && progress[c.id] && progress[c.id].passed);
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
      const open = contentItems().filter(c => !(progress[c.id] && progress[c.id].passed)).slice(0, 3);
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
    const total = contentItems().length;
    const done = contentItems().filter(c => progress[c.id] && progress[c.id].passed).length;
    const bar = document.getElementById('lernenBar');
    if (bar) bar.style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
    const label = document.getElementById('lernenLabel');
    if (label) label.textContent = done + ' von ' + total + ' Inhalten bearbeitet';

    const doneList = document.getElementById('bearbeitetList');
    if (doneList) {
      const typeLabel = { artikel: 'Gelesen', quiz: null, pruefung: null };
      const items = contentItems().filter(c => progress[c.id] && progress[c.id].passed);
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
  // Seite: konto-training — Ziele, Workouts, typisierte Übungen, Logbuch
  // mit Session-Timer (siehe schema-training.sql, schema-trainingsplan.sql,
  // schema-trainingsplan-v3.sql).
  // --------------------------------------------------------------------
  const TYP_LABEL = { bouldern: 'Bouldern', seilklettern: 'Seilklettern', fingerkraft: 'Fingerkraft/Krafttraining', ausdauer: 'Ausdauer/Cardio', mobility: 'Mobility/Dehnen', sonstiges: 'Sonstiges' };
  const WOCHENTAGE = [{ n: 1, label: 'Montag', short: 'Mo' }, { n: 2, label: 'Dienstag', short: 'Di' }, { n: 3, label: 'Mittwoch', short: 'Mi' }, { n: 4, label: 'Donnerstag', short: 'Do' }, { n: 5, label: 'Freitag', short: 'Fr' }, { n: 6, label: 'Samstag', short: 'Sa' }, { n: 7, label: 'Sonntag', short: 'So' }];
  const GRAD_LISTEN = {
    fontainebleau: ['3', '4', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'],
    uiaa: ['III', 'III+', 'IV-', 'IV', 'IV+', 'V-', 'V', 'V+', 'VI-', 'VI', 'VI+', 'VII-', 'VII', 'VII+', 'VIII-', 'VIII', 'VIII+', 'IX-', 'IX', 'IX+', 'X-', 'X', 'X+', 'XI-', 'XI', 'XI+', 'XII-', 'XII']
  };
  const UEBUNG_MASKE_LABEL = { klassisch: 'Klassisch', kletterroute: 'Kletterroute' };
  const TRAININGSART_LABEL = { maximalkraft: 'Maximalkraft', schnellkraft: 'Schnellkraft', ausdauer: 'Ausdauer', maximalkraftausdauer: 'Maximalkraftausdauer' };
  const UEBUNG_ART_BUILTIN = ['Athletik', 'Mobilität', 'Dehnung', 'Geräte'];
  const TIMER_MODUS_LABEL = { keiner: 'Kein Timer', pause: 'Nur Pause', intervall: 'Intervall (Start/Pause)' };

  function fmtMMSS(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  async function renderTraining(ctx) {
    const { client, session } = ctx;
    const userId = session.user.id;

    let ziele = [];
    let log = [];
    let uebungen = [];
    let workouts = [];
    let workoutUebungen = [];
    let einheiten = [];
    let uebungArten = [];
    try {
      const [zieleRes, logRes, uebungenRes, workoutsRes, workoutUebungenRes, einheitenRes, artenRes] = await Promise.all([
        client.from('trainingsziele').select('*').order('created_at', { ascending: false }),
        client.from('trainingslog').select('*').order('datum', { ascending: false }).order('created_at', { ascending: false }),
        client.from('trainingsuebungen').select('*').order('created_at', { ascending: false }),
        client.from('trainingsworkouts').select('*').order('created_at', { ascending: false }),
        client.from('trainingsworkout_uebungen').select('*').order('reihenfolge', { ascending: true }),
        client.from('trainingseinheiten').select('*').order('created_at', { ascending: false }).limit(30),
        client.from('trainingsuebung_arten').select('*').order('created_at', { ascending: true })
      ]);
      [zieleRes, logRes, uebungenRes, workoutsRes, workoutUebungenRes, einheitenRes, artenRes].forEach(r => { if (r.error) throw r.error; });
      ziele = zieleRes.data || [];
      log = logRes.data || [];
      uebungen = uebungenRes.data || [];
      workouts = workoutsRes.data || [];
      workoutUebungen = workoutUebungenRes.data || [];
      einheiten = einheitenRes.data || [];
      uebungArten = artenRes.data || [];
    } catch (e) {
      const el = document.getElementById('zieleList');
      if (el) el.innerHTML = '<p style="margin:0;font-size:15px;color:var(--color-accent-700)">Konnte nicht geladen werden. Bitte Seite neu laden.</p>';
    }

    function uebungById(id) { return uebungen.find(u => u.id === id) || null; }
    function uebungName(id) { const u = uebungById(id); return u ? u.name : null; }
    function workoutUebungenFor(workoutId) {
      return workoutUebungen.filter(wu => wu.workout_id === workoutId).map(wu => uebungById(wu.uebung_id)).filter(Boolean);
    }

    // ---- Ziele ----
    function renderZiele() {
      const list = document.getElementById('zieleList');
      if (!list) return;
      list.innerHTML = ziele.length ? ziele.map(z => `
        <div data-ziel data-id="${z.id}" style="display:flex;gap:10px;align-items:flex-start;background:var(--color-surface);border-radius:var(--radius-md);padding:12px 14px">
          <button type="button" data-ziel-toggle aria-label="Erledigt" style="cursor:pointer;flex:none;width:22px;height:22px;margin-top:1px;border-radius:6px;border:2px solid ${z.erreicht ? 'var(--color-accent-2-500)' : 'var(--color-divider)'};background:${z.erreicht ? 'var(--color-accent-2-500)' : '#ffffff'};color:#ffffff;display:grid;place-items:center;font-size:12px;font-weight:700">${z.erreicht ? '✓' : ''}</button>
          <span style="flex:1;min-width:0;font-size:15px;${z.erreicht ? 'text-decoration:line-through;opacity:0.6' : ''}">${escapeHtml(z.text)}</span>
          <button type="button" data-ziel-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
        </div>`).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine Ziele gesetzt.</p>';
      list.querySelectorAll('[data-ziel]').forEach(row => {
        const id = row.dataset.id;
        const ziel = ziele.find(z => z.id === id);
        row.querySelector('[data-ziel-toggle]').addEventListener('click', async () => {
          const next = !ziel.erreicht;
          try {
            const { error } = await client.from('trainingsziele').update({ erreicht: next, erreicht_am: next ? new Date().toISOString() : null }).eq('id', id);
            if (error) throw error;
            ziel.erreicht = next;
            renderZiele();
          } catch (e) { alert('Konnte nicht gespeichert werden.'); }
        });
        row.querySelector('[data-ziel-delete]').addEventListener('click', async () => {
          if (!confirm('Ziel „' + ziel.text + '" wirklich löschen?')) return;
          try {
            const { error } = await client.from('trainingsziele').delete().eq('id', id);
            if (error) throw error;
            ziele = ziele.filter(z => z.id !== id);
            renderZiele();
          } catch (e) { alert('Konnte nicht gelöscht werden.'); }
        });
      });
    }
    renderZiele();

    const zielForm = document.getElementById('zielForm');
    if (zielForm) {
      zielForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('zielInput');
        const text = input.value.trim();
        if (!text) return;
        const btn = zielForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const { data, error } = await client.from('trainingsziele').insert({ user_id: userId, text }).select().single();
          if (error) throw error;
          ziele.unshift(data);
          input.value = '';
          renderZiele();
        } catch (e) {
          alert('Konnte nicht gespeichert werden.');
        } finally {
          btn.disabled = false;
        }
      });
    }

    // ---- Wochenplan ----
    function renderWochenplan() {
      const grid = document.getElementById('wochenplanGrid');
      if (!grid) return;
      const todayIso = (((new Date()).getDay() + 6) % 7) + 1;
      grid.innerHTML = WOCHENTAGE.map(wd => {
        const items = uebungen.filter(u => (u.wochentage || []).includes(wd.n));
        return `<div class="wp-day" data-today="${wd.n === todayIso}">
          <h4>${wd.short}</h4>
          ${items.length ? items.map(u => '<div class="wp-day-item">' + escapeHtml(u.name) + '</div>').join('') : '<div class="wp-day-item" style="opacity:0.4;border-top:0">—</div>'}
        </div>`;
      }).join('');
    }
    renderWochenplan();

    // ---- Übung anlegen/bearbeiten: Art -> Übungsmaske -> Trainingsart + Timer-Konfig ----
    const uebungFormBox = document.getElementById('uebungFormBox');
    const uebungForm = document.getElementById('uebungForm');
    const uebungFormTitle = document.getElementById('uebungFormTitle');
    const uebungFormError = document.getElementById('uebungFormError');
    const uebungWochentageEl = document.getElementById('uebungWochentage');
    const newUebungBtn = document.getElementById('newUebungBtn');
    const uebungCancelBtn = document.getElementById('uebungCancelBtn');
    const uebungCancelBtnTop = document.getElementById('uebungCancelBtnTop');
    const uebungArtPills = document.getElementById('uebungArtPills');
    const uebungMaskeSection = document.getElementById('uebungMaskeSection');
    const uebungMaskePills = document.getElementById('uebungMaskePills');
    const uebungAfterMaske = document.getElementById('uebungAfterMaske');
    const uebungTrainingsartPills = document.getElementById('uebungTrainingsartPills');
    const uebungTimerPills = document.getElementById('uebungTimerPills');
    const uebungTimerPauseField = document.getElementById('uebungTimerPauseField');
    const uebungTimerHint = document.getElementById('uebungTimerHint');
    const uebungFelderKlassisch = document.getElementById('uebungFelderKlassisch');
    const uebungFelderKletterroute = document.getElementById('uebungFelderKletterroute');
    const uebungSpezList = document.getElementById('uebungSpezList');
    const uebungSpezInput = document.getElementById('uebung-spez-input');
    const uebungSpezAdd = document.getElementById('uebungSpezAdd');
    let editingUebungId = null;
    let uebungSpezifikationen = [];

    if (uebungWochentageEl && !uebungWochentageEl.children.length) {
      uebungWochentageEl.innerHTML = WOCHENTAGE.map(wd => `<button type="button" class="wd-pill" data-day="${wd.n}">${wd.short}</button>`).join('');
      uebungWochentageEl.querySelectorAll('.wd-pill').forEach(btn => {
        btn.addEventListener('click', () => { btn.dataset.active = String(btn.dataset.active !== 'true'); });
      });
    }

    function selectedWochentage() {
      return Array.from(uebungWochentageEl.querySelectorAll('.wd-pill[data-active="true"]')).map(btn => Number(btn.dataset.day));
    }

    function setSelectedWochentage(days) {
      uebungWochentageEl.querySelectorAll('.wd-pill').forEach(btn => {
        btn.dataset.active = String((days || []).includes(Number(btn.dataset.day)));
      });
    }

    // ---- Art (Athletik/Mobilität/Dehnung/Geräte + selbst hinzugefügte) ----
    function renderArtPills() {
      const custom = uebungArten.map(a => a.name);
      const current = activeArt();
      uebungArtPills.innerHTML = UEBUNG_ART_BUILTIN.concat(custom).map(name =>
        `<button type="button" class="wd-pill" data-art="${escapeHtml(name)}">${escapeHtml(name)}</button>`
      ).join('') + `<button type="button" class="wd-pill" data-art-add>+ Neue Art</button>`;
      if (current) setActiveArt(current);
      uebungArtPills.querySelectorAll('.wd-pill[data-art]').forEach(btn => {
        btn.addEventListener('click', () => setActiveArt(btn.dataset.art));
      });
      const addBtn = uebungArtPills.querySelector('[data-art-add]');
      if (addBtn) addBtn.addEventListener('click', async () => {
        const name = (prompt('Name der neuen Art:') || '').trim();
        if (!name) return;
        try {
          const { data, error } = await client.from('trainingsuebung_arten').insert({ user_id: userId, name }).select().single();
          if (error) throw error;
          uebungArten.push(data);
          renderArtPills();
          setActiveArt(name);
        } catch (e) { alert('Konnte nicht gespeichert werden.'); }
      });
    }
    function setActiveArt(art) {
      uebungArtPills.querySelectorAll('.wd-pill[data-art]').forEach(btn => { btn.dataset.active = String(btn.dataset.art === art); });
      uebungMaskeSection.hidden = !art;
      if (!art) { uebungAfterMaske.hidden = true; setActiveMaske(''); }
    }
    function activeArt() {
      const btn = uebungArtPills.querySelector('.wd-pill[data-art][data-active="true"]');
      return btn ? btn.dataset.art : '';
    }
    renderArtPills();

    // ---- Übungsmaske (klassisch/kletterroute) ----
    function setActiveMaske(maske) {
      uebungMaskePills.querySelectorAll('.wd-pill').forEach(btn => { btn.dataset.active = String(btn.dataset.maske === maske); });
      uebungAfterMaske.hidden = !maske;
      uebungFelderKlassisch.hidden = maske !== 'klassisch';
      uebungFelderKletterroute.hidden = maske !== 'kletterroute';
    }
    function activeMaske() {
      const btn = uebungMaskePills.querySelector('.wd-pill[data-active="true"]');
      return btn ? btn.dataset.maske : '';
    }
    uebungMaskePills.querySelectorAll('.wd-pill').forEach(btn => btn.addEventListener('click', () => setActiveMaske(btn.dataset.maske)));

    // ---- Trainingsart (optional) ----
    function setActiveTrainingsart(art) {
      uebungTrainingsartPills.querySelectorAll('.wd-pill').forEach(btn => { btn.dataset.active = String(btn.dataset.trainingsart === art && !!art); });
    }
    function activeTrainingsart() {
      const btn = uebungTrainingsartPills.querySelector('.wd-pill[data-active="true"]');
      return btn ? btn.dataset.trainingsart : null;
    }
    uebungTrainingsartPills.querySelectorAll('.wd-pill').forEach(btn => btn.addEventListener('click', () => {
      setActiveTrainingsart(btn.dataset.trainingsart === activeTrainingsart() ? null : btn.dataset.trainingsart);
    }));

    // ---- Spezifikationen (mehrere möglich) ----
    function renderSpezList() {
      uebungSpezList.innerHTML = uebungSpezifikationen.map((s, i) => `
        <span class="tag tag-neutral" data-spez data-idx="${i}" style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px">${escapeHtml(s)}<button type="button" data-spez-remove aria-label="Entfernen" style="cursor:pointer;font:inherit;background:transparent;border:0;opacity:0.6;padding:0">✕</button></span>
      `).join('');
      uebungSpezList.querySelectorAll('[data-spez]').forEach(chip => {
        const idx = Number(chip.dataset.idx);
        chip.querySelector('[data-spez-remove]').addEventListener('click', () => { uebungSpezifikationen.splice(idx, 1); renderSpezList(); });
      });
    }
    function addSpez() {
      const val = uebungSpezInput.value.trim();
      if (!val || uebungSpezifikationen.includes(val)) { uebungSpezInput.value = ''; return; }
      uebungSpezifikationen.push(val);
      uebungSpezInput.value = '';
      renderSpezList();
    }
    uebungSpezAdd.addEventListener('click', addSpez);
    uebungSpezInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSpez(); } });

    function setActiveTimer(modus) {
      uebungTimerPills.querySelectorAll('.wd-pill').forEach(btn => { btn.dataset.active = String(btn.dataset.timer === modus); });
      uebungTimerPauseField.hidden = modus !== 'pause';
      uebungTimerHint.textContent = modus === 'intervall'
        ? 'Im Logbuch: Start/Pause pro Satz, die Intervallzeit beginnt bei jedem Start neu bei 0.'
        : (modus === 'pause' ? 'Im Logbuch zählt die eingestellte Pausenzeit runter.' : '');
    }
    function activeTimer() {
      const btn = uebungTimerPills.querySelector('.wd-pill[data-active="true"]');
      return btn ? btn.dataset.timer : 'keiner';
    }
    uebungTimerPills.querySelectorAll('.wd-pill').forEach(btn => btn.addEventListener('click', () => setActiveTimer(btn.dataset.timer)));

    function openUebungForm(uebung) {
      editingUebungId = uebung ? uebung.id : null;
      uebungFormTitle.textContent = uebung ? 'Übung bearbeiten' : 'Übung anlegen';
      document.getElementById('uebung-name').value = uebung ? uebung.name : '';
      document.getElementById('uebung-einheit').value = uebung ? (uebung.einheit || '') : '';
      document.getElementById('uebung-wiederholungen').value = uebung ? (uebung.wiederholungen || '') : '';
      document.getElementById('uebung-saetze').value = uebung ? (uebung.saetze || '') : '';
      document.getElementById('uebung-geraet').value = uebung && uebung.geraet ? uebung.geraet : 'Moonboard';
      document.getElementById('uebung-gradsystem').value = uebung && uebung.grad_system ? uebung.grad_system : 'fontainebleau';
      document.getElementById('uebung-timer-pause').value = uebung ? (uebung.timer_pause_sekunden || '') : '';
      document.getElementById('uebung-notiz').value = uebung ? (uebung.notiz || '') : '';
      uebungSpezifikationen = uebung && Array.isArray(uebung.spezifikationen) ? uebung.spezifikationen.slice() : [];
      renderSpezList();
      setSelectedWochentage(uebung ? uebung.wochentage : []);
      setActiveArt(uebung ? (uebung.art || '') : '');
      setActiveMaske(uebung ? uebung.typ : '');
      setActiveTrainingsart(uebung ? uebung.trainingsart : null);
      setActiveTimer(uebung ? uebung.timer_modus : 'keiner');
      uebungFormError.hidden = true;
      uebungFormBox.hidden = false;
    }

    function closeUebungForm() {
      uebungFormBox.hidden = true;
      editingUebungId = null;
      uebungForm.reset();
      uebungSpezifikationen = [];
      renderSpezList();
      setSelectedWochentage([]);
      setActiveArt('');
      setActiveMaske('');
      setActiveTrainingsart(null);
      setActiveTimer('keiner');
    }

    if (newUebungBtn) newUebungBtn.addEventListener('click', () => openUebungForm(null));
    if (uebungCancelBtn) uebungCancelBtn.addEventListener('click', closeUebungForm);
    if (uebungCancelBtnTop) uebungCancelBtnTop.addEventListener('click', closeUebungForm);

    function uebungSubtitle(u) {
      const parts = [u.art, TRAININGSART_LABEL[u.trainingsart] || null];
      if (u.typ === 'kletterroute') {
        parts.push(u.geraet, u.grad_system ? (u.grad_system === 'uiaa' ? 'UIAA' : 'Fontainebleau') : null);
      } else {
        parts.push(u.saetze && u.saetze > 1 ? u.saetze + ' Sätze' : null, u.wiederholungen ? u.wiederholungen + ' Wdh.' : null, Array.isArray(u.spezifikationen) && u.spezifikationen.length ? u.spezifikationen.join(', ') : null, u.einheit);
      }
      return parts.filter(Boolean).join(' · ');
    }

    function renderUebungenList() {
      const list = document.getElementById('uebungenList');
      if (!list) return;
      list.innerHTML = uebungen.length ? uebungen.map(u => {
        const days = (u.wochentage || []).map(n => (WOCHENTAGE.find(w => w.n === n) || {}).short).filter(Boolean).join(', ');
        const sub = uebungSubtitle(u);
        const timerInfo = u.timer_modus && u.timer_modus !== 'keiner' ? (TIMER_MODUS_LABEL[u.timer_modus] + (u.timer_modus === 'pause' && u.timer_pause_sekunden ? ' (' + u.timer_pause_sekunden + 's)' : '')) : null;
        return `<div data-uebung data-id="${u.id}" style="display:flex;gap:14px;align-items:flex-start;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span style="font-size:15.5px;font-weight:600">${escapeHtml(u.name)}</span>
              <span class="tag tag-neutral" style="font-size:10.5px">${UEBUNG_MASKE_LABEL[u.typ] || 'Klassisch'}</span>
            </div>
            <div style="font-size:13.5px;opacity:0.65;margin-top:3px">${[sub, days ? days : 'Keinem Wochentag zugeordnet', timerInfo].filter(Boolean).join(' · ')}</div>
            ${u.notiz ? '<p style="margin:6px 0 0;font-size:14px;opacity:0.8">' + escapeHtml(u.notiz) + '</p>' : ''}
          </div>
          <div style="display:flex;gap:8px;flex:none">
            <button type="button" data-uebung-edit style="cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">Bearbeiten</button>
            <button type="button" data-uebung-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
          </div>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine eigene Übung angelegt.</p>';
      list.querySelectorAll('[data-uebung]').forEach(row => {
        const id = row.dataset.id;
        const uebung = uebungById(id);
        row.querySelector('[data-uebung-edit]').addEventListener('click', () => openUebungForm(uebung));
        row.querySelector('[data-uebung-delete]').addEventListener('click', async () => {
          if (!confirm('Übung „' + uebung.name + '" wirklich löschen? Workouts, die diese Übung enthalten, verlieren sie.')) return;
          try {
            const { error } = await client.from('trainingsuebungen').delete().eq('id', id);
            if (error) throw error;
            uebungen = uebungen.filter(u => u.id !== id);
            workoutUebungen = workoutUebungen.filter(wu => wu.uebung_id !== id);
            renderUebungenList();
            renderWochenplan();
            renderWorkoutenList();
          } catch (e) { alert('Konnte nicht gelöscht werden.'); }
        });
      });
    }
    renderUebungenList();

    if (uebungForm) {
      uebungForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        uebungFormError.hidden = true;
        const art = activeArt();
        const maske = activeMaske();
        const name = document.getElementById('uebung-name').value.trim();
        if (!name) { uebungFormError.hidden = false; uebungFormError.textContent = 'Bitte einen Namen eintragen.'; return; }
        if (!art) { uebungFormError.hidden = false; uebungFormError.textContent = 'Bitte eine Art auswählen.'; return; }
        if (!maske) { uebungFormError.hidden = false; uebungFormError.textContent = 'Bitte eine Übungsmaske auswählen.'; return; }

        const timerModus = activeTimer();
        const timerPauseRaw = document.getElementById('uebung-timer-pause').value;
        if (timerModus === 'pause' && !timerPauseRaw) { uebungFormError.hidden = false; uebungFormError.textContent = 'Bitte eine Pausenlänge eintragen.'; return; }

        const payload = {
          user_id: userId,
          name,
          art,
          typ: maske,
          trainingsart: activeTrainingsart(),
          notiz: document.getElementById('uebung-notiz').value.trim() || null,
          wochentage: selectedWochentage(),
          timer_modus: timerModus,
          timer_pause_sekunden: timerModus === 'pause' ? Number(timerPauseRaw) : null,
          einheit: null, wiederholungen: null, saetze: null, spezifikationen: [], geraet: null, grad_system: null
        };
        if (maske === 'kletterroute') {
          payload.geraet = document.getElementById('uebung-geraet').value;
          payload.grad_system = document.getElementById('uebung-gradsystem').value;
        } else {
          const wdhRaw = document.getElementById('uebung-wiederholungen').value;
          const saetzeRaw = document.getElementById('uebung-saetze').value;
          payload.wiederholungen = wdhRaw ? Number(wdhRaw) : null;
          payload.saetze = saetzeRaw ? Number(saetzeRaw) : null;
          payload.einheit = document.getElementById('uebung-einheit').value.trim() || null;
          payload.spezifikationen = uebungSpezifikationen.slice();
        }

        const btn = uebungForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          if (editingUebungId) {
            const { data, error } = await client.from('trainingsuebungen').update(payload).eq('id', editingUebungId).select().single();
            if (error) throw error;
            uebungen = uebungen.map(u => u.id === editingUebungId ? data : u);
          } else {
            const { data, error } = await client.from('trainingsuebungen').insert(payload).select().single();
            if (error) throw error;
            uebungen.unshift(data);
          }
          closeUebungForm();
          renderUebungenList();
          renderWochenplan();
          renderWorkoutenList();
          populateWorkoutSelect();
        } catch (e) {
          uebungFormError.hidden = false;
          uebungFormError.textContent = 'Konnte nicht gespeichert werden. Bitte erneut versuchen.';
        } finally {
          btn.disabled = false;
        }
      });
    }

    // ---- Workouts (Übungen bündeln) ----
    const workoutFormBox = document.getElementById('workoutFormBox');
    const workoutForm = document.getElementById('workoutForm');
    const workoutFormTitle = document.getElementById('workoutFormTitle');
    const workoutFormError = document.getElementById('workoutFormError');
    const newWorkoutBtn = document.getElementById('newWorkoutBtn');
    const workoutCancelBtn = document.getElementById('workoutCancelBtn');
    const workoutAvailableList = document.getElementById('workoutAvailableList');
    const workoutSelectedList = document.getElementById('workoutSelectedList');
    let editingWorkoutId = null;
    let workoutSelectedUebungIds = [];

    function renderWorkoutPicker() {
      const selectedSet = new Set(workoutSelectedUebungIds);
      workoutAvailableList.innerHTML = uebungen.filter(u => !selectedSet.has(u.id)).map(u => `
        <button type="button" data-add-uebung data-id="${u.id}" style="text-align:left;cursor:pointer;font:inherit;font-size:13.5px;padding:8px 10px;border-radius:var(--radius-md);border:1px solid var(--color-divider);background:#ffffff;color:var(--color-text)">+ ${escapeHtml(u.name)}</button>
      `).join('') || '<p style="margin:0;font-size:13px;opacity:0.6">Keine weiteren Übungen.</p>';
      workoutSelectedList.innerHTML = workoutSelectedUebungIds.map((id, i) => {
        const u = uebungById(id);
        if (!u) return '';
        return `<div data-sel-uebung data-id="${id}" style="display:flex;gap:8px;align-items:center;font-size:13.5px;padding:8px 10px;border-radius:var(--radius-md);background:var(--color-accent-100)">
          <span style="flex:1;min-width:0">${i + 1}. ${escapeHtml(u.name)}</span>
          <button type="button" data-move-up aria-label="Nach oben" ${i === 0 ? 'disabled' : ''} style="cursor:pointer;font:inherit;background:transparent;border:0;opacity:${i === 0 ? '0.3' : '0.7'}">↑</button>
          <button type="button" data-move-down aria-label="Nach unten" ${i === workoutSelectedUebungIds.length - 1 ? 'disabled' : ''} style="cursor:pointer;font:inherit;background:transparent;border:0;opacity:${i === workoutSelectedUebungIds.length - 1 ? '0.3' : '0.7'}">↓</button>
          <button type="button" data-remove aria-label="Entfernen" style="cursor:pointer;font:inherit;background:transparent;border:0;opacity:0.6">✕</button>
        </div>`;
      }).join('') || '<p style="margin:0;font-size:13px;opacity:0.6">Noch keine Übung ausgewählt.</p>';

      workoutAvailableList.querySelectorAll('[data-add-uebung]').forEach(btn => {
        btn.addEventListener('click', () => { workoutSelectedUebungIds.push(btn.dataset.id); renderWorkoutPicker(); });
      });
      workoutSelectedList.querySelectorAll('[data-sel-uebung]').forEach(row => {
        const id = row.dataset.id;
        const idx = workoutSelectedUebungIds.indexOf(id);
        const up = row.querySelector('[data-move-up]');
        const down = row.querySelector('[data-move-down]');
        if (up) up.addEventListener('click', () => { if (idx > 0) { [workoutSelectedUebungIds[idx - 1], workoutSelectedUebungIds[idx]] = [workoutSelectedUebungIds[idx], workoutSelectedUebungIds[idx - 1]]; renderWorkoutPicker(); } });
        if (down) down.addEventListener('click', () => { if (idx < workoutSelectedUebungIds.length - 1) { [workoutSelectedUebungIds[idx + 1], workoutSelectedUebungIds[idx]] = [workoutSelectedUebungIds[idx], workoutSelectedUebungIds[idx + 1]]; renderWorkoutPicker(); } });
        row.querySelector('[data-remove]').addEventListener('click', () => { workoutSelectedUebungIds = workoutSelectedUebungIds.filter(x => x !== id); renderWorkoutPicker(); });
      });
    }

    function openWorkoutForm(workout) {
      editingWorkoutId = workout ? workout.id : null;
      workoutFormTitle.textContent = workout ? 'Workout bearbeiten' : 'Workout anlegen';
      document.getElementById('workout-name').value = workout ? workout.name : '';
      document.getElementById('workout-notiz').value = workout ? (workout.notiz || '') : '';
      workoutSelectedUebungIds = workout ? workoutUebungenFor(workout.id).map(u => u.id) : [];
      renderWorkoutPicker();
      workoutFormError.hidden = true;
      workoutFormBox.hidden = false;
    }

    function closeWorkoutForm() {
      workoutFormBox.hidden = true;
      editingWorkoutId = null;
      workoutSelectedUebungIds = [];
      workoutForm.reset();
    }

    if (newWorkoutBtn) newWorkoutBtn.addEventListener('click', () => openWorkoutForm(null));
    if (workoutCancelBtn) workoutCancelBtn.addEventListener('click', closeWorkoutForm);

    function renderWorkoutenList() {
      const list = document.getElementById('workoutenList');
      if (!list) return;
      list.innerHTML = workouts.length ? workouts.map(w => {
        const names = workoutUebungenFor(w.id).map(u => u.name);
        return `<div data-workout data-id="${w.id}" style="display:flex;gap:14px;align-items:flex-start;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px">
            <div style="font-size:15.5px;font-weight:600">${escapeHtml(w.name)}</div>
            <div style="font-size:13.5px;opacity:0.65;margin-top:3px">${names.length ? escapeHtml(names.join(', ')) : 'Noch keine Übung zugeordnet'}</div>
            ${w.notiz ? '<p style="margin:6px 0 0;font-size:14px;opacity:0.8">' + escapeHtml(w.notiz) + '</p>' : ''}
          </div>
          <div style="display:flex;gap:8px;flex:none">
            <button type="button" data-workout-edit style="cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">Bearbeiten</button>
            <button type="button" data-workout-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
          </div>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch kein Workout angelegt.</p>';
      list.querySelectorAll('[data-workout]').forEach(row => {
        const id = row.dataset.id;
        const workout = workouts.find(w => w.id === id);
        row.querySelector('[data-workout-edit]').addEventListener('click', () => openWorkoutForm(workout));
        row.querySelector('[data-workout-delete]').addEventListener('click', async () => {
          if (!confirm('Workout „' + workout.name + '" wirklich löschen? Die enthaltenen Übungen bleiben erhalten.')) return;
          try {
            const { error } = await client.from('trainingsworkouts').delete().eq('id', id);
            if (error) throw error;
            workouts = workouts.filter(w => w.id !== id);
            workoutUebungen = workoutUebungen.filter(wu => wu.workout_id !== id);
            renderWorkoutenList();
            populateWorkoutSelect();
          } catch (e) { alert('Konnte nicht gelöscht werden.'); }
        });
      });
    }
    renderWorkoutenList();

    if (workoutForm) {
      workoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        workoutFormError.hidden = true;
        const name = document.getElementById('workout-name').value.trim();
        if (!name) { workoutFormError.hidden = false; workoutFormError.textContent = 'Bitte einen Namen eintragen.'; return; }
        const notiz = document.getElementById('workout-notiz').value.trim();
        const btn = workoutForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          let workoutId = editingWorkoutId;
          if (editingWorkoutId) {
            const { data, error } = await client.from('trainingsworkouts').update({ name, notiz: notiz || null }).eq('id', editingWorkoutId).select().single();
            if (error) throw error;
            workouts = workouts.map(w => w.id === editingWorkoutId ? data : w);
            const { error: delErr } = await client.from('trainingsworkout_uebungen').delete().eq('workout_id', editingWorkoutId);
            if (delErr) throw delErr;
            workoutUebungen = workoutUebungen.filter(wu => wu.workout_id !== editingWorkoutId);
          } else {
            const { data, error } = await client.from('trainingsworkouts').insert({ user_id: userId, name, notiz: notiz || null }).select().single();
            if (error) throw error;
            workouts.unshift(data);
            workoutId = data.id;
          }
          if (workoutSelectedUebungIds.length) {
            const rows = workoutSelectedUebungIds.map((uebungId, i) => ({ user_id: userId, workout_id: workoutId, uebung_id: uebungId, reihenfolge: i }));
            const { data: inserted, error: insErr } = await client.from('trainingsworkout_uebungen').insert(rows).select();
            if (insErr) throw insErr;
            workoutUebungen = workoutUebungen.concat(inserted || []);
          }
          closeWorkoutForm();
          renderWorkoutenList();
          populateWorkoutSelect();
        } catch (e) {
          workoutFormError.hidden = false;
          workoutFormError.textContent = 'Konnte nicht gespeichert werden. Bitte erneut versuchen.';
        } finally {
          btn.disabled = false;
        }
      });
    }

    // ---- Diese-Woche / Charts ----
    function startOfWeek() {
      const d = new Date();
      const day = (d.getDay() + 6) % 7; // Montag = 0
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - day);
      return d;
    }

    function renderWeekSummary() {
      const monday = startOfWeek();
      const weekEntries = log.filter(l => l.datum && new Date(l.datum + 'T00:00:00') >= monday);
      const countEl = document.getElementById('weekCount');
      const minEl = document.getElementById('weekMinutes');
      if (countEl) countEl.textContent = String(weekEntries.length);
      if (minEl) minEl.textContent = String(weekEntries.reduce((sum, l) => sum + (l.dauer_minuten || 0), 0));
    }

    function renderCharts() {
      const chartWeeks = document.getElementById('chartWeeks');
      const chartTypes = document.getElementById('chartTypes');
      if (chartWeeks) {
        const thisMonday = startOfWeek();
        const weeks = [];
        for (let i = 7; i >= 0; i--) {
          const monday = new Date(thisMonday);
          monday.setDate(monday.getDate() - i * 7);
          const nextMonday = new Date(monday);
          nextMonday.setDate(nextMonday.getDate() + 7);
          const count = log.filter(l => {
            if (!l.datum) return false;
            const d = new Date(l.datum + 'T00:00:00');
            return d >= monday && d < nextMonday;
          }).length;
          weeks.push({ label: monday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), count });
        }
        const max = Math.max(1, ...weeks.map(w => w.count));
        chartWeeks.innerHTML = weeks.map(w => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">
            <div style="font-size:12px;opacity:0.7">${w.count}</div>
            <div style="width:100%;height:90px;display:flex;align-items:flex-end">
              <div style="width:100%;height:${Math.round((w.count / max) * 100)}%;min-height:${w.count ? 4 : 0}px;background:var(--color-accent);border-radius:4px 4px 0 0"></div>
            </div>
            <div style="font-size:10.5px;opacity:0.55;white-space:nowrap">${w.label}</div>
          </div>`).join('');
      }
      if (chartTypes) {
        const counts = {};
        log.forEach(l => {
          const key = l.uebung_id ? (uebungName(l.uebung_id) || 'Übung') : (TYP_LABEL[l.typ] || l.typ || 'Sonstiges');
          counts[key] = (counts[key] || 0) + 1;
        });
        const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const max = Math.max(1, ...entries.map(e => e[1]));
        chartTypes.innerHTML = entries.length ? entries.map(([name, count]) => `
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:110px;flex:none;font-size:13px;opacity:0.8;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(name)}</span>
            <div style="flex:1;background:var(--color-surface);border-radius:999px;height:16px;overflow:hidden"><div style="height:100%;width:${Math.round((count / max) * 100)}%;background:var(--color-accent-2-500);border-radius:999px"></div></div>
            <span style="width:20px;flex:none;font-size:13px;opacity:0.65">${count}</span>
          </div>`).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine Daten.</p>';
      }
    }

    // ---- Logbuch-Liste ----
    function renderLog() {
      const list = document.getElementById('logList');
      if (!list) return;
      list.innerHTML = log.length ? log.map(l => {
        const date = l.datum ? new Date(l.datum + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const uebung = l.uebung_id ? uebungById(l.uebung_id) : null;
        const art = uebung ? uebung.name : (TYP_LABEL[l.typ] || l.typ);
        const ergebnis = uebung && l.ergebnis_wert != null ? l.ergebnis_wert + (uebung.einheit ? ' ' + uebung.einheit : '') : null;
        const zeitInfo = l.aktive_zeit_sekunden ? 'Aktivzeit ' + fmtMMSS(l.aktive_zeit_sekunden) : (l.pausen_anzahl ? l.pausen_anzahl + ' Pausen' : null);
        const meta = [art, ergebnis, zeitInfo, l.dauer_minuten ? l.dauer_minuten + ' Min.' : null, l.anstrengung ? 'RPE ' + l.anstrengung : null].filter(Boolean).join(' · ');
        const routen = Array.isArray(l.routen_versuche) && l.routen_versuche.length ? `
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
            ${l.routen_versuche.map(r => `<div style="font-size:13.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="tag tag-neutral" style="font-size:10.5px">${escapeHtml(r.grad || '')}</span>
              ${r.name ? '<span>' + escapeHtml(r.name) + '</span>' : ''}
              <span style="opacity:0.65">${r.versuche || 1}× Versuch${(r.versuche || 1) > 1 ? 'e' : ''}</span>
              ${r.getoppt ? '<span style="color:var(--color-accent-2-700);font-weight:600">✓ getoppt</span>' : '<span style="opacity:0.5">nicht getoppt</span>'}
            </div>`).join('')}
          </div>` : '';
        const saetze = Array.isArray(l.satz_ergebnisse) && l.satz_ergebnisse.length ? `
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px">
            ${l.satz_ergebnisse.map(s => `<div style="font-size:13.5px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="tag tag-neutral" style="font-size:10.5px">Satz ${s.nr}</span>
              ${s.wiederholungen != null ? '<span>' + s.wiederholungen + ' Wdh.</span>' : ''}
              ${s.ergebnis_wert != null ? '<span>' + s.ergebnis_wert + (uebung && uebung.einheit ? ' ' + escapeHtml(uebung.einheit) : '') + '</span>' : ''}
              ${s.spezifikation ? '<span style="opacity:0.65">' + escapeHtml(s.spezifikation) + '</span>' : ''}
            </div>`).join('')}
          </div>` : '';
        return `<div data-log data-id="${l.id}" style="display:flex;gap:14px;align-items:flex-start;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline">
              <span style="font-size:15.5px;font-weight:600">${escapeHtml(date)}</span>
              <span style="font-size:13.5px;opacity:0.65">${escapeHtml(meta)}</span>
            </div>
            ${routen}
            ${saetze}
            ${l.notiz ? '<p style="margin:6px 0 0;font-size:14.5px;opacity:0.85">' + escapeHtml(l.notiz) + '</p>' : ''}
          </div>
          <button type="button" data-log-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine Einheit eingetragen.</p>';
      list.querySelectorAll('[data-log]').forEach(row => {
        const id = row.dataset.id;
        row.querySelector('[data-log-delete]').addEventListener('click', async () => {
          if (!confirm('Eintrag wirklich löschen?')) return;
          try {
            const { error } = await client.from('trainingslog').delete().eq('id', id);
            if (error) throw error;
            log = log.filter(l => l.id !== id);
            renderLog();
            renderWeekSummary();
            renderCharts();
          } catch (e) { alert('Konnte nicht gelöscht werden.'); }
        });
      });
    }

    // ---- Trainingseinheiten-Historie ----
    function renderEinheitenList() {
      const list = document.getElementById('einheitenList');
      if (!list) return;
      list.innerHTML = einheiten.length ? einheiten.map(e => {
        const date = e.datum ? new Date(e.datum + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const count = log.filter(l => l.einheit_id === e.id).length;
        return `<div data-einheit data-id="${e.id}" style="display:flex;gap:14px;align-items:center;background:var(--color-surface);border-radius:var(--radius-md);padding:14px 16px;flex-wrap:wrap">
          <div style="flex:1;min-width:160px">
            <span style="font-size:15.5px;font-weight:600">${escapeHtml(e.workout_name || 'Freies Training')}</span>
            <span style="font-size:13.5px;opacity:0.65;margin-left:8px">${escapeHtml(date)} · ${e.dauer_sekunden ? fmtMMSS(e.dauer_sekunden) + ' Min:Sek' : 'ohne Zeit'}${count ? ' · ' + count + ' Übung' + (count > 1 ? 'en' : '') : ''}</span>
          </div>
          <button type="button" data-einheit-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine Trainingseinheit abgeschlossen.</p>';
      list.querySelectorAll('[data-einheit]').forEach(row => {
        const id = row.dataset.id;
        row.querySelector('[data-einheit-delete]').addEventListener('click', async () => {
          if (!confirm('Trainingseinheit wirklich löschen? Die zugehörigen Logbuch-Einträge bleiben erhalten.')) return;
          try {
            const { error } = await client.from('trainingseinheiten').delete().eq('id', id);
            if (error) throw error;
            einheiten = einheiten.filter(e => e.id !== id);
            renderEinheitenList();
          } catch (e) { alert('Konnte nicht gelöscht werden.'); }
        });
      });
    }

    renderLog();
    renderWeekSummary();
    renderCharts();
    renderEinheitenList();

    // ---- Training-Session: Workout starten/beenden, Übungen abarbeiten ----
    const sessionWorkoutSelect = document.getElementById('sessionWorkoutSelect');
    const sessionIdleBox = document.getElementById('sessionIdleBox');
    const sessionActiveBox = document.getElementById('sessionActiveBox');
    const sessionExercisesBox = document.getElementById('sessionExercisesBox');
    const sessionWorkoutLabel = document.getElementById('sessionWorkoutLabel');
    const sessionTimerDisplay = document.getElementById('sessionTimerDisplay');
    const sessionStartBtn = document.getElementById('sessionStartBtn');
    const sessionEndBtn = document.getElementById('sessionEndBtn');
    const sessionExerciseCards = document.getElementById('sessionExerciseCards');
    const sessionAddUebungBtn = document.getElementById('sessionAddUebungBtn');
    const sessionAddUebungBox = document.getElementById('sessionAddUebungBox');
    const sessionAddUebungSelect = document.getElementById('sessionAddUebungSelect');
    const sessionAddUebungConfirm = document.getElementById('sessionAddUebungConfirm');

    function populateWorkoutSelect() {
      if (!sessionWorkoutSelect) return;
      const current = sessionWorkoutSelect.value;
      sessionWorkoutSelect.innerHTML = '<option value="">— Freies Training —</option>' +
        workouts.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
      if (workouts.some(w => w.id === current)) sessionWorkoutSelect.value = current;
    }
    populateWorkoutSelect();

    const sess = { active: false, einheitId: null, startedAt: 0, rafId: null, usedUebungIds: new Set() };

    function sessionTick() {
      if (!sess.active) return;
      const elapsed = Math.floor((Date.now() - sess.startedAt) / 1000);
      sessionTimerDisplay.textContent = fmtMMSS(elapsed);
      sess.rafId = requestAnimationFrame(sessionTick);
    }

    function populateAddUebungSelect() {
      sessionAddUebungSelect.innerHTML = uebungen.filter(u => !sess.usedUebungIds.has(u.id)).map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('') || '<option value="">Keine weiteren Übungen</option>';
    }

    function addExerciseCard(uebung) {
      if (!uebung || sess.usedUebungIds.has(uebung.id)) return;
      sess.usedUebungIds.add(uebung.id);
      const card = document.createElement('div');
      card.className = 'sess-ex-card';
      card.dataset.uebungId = uebung.id;

      const bodyFields = [];
      if (uebung.typ === 'kletterroute') {
        bodyFields.push(`
          <div id="routeList-${uebung.id}" style="display:flex;flex-direction:column;gap:6px"></div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;align-items:end">
            <div class="field"><label style="font-size:12.5px">Grad</label><select class="input" data-route-grad>${(GRAD_LISTEN[uebung.grad_system] || GRAD_LISTEN.fontainebleau).map(g => '<option value="' + g + '">' + g + '</option>').join('')}</select></div>
            <div class="field"><label style="font-size:12.5px">Name (optional)</label><input class="input" data-route-name maxlength="100"></div>
            <div class="field"><label style="font-size:12.5px">Versuche</label><input class="input" type="number" min="1" max="99" value="1" data-route-versuche></div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;padding-bottom:10px"><input type="checkbox" data-route-getoppt> Getoppt</label>
          </div>
          <button type="button" data-route-add style="align-self:flex-start;cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:8px 14px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">+ Versuch hinzufügen</button>
        `);
      } else if (uebung.saetze && uebung.saetze > 1) {
        const spezOptions = (uebung.spezifikationen || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        const rows = [];
        for (let i = 1; i <= uebung.saetze; i++) {
          rows.push(`
            <div data-satz-row data-nr="${i}" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:var(--color-surface);border-radius:var(--radius-md);padding:10px 12px">
              <strong style="min-width:50px;font-size:13.5px">Satz ${i}</strong>
              <div class="field" style="margin:0"><label style="font-size:11px">Wdh.${uebung.wiederholungen ? ' (Ziel ' + uebung.wiederholungen + ')' : ''}</label><input type="number" min="0" max="999" class="input" data-satz-wdh style="width:80px" placeholder="${uebung.wiederholungen || ''}"></div>
              ${uebung.einheit ? `<div class="field" style="margin:0"><label style="font-size:11px">Ergebnis (${escapeHtml(uebung.einheit)})</label><input type="number" step="any" class="input" data-satz-ergebnis style="width:90px"></div>` : ''}
              ${spezOptions ? `<div class="field" style="margin:0"><label style="font-size:11px">Spezifikation</label><select class="input" data-satz-spez style="width:130px"><option value="">–</option>${spezOptions}</select></div>` : ''}
            </div>`);
        }
        bodyFields.push(`<div data-satz-liste style="display:flex;flex-direction:column;gap:8px">${rows.join('')}</div>`);
      } else {
        const info = [uebung.wiederholungen ? uebung.wiederholungen + ' Wdh.' : null, Array.isArray(uebung.spezifikationen) && uebung.spezifikationen.length ? uebung.spezifikationen.join(', ') : null].filter(Boolean).join(' · ');
        if (info) bodyFields.push(`<p style="margin:0;font-size:13.5px;opacity:0.65">${escapeHtml(info)}</p>`);
        if (uebung.einheit) bodyFields.push(`<div class="field"><label>Ergebnis (${escapeHtml(uebung.einheit)})</label><input class="input" type="number" step="any" data-ex-ergebnis placeholder="z.B. 20"></div>`);
      }

      let timerHtml = '';
      if (uebung.timer_modus === 'pause') {
        timerHtml = `<div class="timer-box">
          <div class="timer-display" data-timer-display>${fmtMMSS(uebung.timer_pause_sekunden || 0)}</div>
          <div style="font-size:12.5px;opacity:0.65">Pausen genutzt: <span data-pausen-count>0</span></div>
          <button type="button" data-timer-pause-start class="btn btn-secondary" style="font-size:13.5px;padding:9px 18px">Pause starten</button>
        </div>`;
      } else if (uebung.timer_modus === 'intervall') {
        timerHtml = `<div class="timer-box">
          <div class="timer-display" data-timer-display>00:00</div>
          <button type="button" data-timer-toggle class="btn btn-primary" style="font-size:13.5px;padding:9px 18px">Start</button>
          <div data-interval-list style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center"></div>
        </div>`;
      }

      card.innerHTML = `
        <div class="sess-ex-head" data-ex-toggle>
          <div>
            <h4 style="margin:0;font-size:17px">${escapeHtml(uebung.name)}</h4>
            <span style="font-size:12.5px;opacity:0.6">${[uebung.art, UEBUNG_MASKE_LABEL[uebung.typ]].filter(Boolean).join(' · ')}</span>
          </div>
          <span data-ex-status style="font-size:13px;font-weight:600;opacity:0.6">Offen</span>
        </div>
        <div class="sess-ex-body" data-ex-body>
          ${timerHtml}
          ${bodyFields.join('')}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">
            <div class="field"><label style="font-size:12.5px">Dauer (Min., optional)</label><input class="input" type="number" min="1" max="600" data-ex-dauer></div>
            <div class="field"><label style="font-size:12.5px">Anstrengung (RPE 1–10, optional)</label><input class="input" type="number" min="1" max="10" data-ex-anstrengung></div>
          </div>
          <div class="field"><label style="font-size:12.5px">Notiz (optional)</label><textarea class="input" rows="2" data-ex-notiz maxlength="1000"></textarea></div>
          <p data-ex-error hidden style="margin:0;font-size:13.5px;color:var(--color-accent-700)"></p>
          <button type="button" data-ex-save class="btn btn-primary" style="align-self:flex-start;font-size:14.5px;padding:10px 22px">Speichern</button>
        </div>`;
      sessionExerciseCards.appendChild(card);

      // Kletterroute: lokale Liste der Versuche
      let routenVersuche = [];
      const routeListEl = card.querySelector(`#routeList-${CSS.escape(uebung.id)}`);
      if (routeListEl) {
        function renderRouteList() {
          routeListEl.innerHTML = routenVersuche.map((r, i) => `
            <div class="route-attempt-row" data-route-row data-idx="${i}">
              <strong>${escapeHtml(r.grad)}</strong>
              ${r.name ? '<span>' + escapeHtml(r.name) + '</span>' : ''}
              <span style="opacity:0.65">${r.versuche}× Versuch${r.versuche > 1 ? 'e' : ''}</span>
              <span>${r.getoppt ? '✓ getoppt' : 'nicht getoppt'}</span>
              <button type="button" data-route-remove style="cursor:pointer;font:inherit;margin-left:auto;background:transparent;border:0;opacity:0.5">✕</button>
            </div>`).join('');
          routeListEl.querySelectorAll('[data-route-row]').forEach(rowEl => {
            const idx = Number(rowEl.dataset.idx);
            rowEl.querySelector('[data-route-remove]').addEventListener('click', () => { routenVersuche.splice(idx, 1); renderRouteList(); });
          });
        }
        card.querySelector('[data-route-add]').addEventListener('click', () => {
          const grad = card.querySelector('[data-route-grad]').value;
          const name = card.querySelector('[data-route-name]').value.trim();
          const versuche = Number(card.querySelector('[data-route-versuche]').value) || 1;
          const getoppt = card.querySelector('[data-route-getoppt]').checked;
          routenVersuche.push({ grad, name: name || null, versuche, getoppt });
          renderRouteList();
          card.querySelector('[data-route-name]').value = '';
          card.querySelector('[data-route-versuche]').value = '1';
          card.querySelector('[data-route-getoppt]').checked = false;
        });
      }

      // Timer-Logik (pro Karte eigener Zustand)
      let aktiveZeitSekunden = 0;
      let intervallSekunden = [];
      let pausenAnzahl = 0;
      if (uebung.timer_modus === 'pause') {
        const display = card.querySelector('[data-timer-display]');
        const countEl = card.querySelector('[data-pausen-count]');
        const btn = card.querySelector('[data-timer-pause-start]');
        const total = uebung.timer_pause_sekunden || 60;
        let running = false;
        btn.addEventListener('click', () => {
          if (running) return;
          running = true;
          btn.disabled = true;
          let remaining = total;
          display.textContent = fmtMMSS(remaining);
          const iv = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
              clearInterval(iv);
              display.textContent = fmtMMSS(total);
              running = false;
              btn.disabled = false;
              pausenAnzahl += 1;
              countEl.textContent = String(pausenAnzahl);
            } else {
              display.textContent = fmtMMSS(remaining);
            }
          }, 1000);
        });
      } else if (uebung.timer_modus === 'intervall') {
        const display = card.querySelector('[data-timer-display]');
        const toggleBtn = card.querySelector('[data-timer-toggle]');
        const listEl = card.querySelector('[data-interval-list]');
        let running = false;
        let startedAt = 0;
        let rafId = null;
        function tick() {
          display.textContent = fmtMMSS((Date.now() - startedAt) / 1000);
          if (running) rafId = requestAnimationFrame(tick);
        }
        toggleBtn.addEventListener('click', () => {
          if (running) {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
            const dur = Math.round((Date.now() - startedAt) / 1000);
            intervallSekunden.push(dur);
            aktiveZeitSekunden += dur;
            listEl.innerHTML += `<span class="tag tag-neutral" style="font-size:11px">${fmtMMSS(dur)}</span>`;
            display.textContent = '00:00';
            toggleBtn.textContent = 'Start';
          } else {
            running = true;
            startedAt = Date.now();
            toggleBtn.textContent = 'Pause';
            tick();
          }
        });
      }

      card.querySelector('[data-ex-toggle]').addEventListener('click', () => {
        const body = card.querySelector('[data-ex-body]');
        body.hidden = !body.hidden;
      });

      card.querySelector('[data-ex-save]').addEventListener('click', async () => {
        const errorEl = card.querySelector('[data-ex-error]');
        errorEl.hidden = true;
        if (uebung.typ === 'kletterroute' && !routenVersuche.length) {
          errorEl.hidden = false;
          errorEl.textContent = 'Bitte mindestens einen Versuch hinzufügen.';
          return;
        }
        const ergebnisInput = card.querySelector('[data-ex-ergebnis]');
        const dauerInput = card.querySelector('[data-ex-dauer]');
        const anstrengungInput = card.querySelector('[data-ex-anstrengung]');
        const notizInput = card.querySelector('[data-ex-notiz]');

        const satzErgebnisse = Array.from(card.querySelectorAll('[data-satz-row]')).map(row => {
          const wdhInput = row.querySelector('[data-satz-wdh]');
          const ergInput = row.querySelector('[data-satz-ergebnis]');
          const spezSelect = row.querySelector('[data-satz-spez]');
          return {
            nr: Number(row.dataset.nr),
            wiederholungen: wdhInput && wdhInput.value ? Number(wdhInput.value) : null,
            ergebnis_wert: ergInput && ergInput.value ? Number(ergInput.value) : null,
            spezifikation: spezSelect && spezSelect.value ? spezSelect.value : null
          };
        });

        const payload = {
          user_id: userId,
          datum: new Date().toISOString().slice(0, 10),
          typ: null,
          uebung_id: uebung.id,
          einheit_id: sess.einheitId,
          ergebnis_wert: ergebnisInput && ergebnisInput.value ? Number(ergebnisInput.value) : null,
          dauer_minuten: dauerInput && dauerInput.value ? Number(dauerInput.value) : null,
          anstrengung: anstrengungInput && anstrengungInput.value ? Number(anstrengungInput.value) : null,
          notiz: notizInput && notizInput.value.trim() ? notizInput.value.trim() : null,
          aktive_zeit_sekunden: aktiveZeitSekunden || null,
          intervall_sekunden: intervallSekunden.length ? intervallSekunden : null,
          pausen_anzahl: uebung.timer_modus === 'pause' ? pausenAnzahl : null,
          routen_versuche: routenVersuche.length ? routenVersuche : null,
          satz_ergebnisse: satzErgebnisse.length ? satzErgebnisse : null
        };

        const saveBtn = card.querySelector('[data-ex-save]');
        saveBtn.disabled = true;
        try {
          const { data, error } = await client.from('trainingslog').insert(payload).select().single();
          if (error) throw error;
          log.unshift(data);
          log.sort((a, b) => (b.datum + b.created_at).localeCompare(a.datum + a.created_at));
          card.dataset.done = 'true';
          card.querySelector('[data-ex-status]').textContent = '✓ Gespeichert';
          card.querySelector('[data-ex-body]').hidden = true;
          renderLog();
          renderWeekSummary();
          renderCharts();
        } catch (e) {
          errorEl.hidden = false;
          errorEl.textContent = 'Konnte nicht gespeichert werden. Bitte erneut versuchen.';
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    function startSession() {
      const workoutId = sessionWorkoutSelect.value || null;
      const workout = workoutId ? workouts.find(w => w.id === workoutId) : null;
      sess.usedUebungIds = new Set();
      sessionExerciseCards.innerHTML = '';

      sessionStartBtn.disabled = true;
      client.from('trainingseinheiten').insert({
        user_id: userId,
        workout_id: workoutId,
        workout_name: workout ? workout.name : null,
        datum: new Date().toISOString().slice(0, 10)
      }).select().single().then(({ data, error }) => {
        sessionStartBtn.disabled = false;
        if (error || !data) { alert('Training konnte nicht gestartet werden. Bitte erneut versuchen.'); return; }
        einheiten.unshift(data);
        sess.active = true;
        sess.einheitId = data.id;
        sess.startedAt = Date.now();
        sessionWorkoutLabel.textContent = workout ? workout.name : 'Freies Training';
        sessionIdleBox.hidden = true;
        sessionActiveBox.hidden = false;
        sessionExercisesBox.hidden = false;
        sessionTick();
        if (workout) workoutUebungenFor(workout.id).forEach(u => addExerciseCard(u));
        populateAddUebungSelect();
      });
    }

    function endSession() {
      if (!sess.active) return;
      sess.active = false;
      if (sess.rafId) cancelAnimationFrame(sess.rafId);
      const dauer = Math.floor((Date.now() - sess.startedAt) / 1000);
      client.from('trainingseinheiten').update({ dauer_sekunden: dauer }).eq('id', sess.einheitId).select().single().then(({ data }) => {
        if (data) einheiten = einheiten.map(e => e.id === data.id ? data : e);
        renderEinheitenList();
      });
      sessionIdleBox.hidden = false;
      sessionActiveBox.hidden = true;
      sessionExercisesBox.hidden = true;
      sessionAddUebungBox.hidden = true;
      sessionExerciseCards.innerHTML = '';
      sess.einheitId = null;
    }

    if (sessionStartBtn) sessionStartBtn.addEventListener('click', startSession);
    if (sessionEndBtn) sessionEndBtn.addEventListener('click', () => {
      if (confirm('Training beenden und Gesamtzeit speichern?')) endSession();
    });
    if (sessionAddUebungBtn) sessionAddUebungBtn.addEventListener('click', () => {
      populateAddUebungSelect();
      sessionAddUebungBox.hidden = !sessionAddUebungBox.hidden;
    });
    if (sessionAddUebungConfirm) sessionAddUebungConfirm.addEventListener('click', () => {
      const id = sessionAddUebungSelect.value;
      if (!id) return;
      addExerciseCard(uebungById(id));
      populateAddUebungSelect();
    });
  }

  // --------------------------------------------------------------------
  // Seite: konto-qualifikationen
  // --------------------------------------------------------------------
  async function renderQualifikationen(ctx) {
    const { progress } = ctx;
    const root = document.getElementById('qualCards');
    if (!root) return;
    root.innerHTML = qualifications().map(q => {
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
    const totalReq = qualifications().reduce((n, q) => n + q.requirements.length, 0);
    const doneReq = qualifications().reduce((n, q) => n + q.requirements.filter(r => progress[r.id] && progress[r.id].passed).length, 0);
    const bar = document.getElementById('wegBar');
    if (bar) bar.style.width = (totalReq ? Math.round((doneReq / totalReq) * 100) : 0) + '%';
    const label = document.getElementById('wegLabel');
    if (label) label.textContent = doneReq + ' von ' + totalReq + ' Schritten';

    const root = document.getElementById('wegPath');
    if (!root) return;
    root.innerHTML = qualifications().map(q => {
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
      'konto-weg': renderWeg,
      'konto-training': renderTraining
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
