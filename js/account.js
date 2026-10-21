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
  // Login-Adressen der Kursleitung/Admins — müssen exakt zur admin_emails-
  // Tabelle bzw. is_betamove_admin() in der Datenbank passen (siehe
  // supabase/schema-admin-multi.sql). Neue Admin-Adresse hinzufügen: hier UND
  // per INSERT in public.admin_emails eintragen, sonst sieht die Person zwar
  // den Admin-Link, aber die Datenbank-Policies lassen sie nichts lesen/ändern
  // (oder umgekehrt).
  const ADMIN_EMAILS = ['noel.uhlrich@gmail.com', 'annalenafritz@outlook.com'];

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
  //
  // Bewusst client.auth.getUser() statt getSession(): getSession() liest nur
  // den lokal gespeicherten Token, ohne ihn zu prüfen — ist der Token
  // zwischenzeitlich abgelaufen oder ungültig (z.B. Tab lange offen/im
  // Hintergrund), liefert getSession() trotzdem noch eine user_id, obwohl
  // die eigentliche Anfrage beim Insert dann als "anon" (auth.uid() = NULL)
  // ankommt — das hat die RLS-Regel "user_id IS NULL OR user_id = auth.uid()"
  // zuverlässig blockiert und die Kursanmeldung komplett lahmgelegt.
  // getUser() prüft den Token dagegen aktiv beim Supabase-Server, sodass die
  // zurückgegebene user_id immer zu dem passt, was die Datenbank gleich
  // sieht.
  window.bmCurrentUserId = async function () {
    const client = getClient();
    if (!client) return null;
    try {
      const { data, error } = await withTimeout(client.auth.getUser(), 7000);
      if (error || !data || !data.user) return null;
      return data.user.id;
    } catch (e) { return null; }
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
    if (!ADMIN_EMAILS.includes(session.user.email)) {
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
      // Absoluter Pfad (nicht nur "konto"): diese Funktion läuft auf JEDER
      // Seite, auch auf welchen, die wie kurse/index.html eine Ebene tiefer
      // liegen (URL /kurse/) — ein relativer Link hätte sich dort zu
      // /kurse/konto aufgelöst (404), statt zu /konto.
      navLogin.setAttribute('href', '/konto');
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
    if (navEl && ADMIN_EMAILS.includes(session.user.email) && !navEl.querySelector('[data-admin-link]')) {
      const adminLink = document.createElement('a');
      adminLink.href = '/admin-kurse';
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
      level: document.getElementById('fLevel'),
      koerpergewicht: document.getElementById('fKoerpergewicht')
    };
    if (fields.vorname) fields.vorname.value = profile.vorname || '';
    if (fields.nachname) fields.nachname.value = profile.nachname || '';
    if (fields.email) fields.email.value = profile.email || session.user.email || '';
    if (fields.koerpergewicht) fields.koerpergewicht.value = profile.koerpergewicht_kg != null ? profile.koerpergewicht_kg : '';
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
        const koerpergewichtVal = fields.koerpergewicht && fields.koerpergewicht.value ? Number(fields.koerpergewicht.value) : null;
        const payload = {
          id: session.user.id,
          vorname: (fields.vorname && fields.vorname.value.trim()) || profile.vorname,
          nachname: (fields.nachname && fields.nachname.value.trim()) || profile.nachname,
          email: profile.email || session.user.email,
          level: activeLevel ? activeLevel.textContent.trim() : profile.level,
          koerpergewicht_kg: koerpergewichtVal
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

    const coachBtn = document.getElementById('coachZugriffBtn');
    const coachSaved = document.getElementById('coachZugriffSaved');
    const coachBearbeitenBox = document.getElementById('coachBearbeitenBox');
    const coachBearbeitenBtn = document.getElementById('coachBearbeitenBtn');
    const coachBearbeitenSaved = document.getElementById('coachBearbeitenSaved');
    let coachFreigabe = !!profile.training_coach_freigabe;
    let coachBearbeiten = !!profile.training_coach_bearbeiten;
    function renderCoachBtn() {
      if (!coachBtn) return;
      coachBtn.textContent = coachFreigabe ? 'Zugriff entziehen' : 'Zugriff gewähren';
      coachBtn.style.borderColor = coachFreigabe ? 'var(--color-accent-2-500)' : 'var(--color-divider)';
      coachBtn.style.background = coachFreigabe ? 'var(--color-accent-2-500)' : 'transparent';
      coachBtn.style.color = coachFreigabe ? '#ffffff' : 'var(--color-text)';
      if (coachBearbeitenBox) coachBearbeitenBox.hidden = !coachFreigabe;
    }
    function renderCoachBearbeitenBtn() {
      if (!coachBearbeitenBtn) return;
      coachBearbeitenBtn.textContent = coachBearbeiten ? 'Änderungen wieder sperren' : 'Änderungen erlauben';
      coachBearbeitenBtn.style.borderColor = coachBearbeiten ? 'var(--color-accent-2-500)' : 'var(--color-divider)';
      coachBearbeitenBtn.style.background = coachBearbeiten ? 'var(--color-accent-2-500)' : 'transparent';
      coachBearbeitenBtn.style.color = coachBearbeiten ? '#ffffff' : 'var(--color-text)';
    }
    renderCoachBtn();
    renderCoachBearbeitenBtn();
    if (coachBtn) {
      coachBtn.addEventListener('click', async () => {
        if (coachSaved) coachSaved.hidden = true;
        const next = !coachFreigabe;
        const payload = { training_coach_freigabe: next };
        // Lesezugriff entziehen nimmt automatisch auch den Bearbeiten-Zugriff zurück.
        if (!next) payload.training_coach_bearbeiten = false;
        coachBtn.disabled = true;
        try {
          const { error } = await client.from('profiles').update(payload).eq('id', session.user.id);
          if (error) throw error;
          coachFreigabe = next;
          if (!next) coachBearbeiten = false;
          renderCoachBtn();
          renderCoachBearbeitenBtn();
          if (coachSaved) coachSaved.hidden = false;
        } catch (e) {
          alert('Konnte nicht gespeichert werden. Bitte erneut versuchen.');
        } finally {
          coachBtn.disabled = false;
        }
      });
    }
    if (coachBearbeitenBtn) {
      coachBearbeitenBtn.addEventListener('click', async () => {
        if (coachBearbeitenSaved) coachBearbeitenSaved.hidden = true;
        const next = !coachBearbeiten;
        coachBearbeitenBtn.disabled = true;
        try {
          const { error } = await client.from('profiles').update({ training_coach_bearbeiten: next }).eq('id', session.user.id);
          if (error) throw error;
          coachBearbeiten = next;
          renderCoachBearbeitenBtn();
          if (coachBearbeitenSaved) coachBearbeitenSaved.hidden = false;
        } catch (e) {
          alert('Konnte nicht gespeichert werden. Bitte erneut versuchen.');
        } finally {
          coachBearbeitenBtn.disabled = false;
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
  const ZYKLUS_BUILTIN = ['Hypertrophie', 'Maximalkraft', 'Kraftausdauer', 'Schnellkraft', 'Ausdauer', 'Deload/Regeneration'];
  const UEBUNG_VORLAGEN_KRAFT = [
    { name: 'Fingerboard Max Hang', art: 'Geräte', typ: 'klassisch', trainingsart: 'maximalkraft', einheit: 'kg', saetze: 6, wiederholungen: null, spezifikationen: ['Half Crimp', 'Open Hand'], timer_modus: 'pause', timer_pause_sekunden: 180, notiz: 'Max. Zusatz- bzw. Abzuggewicht für 7–10 Sekunden Hang, volle Erholung zwischen den Sätzen.' },
    { name: 'Campus-Board Up-Moves', art: 'Geräte', typ: 'klassisch', trainingsart: 'schnellkraft', einheit: null, saetze: 4, wiederholungen: 5, spezifikationen: [], timer_modus: 'pause', timer_pause_sekunden: 180, notiz: 'Explosive Züge zwischen den Leisten, nur im ausgeruhten Zustand trainieren.' },
    { name: 'Weighted Pull-Ups', art: 'Athletik', typ: 'klassisch', trainingsart: 'maximalkraft', einheit: 'kg', saetze: 5, wiederholungen: 3, spezifikationen: [], timer_modus: 'pause', timer_pause_sekunden: 150, notiz: 'Zusatzgewicht am Gurt, saubere Ausführung bis knapp vors Scheitern.' }
  ];
  const UEBUNG_VORLAGEN_PRAEVENTION = [
    { name: 'Schulter-Außenrotation (Band)', art: 'Athletik', typ: 'klassisch', trainingsart: 'ausdauer', einheit: null, saetze: 3, wiederholungen: 15, spezifikationen: ['Je Seite'], timer_modus: 'keiner', timer_pause_sekunden: null, notiz: 'Gleicht die Innenrotations-/Zuglast beim Klettern aus, schont die Rotatorenmanschette.' },
    { name: 'Unterarm-Extensoren', art: 'Athletik', typ: 'klassisch', trainingsart: 'ausdauer', einheit: 'kg', saetze: 3, wiederholungen: 15, spezifikationen: [], timer_modus: 'keiner', timer_pause_sekunden: null, notiz: 'Handgelenksstreckung mit leichtem Gewicht, beugt Tennisarm/Ellenbogenreizung vor.' },
    { name: 'Pallof Press', art: 'Athletik', typ: 'klassisch', trainingsart: 'ausdauer', einheit: 'kg', saetze: 3, wiederholungen: 12, spezifikationen: ['Je Seite'], timer_modus: 'keiner', timer_pause_sekunden: null, notiz: 'Anti-Rotations-Übung für den Rumpf, wichtig für Stabilität an steilen Wänden.' }
  ];
  const TIMER_MODUS_LABEL = { keiner: 'Kein Timer', pause: 'Nur Pause', intervall: 'Intervall (Start/Pause)' };

  function fmtMMSS(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  async function renderTraining(ctx) {
    const { client, session, profile } = ctx;
    const userId = session.user.id;
    const koerpergewichtKg = profile && profile.koerpergewicht_kg != null ? Number(profile.koerpergewicht_kg) : null;

    function prozentKG(ergebnisWert) {
      if (koerpergewichtKg == null || ergebnisWert == null) return null;
      const pct = ((koerpergewichtKg + Number(ergebnisWert)) / koerpergewichtKg) * 100;
      return Math.round(pct * 10) / 10;
    }
    function isKgEinheit(einheit) {
      return typeof einheit === 'string' && einheit.trim().toLowerCase() === 'kg';
    }

    let ziele = [];
    let log = [];
    let uebungen = [];
    let workouts = [];
    let workoutUebungen = [];
    let einheiten = [];
    let uebungArten = [];
    let trainingsplaene = [];
    let trainingsplanEintraege = [];
    let planZyklen = [];
    let eigeneVorlagen = [];
    let zyklusSelectedBlock = 0;
    let zyklusAutoSelect = true;
    try {
      const [zieleRes, logRes, uebungenRes, workoutsRes, workoutUebungenRes, einheitenRes, artenRes, plaeneRes, planEintraegeRes, zyklenRes, vorlagenRes] = await Promise.all([
        client.from('trainingsziele').select('*').order('created_at', { ascending: false }),
        client.from('trainingslog').select('*').order('datum', { ascending: false }).order('created_at', { ascending: false }),
        client.from('trainingsuebungen').select('*').order('created_at', { ascending: false }),
        client.from('trainingsworkouts').select('*').order('created_at', { ascending: false }),
        client.from('trainingsworkout_uebungen').select('*').order('reihenfolge', { ascending: true }),
        client.from('trainingseinheiten').select('*').order('created_at', { ascending: false }).limit(30),
        client.from('trainingsuebung_arten').select('*').order('created_at', { ascending: true }),
        client.from('trainingsplaene').select('*').order('created_at', { ascending: false }),
        client.from('trainingsplan_eintraege').select('*').order('woche_nr', { ascending: true }),
        client.from('trainingsplan_zyklen').select('*').order('created_at', { ascending: true }),
        client.from('trainingsuebung_vorlagen').select('*').order('created_at', { ascending: false })
      ]);
      [zieleRes, logRes, uebungenRes, workoutsRes, workoutUebungenRes, einheitenRes, artenRes, plaeneRes, planEintraegeRes, zyklenRes, vorlagenRes].forEach(r => { if (r.error) throw r.error; });
      ziele = zieleRes.data || [];
      log = logRes.data || [];
      uebungen = uebungenRes.data || [];
      workouts = workoutsRes.data || [];
      workoutUebungen = workoutUebungenRes.data || [];
      einheiten = einheitenRes.data || [];
      uebungArten = artenRes.data || [];
      trainingsplaene = plaeneRes.data || [];
      trainingsplanEintraege = planEintraegeRes.data || [];
      planZyklen = zyklenRes.data || [];
      eigeneVorlagen = vorlagenRes.data || [];
    } catch (e) {
      const el = document.getElementById('zieleList');
      if (el) el.innerHTML = '<p style="margin:0;font-size:15px;color:var(--color-accent-700)">Konnte nicht geladen werden. Bitte Seite neu laden.</p>';
    }

    function uebungById(id) { return uebungen.find(u => u.id === id) || null; }
    function uebungName(id) { const u = uebungById(id); return u ? u.name : null; }
    function workoutUebungenFor(workoutId) {
      return workoutUebungen.filter(wu => wu.workout_id === workoutId).map(wu => uebungById(wu.uebung_id)).filter(Boolean);
    }
    function workoutById(id) { return workouts.find(w => w.id === id) || null; }
    function fmtDateShort(d) { return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

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
      const activePlan = trainingsplaene.find(p => p.aktiv);
      const planWeek = activePlan ? currentWeekNrForPlan(activePlan) : null;
      const planEntries = (activePlan && planWeek) ? trainingsplanEintraege.filter(e => e.plan_id === activePlan.id && e.woche_nr === planWeek) : [];

      const sub = document.getElementById('wochenplanSub');
      if (sub) {
        if (activePlan && planWeek) {
          const phase = planEntries.length ? planEntries[0].phase : null;
          sub.hidden = false;
          sub.textContent = activePlan.name + ' · Woche ' + planWeek + ' von ' + activePlan.wochen_anzahl + (phase ? ' · ' + phase : '');
        } else {
          sub.hidden = true;
        }
      }

      grid.innerHTML = WOCHENTAGE.map(wd => {
        const items = uebungen.filter(u => (u.wochentage || []).includes(wd.n));
        const planItems = planEntries.filter(e => e.wochentag === wd.n);
        const planHtml = planItems.map(e => {
          const done = isEintragErledigt(e, activePlan);
          return '<div class="wp-day-item" style="font-weight:600;color:var(--color-accent-700)">📅 ' + escapeHtml(e.workout_name || '–') + (done ? ' ✓' : '') + '</div>';
        }).join('');
        const uebungenHtml = items.map(u => '<div class="wp-day-item">' + escapeHtml(u.name) + '</div>').join('');
        return `<div class="wp-day" data-today="${wd.n === todayIso}">
          <h4>${wd.short}</h4>
          ${planHtml}${uebungenHtml}
          ${(!planItems.length && !items.length) ? '<div class="wp-day-item" style="opacity:0.4;border-top:0">—</div>' : ''}
        </div>`;
      }).join('');
      if (typeof renderZyklus === 'function') renderZyklus();
    }
    renderWochenplan();

    // ---- Trainingsplan (Mesozyklus): Zyklus -> Wochen mit Phase + Workout-Zuordnung ----
    function planWocheRange(plan, wocheNr) {
      const start = new Date(plan.start_datum + 'T00:00:00');
      start.setDate(start.getDate() + (wocheNr - 1) * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return { start, end };
    }
    function currentWeekNrForPlan(plan) {
      const start = new Date(plan.start_datum + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffDays = Math.floor((today - start) / 86400000);
      if (diffDays < 0) return null;
      const wn = Math.floor(diffDays / 7) + 1;
      return wn <= plan.wochen_anzahl ? wn : null;
    }
    function isEintragErledigt(eintrag, plan) {
      if (!eintrag.workout_id) return false;
      const range = planWocheRange(plan, eintrag.woche_nr);
      return einheiten.some(e => {
        if (e.workout_id !== eintrag.workout_id || !e.datum) return false;
        const d = new Date(e.datum + 'T00:00:00');
        return d >= range.start && d <= range.end;
      });
    }

    // ---- Zyklus: Mikrozyklus-Blöcke mit Belastung/Entlastung ----
    function istEntlastungPhase(phase) {
      return /entlast|deload|pause|regenerat/i.test(phase || '');
    }
    function zyklusFarbe(stufe, max) {
      const stufen = ['var(--color-accent-2-300)', 'var(--color-accent-2-400)', 'var(--color-accent-700)'];
      const idx = Math.min(stufen.length - 1, Math.max(0, Math.round((stufe / Math.max(1, max)) * (stufen.length - 1))));
      return stufen[idx];
    }
    function wochenFuerPlan(plan) {
      const out = [];
      for (let nr = 1; nr <= plan.wochen_anzahl; nr++) {
        const entries = trainingsplanEintraege.filter(e => e.plan_id === plan.id && e.woche_nr === nr);
        const phase = entries.length ? (entries.find(e => e.phase) || entries[0]).phase : null;
        let pensum = 0;
        entries.forEach(e => {
          if (!e.workout_id) return;
          pensum += workoutUebungenFor(e.workout_id).reduce((sum, u) => sum + (u.saetze || 1), 0);
        });
        out.push({ nr, phase, pensum });
      }
      return out;
    }
    function blocksFuer(wochen, laenge) {
      const out = [];
      for (let i = 0; i < wochen.length; i += laenge) out.push(wochen.slice(i, i + laenge));
      return out;
    }

    function renderZyklus() {
      const empty = document.getElementById('zyklusEmpty');
      const content = document.getElementById('zyklusContent');
      if (!empty || !content) return;
      const plan = trainingsplaene.find(p => p.aktiv);
      if (!plan) {
        empty.hidden = false;
        content.hidden = true;
        return;
      }
      empty.hidden = true;
      content.hidden = false;

      document.getElementById('zyklusPlanName').textContent = plan.name;
      const startFmt = new Date(plan.start_datum + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      document.getElementById('zyklusPlanHint').textContent = plan.wochen_anzahl + ' Wochen gesamt · gestartet am ' + startFmt;

      const laengePills = document.getElementById('zyklusLaengePills');
      const laenge = plan.mikrozyklus_wochen || 4;
      laengePills.querySelectorAll('.zyklus-pill').forEach(p => { p.dataset.active = String(Number(p.dataset.len) === laenge); });

      const wochen = wochenFuerPlan(plan);
      const heuteWoche = currentWeekNrForPlan(plan);
      const blocks = blocksFuer(wochen, laenge);

      zyklusSelectedBlock = Math.max(0, Math.min(zyklusSelectedBlock, blocks.length - 1));
      if (zyklusAutoSelect) {
        blocks.forEach((blk, i) => { if (heuteWoche && blk.some(w => w.nr === heuteWoche)) zyklusSelectedBlock = i; });
        zyklusAutoSelect = false;
      }

      const picker = document.getElementById('zyklusBlockPicker');
      picker.innerHTML = blocks.map((blk, i) => {
        const isNowBlock = heuteWoche && blk.some(w => w.nr === heuteWoche);
        return `<button type="button" class="zyklus-block-btn" data-active="${i === zyklusSelectedBlock}" data-i="${i}">Block ${i + 1} · W${blk[0].nr}–${blk[blk.length - 1].nr}${isNowBlock ? '<span class="zyklus-now-pip"></span>' : ''}</button>`;
      }).join('');
      picker.querySelectorAll('[data-i]').forEach(btn => {
        btn.addEventListener('click', () => { zyklusSelectedBlock = Number(btn.dataset.i); zyklusAutoSelect = false; renderZyklus(); });
      });

      const grid = document.getElementById('zyklusGrid');
      const blk = blocks[zyklusSelectedBlock] || [];
      const maxPensum = Math.max(1, ...blk.map(w => w.pensum));
      let belastungIdx = 0;
      const belastungMax = blk.filter(w => !istEntlastungPhase(w.phase)).length - 1;
      let vorher = null;

      grid.innerHTML = blk.map(w => {
        const ent = istEntlastungPhase(w.phase);
        const farbe = ent ? 'var(--color-warn)' : zyklusFarbe(belastungIdx, belastungMax);
        const isNow = heuteWoche === w.nr;
        let pensumHtml;
        if (!w.pensum && vorher == null) {
          pensumHtml = '<div class="zyklus-pensum" style="opacity:0.45">Keine Workouts geplant</div>';
        } else if (vorher == null) {
          pensumHtml = '<div class="zyklus-pensum">Basis</div>';
        } else if (!vorher) {
          pensumHtml = '<div class="zyklus-pensum">–</div>';
        } else {
          const delta = Math.round(((w.pensum - vorher) / vorher) * 100);
          pensumHtml = '<div class="zyklus-pensum" style="color:' + (delta >= 0 ? 'var(--color-accent-700)' : 'var(--color-warn)') + '">' + (delta >= 0 ? '↑ +' + delta : '↓ ' + delta) + '% Pensum</div>';
        }
        const barHeight = Math.max(10, Math.round((w.pensum / maxPensum) * 64));
        const html = `<div class="zyklus-week" data-now="${isNow}">
          <div class="zyklus-week-top">
            <div class="zyklus-week-nr">Woche ${w.nr}</div>
            ${isNow ? '<span class="zyklus-now-badge">JETZT</span>' : ''}
          </div>
          <div class="zyklus-phase-tag" style="background:${farbe}">${ent ? 'Entlastung' : 'Belastung'}</div>
          <div class="zyklus-bar-track"><div class="zyklus-bar" style="height:${barHeight}px;background:${farbe}"></div></div>
          ${pensumHtml}
          ${ent ? '<div class="zyklus-note">Gewicht &amp; Umfang runter — Erholung im Fokus.</div>' : ''}
        </div>`;
        vorher = w.pensum;
        if (!ent) belastungIdx++;
        return html;
      }).join('');
    }

    const zyklusLaengePills = document.getElementById('zyklusLaengePills');
    if (zyklusLaengePills) {
      zyklusLaengePills.addEventListener('click', async (e) => {
        const btn = e.target.closest('.zyklus-pill');
        if (!btn) return;
        const plan = trainingsplaene.find(p => p.aktiv);
        if (!plan) return;
        const next = Number(btn.dataset.len);
        if ((plan.mikrozyklus_wochen || 4) === next) return;
        try {
          const { error } = await client.from('trainingsplaene').update({ mikrozyklus_wochen: next }).eq('id', plan.id);
          if (error) throw error;
          plan.mikrozyklus_wochen = next;
          zyklusSelectedBlock = 0;
          zyklusAutoSelect = true;
          renderZyklus();
        } catch (err) { alert('Konnte nicht gespeichert werden.'); }
      });
    }

    const planFormBox = document.getElementById('planFormBox');
    const planForm = document.getElementById('planForm');
    const planFormTitle = document.getElementById('planFormTitle');
    const planFormError = document.getElementById('planFormError');
    const newPlanBtn = document.getElementById('newPlanBtn');
    const planCancelBtn = document.getElementById('planCancelBtn');
    const planZyklusPills = document.getElementById('planZyklusPills');
    const planWochenEditorBox = document.getElementById('planWochenEditorBox');
    const planWochenEditorTitle = document.getElementById('planWochenEditorTitle');
    const planWochenEditorClose = document.getElementById('planWochenEditorClose');
    const planWochenList = document.getElementById('planWochenList');
    let editingPlanId = null;
    let editingPlanWochen = null;
    let planEintraegeStaged = [];
    let planEintraegeStagedCounter = 1;

    // ---- Zyklus (Hypertrophie/Maximalkraft/... + selbst hinzugefügte) ----
    function renderZyklusPills() {
      const custom = planZyklen.map(z => z.name);
      const current = activeZyklus();
      planZyklusPills.innerHTML = ZYKLUS_BUILTIN.concat(custom).map(name =>
        `<button type="button" class="wd-pill" data-zyklus="${escapeHtml(name)}">${escapeHtml(name)}</button>`
      ).join('') + `<button type="button" class="wd-pill" data-zyklus-add>+ Neuer Zyklus</button>`;
      if (current) setActiveZyklus(current);
      planZyklusPills.querySelectorAll('.wd-pill[data-zyklus]').forEach(btn => {
        btn.addEventListener('click', () => setActiveZyklus(btn.dataset.zyklus === activeZyklus() ? '' : btn.dataset.zyklus));
      });
      const addBtn = planZyklusPills.querySelector('[data-zyklus-add]');
      if (addBtn) addBtn.addEventListener('click', async () => {
        const name = (prompt('Name des neuen Zyklus:') || '').trim();
        if (!name) return;
        try {
          const { data, error } = await client.from('trainingsplan_zyklen').insert({ user_id: userId, name }).select().single();
          if (error) throw error;
          planZyklen.push(data);
          renderZyklusPills();
          setActiveZyklus(name);
        } catch (e) { alert('Konnte nicht gespeichert werden.'); }
      });
    }
    function setActiveZyklus(z) {
      planZyklusPills.querySelectorAll('.wd-pill[data-zyklus]').forEach(btn => { btn.dataset.active = String(btn.dataset.zyklus === z); });
    }
    function activeZyklus() {
      const btn = planZyklusPills.querySelector('.wd-pill[data-zyklus][data-active="true"]');
      return btn ? btn.dataset.zyklus : '';
    }
    renderZyklusPills();

    // ---- Plan anlegen/bearbeiten ----
    function openPlanForm(plan) {
      editingPlanId = plan ? plan.id : null;
      planFormTitle.textContent = plan ? 'Plan bearbeiten' : 'Plan anlegen';
      document.getElementById('plan-name').value = plan ? plan.name : '';
      document.getElementById('plan-start').value = plan ? plan.start_datum : new Date().toISOString().slice(0, 10);
      document.getElementById('plan-wochen').value = plan ? plan.wochen_anzahl : 4;
      document.getElementById('plan-notiz').value = plan ? (plan.notiz || '') : '';
      setActiveZyklus(plan ? (plan.zyklus || '') : '');
      planFormError.hidden = true;
      planFormBox.hidden = false;
      planFormBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function closePlanForm() {
      planFormBox.hidden = true;
      editingPlanId = null;
      planForm.reset();
      setActiveZyklus('');
    }
    if (newPlanBtn) newPlanBtn.addEventListener('click', () => openPlanForm(null));
    if (planCancelBtn) planCancelBtn.addEventListener('click', closePlanForm);

    if (planForm) {
      planForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        planFormError.hidden = true;
        const name = document.getElementById('plan-name').value.trim();
        const start = document.getElementById('plan-start').value;
        const wochenAnzahl = Number(document.getElementById('plan-wochen').value);
        const notiz = document.getElementById('plan-notiz').value.trim();
        if (!name || !start || !wochenAnzahl) {
          planFormError.hidden = false;
          planFormError.textContent = 'Bitte Name, Start-Datum und Wochenanzahl angeben.';
          return;
        }
        const btn = planForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          const payload = { user_id: userId, name, zyklus: activeZyklus() || null, start_datum: start, wochen_anzahl: wochenAnzahl, notiz: notiz || null };
          if (editingPlanId) {
            const { data, error } = await client.from('trainingsplaene').update(payload).eq('id', editingPlanId).select().single();
            if (error) throw error;
            trainingsplaene = trainingsplaene.map(p => p.id === editingPlanId ? data : p);
            const { error: pruneErr } = await client.from('trainingsplan_eintraege').delete().eq('plan_id', editingPlanId).gt('woche_nr', wochenAnzahl);
            if (pruneErr) throw pruneErr;
            trainingsplanEintraege = trainingsplanEintraege.filter(x => !(x.plan_id === editingPlanId && x.woche_nr > wochenAnzahl));
          } else {
            const { data, error } = await client.from('trainingsplaene').insert(payload).select().single();
            if (error) throw error;
            trainingsplaene.unshift(data);
          }
          closePlanForm();
          renderPlanList();
          renderPlanWocheBanner();
          renderWochenplan();
        } catch (e) {
          planFormError.hidden = false;
          planFormError.textContent = 'Konnte nicht gespeichert werden. Bitte erneut versuchen.';
        } finally {
          btn.disabled = false;
        }
      });
    }

    // ---- Wochen-Editor: Phase + Workout-Zuordnung je Woche (lokal gesammelt, erst bei "Speichern" geschrieben) ----
    function renderWocheChips(entries) {
      if (!entries.length) return '<span style="font-size:12.5px;opacity:0.5">Noch kein Workout zugeordnet.</span>';
      return entries.map(e => {
        const wd = WOCHENTAGE.find(w2 => w2.n === e.wochentag);
        return `<span class="tag tag-neutral" style="font-size:12px;display:inline-flex;gap:6px;align-items:center">${wd ? wd.short : ''}: ${escapeHtml(e.workout_name || '–')}<button type="button" data-woche-chip-remove data-cid="${e._cid}" style="cursor:pointer;background:transparent;border:0;opacity:0.6;font:inherit;padding:0">✕</button></span>`;
      }).join(' ');
    }
    function renderWochenEditorList(plan) {
      const weeks = [];
      for (let w = 1; w <= plan.wochen_anzahl; w++) weeks.push(w);
      planWochenList.innerHTML = weeks.map(w => {
        const entries = planEintraegeStaged.filter(e => e.woche_nr === w);
        const phase = entries.length ? (entries[0].phase || '') : '';
        const range = planWocheRange(plan, w);
        return `<div data-woche-row data-nr="${w}" style="background:#ffffff;border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:14px 16px">
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
            <strong style="font-size:15px">Woche ${w}</strong>
            <span style="font-size:12.5px;opacity:0.6">${fmtDateShort(range.start)} – ${fmtDateShort(range.end)}</span>
          </div>
          <div class="field" style="margin:10px 0 8px"><label style="font-size:12px">Phase</label><input class="input" list="phaseOptions" data-woche-phase value="${escapeHtml(phase)}" maxlength="60" placeholder="z.B. Grundlage"></div>
          <div data-woche-chips style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">${renderWocheChips(entries)}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
            <div style="display:flex;gap:6px;flex-wrap:wrap" data-woche-day-pills>${WOCHENTAGE.map(wd => `<button type="button" class="wd-pill" data-day="${wd.n}">${wd.short}</button>`).join('')}</div>
            <select class="input" style="flex:1;min-width:160px" data-woche-workout-select>${workouts.map(wo => `<option value="${wo.id}">${escapeHtml(wo.name)}</option>`).join('')}</select>
            <button type="button" data-woche-add style="cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:9px 16px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text);white-space:nowrap">+ Hinzufügen</button>
          </div>
        </div>`;
      }).join('');

      planWochenList.querySelectorAll('[data-woche-row]').forEach(row => {
        const w = Number(row.dataset.nr);
        row.querySelectorAll('[data-woche-day-pills] .wd-pill').forEach(btn => {
          btn.addEventListener('click', () => {
            row.querySelectorAll('[data-woche-day-pills] .wd-pill').forEach(b => { b.dataset.active = String(b === btn && b.dataset.active !== 'true'); });
          });
        });
        row.querySelector('[data-woche-add]').addEventListener('click', () => {
          if (!workouts.length) { alert('Bitte zuerst ein Workout anlegen.'); return; }
          const dayBtn = row.querySelector('[data-woche-day-pills] .wd-pill[data-active="true"]');
          if (!dayBtn) { alert('Bitte einen Wochentag auswählen.'); return; }
          const select = row.querySelector('[data-woche-workout-select]');
          const workoutId = select.value;
          const workout = workoutById(workoutId);
          if (!workout) return;
          const phaseVal = row.querySelector('[data-woche-phase]').value.trim();
          planEintraegeStaged.push({ _cid: planEintraegeStagedCounter++, woche_nr: w, wochentag: Number(dayBtn.dataset.day), workout_id: workoutId, workout_name: workout.name, phase: phaseVal || null });
          renderWochenEditorList(plan);
        });
        row.querySelectorAll('[data-woche-chip-remove]').forEach(btn => {
          btn.addEventListener('click', () => {
            const cid = Number(btn.dataset.cid);
            planEintraegeStaged = planEintraegeStaged.filter(e => e._cid !== cid);
            renderWochenEditorList(plan);
          });
        });
      });
    }
    function openWochenEditor(plan) {
      editingPlanWochen = plan;
      planEintraegeStaged = trainingsplanEintraege
        .filter(e => e.plan_id === plan.id)
        .map(e => ({ _cid: planEintraegeStagedCounter++, woche_nr: e.woche_nr, wochentag: e.wochentag, workout_id: e.workout_id, workout_name: e.workout_name, phase: e.phase }));
      planWochenEditorTitle.textContent = 'Wochen bearbeiten — ' + plan.name;
      renderWochenEditorList(plan);
      planWochenEditorBox.hidden = false;
      planWochenEditorBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (planWochenEditorClose) {
      planWochenEditorClose.addEventListener('click', async () => {
        if (!editingPlanWochen) { planWochenEditorBox.hidden = true; return; }
        const plan = editingPlanWochen;
        // Phase-Eingaben können sich geändert haben, ohne dass neu hinzugefügt wurde -> auf alle Einträge der jeweiligen Woche übertragen
        planWochenList.querySelectorAll('[data-woche-row]').forEach(row => {
          const w = Number(row.dataset.nr);
          const phaseVal = row.querySelector('[data-woche-phase]').value.trim() || null;
          planEintraegeStaged.filter(e => e.woche_nr === w).forEach(e => { e.phase = phaseVal; });
        });
        planWochenEditorClose.disabled = true;
        try {
          const { error: delErr } = await client.from('trainingsplan_eintraege').delete().eq('plan_id', plan.id);
          if (delErr) throw delErr;
          let inserted = [];
          if (planEintraegeStaged.length) {
            const rows = planEintraegeStaged.map(e => ({ user_id: userId, plan_id: plan.id, woche_nr: e.woche_nr, wochentag: e.wochentag, workout_id: e.workout_id, workout_name: e.workout_name, phase: e.phase }));
            const { data, error: insErr } = await client.from('trainingsplan_eintraege').insert(rows).select();
            if (insErr) throw insErr;
            inserted = data || [];
          }
          trainingsplanEintraege = trainingsplanEintraege.filter(e => e.plan_id !== plan.id).concat(inserted);
          planWochenEditorBox.hidden = true;
          editingPlanWochen = null;
          renderPlanList();
          renderPlanWocheBanner();
          renderWochenplan();
        } catch (e) {
          alert('Konnte nicht gespeichert werden. Bitte erneut versuchen.');
        } finally {
          planWochenEditorClose.disabled = false;
        }
      });
    }

    // ---- Plan-Übersicht ----
    function renderPlanList() {
      const list = document.getElementById('planList');
      if (!list) return;
      list.innerHTML = trainingsplaene.length ? trainingsplaene.map(p => {
        const range0 = planWocheRange(p, 1);
        const rangeN = planWocheRange(p, p.wochen_anzahl);
        const currentWeek = currentWeekNrForPlan(p);
        const weeksHtml = [];
        for (let w = 1; w <= p.wochen_anzahl; w++) {
          const entries = trainingsplanEintraege.filter(e => e.plan_id === p.id && e.woche_nr === w);
          const phase = entries.length ? entries[0].phase : null;
          const chips = entries.length ? entries.map(e => {
            const wd = WOCHENTAGE.find(x => x.n === e.wochentag);
            const done = isEintragErledigt(e, p);
            return `<span style="font-size:11.5px;${done ? 'color:var(--color-accent-2-700);font-weight:600' : 'opacity:0.65'}">${wd ? wd.short : ''}: ${escapeHtml(e.workout_name || '–')} ${done ? '✓' : '…'}</span>`;
          }).join(' · ') : '<span style="font-size:12px;opacity:0.45">–</span>';
          weeksHtml.push(`<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:6px 10px;border-radius:8px;${w === currentWeek ? 'background:var(--color-accent-100)' : ''}">
            <strong style="font-size:13px;min-width:70px">Woche ${w}${w === currentWeek ? ' (jetzt)' : ''}</strong>
            <span style="font-size:12px;opacity:0.6;min-width:90px">${phase ? escapeHtml(phase) : '–'}</span>
            <span style="display:flex;gap:8px;flex-wrap:wrap">${chips}</span>
          </div>`);
        }
        return `<div data-plan data-id="${p.id}" style="background:var(--color-surface);border-radius:var(--radius-md);padding:16px 18px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:10px">
            <div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-size:16.5px;font-weight:600">${escapeHtml(p.name)}</span>
                ${p.zyklus ? '<span class="tag tag-neutral" style="font-size:11px">' + escapeHtml(p.zyklus) + '</span>' : ''}
                ${p.aktiv ? '<span class="tag tag-neutral" style="font-size:11px;color:var(--color-accent-2-700);font-weight:600">Aktiv</span>' : ''}
              </div>
              <div style="font-size:12.5px;opacity:0.6;margin-top:3px">${fmtDateShort(range0.start)} – ${fmtDateShort(rangeN.end)} · ${p.wochen_anzahl} Wochen</div>
              ${p.notiz ? '<p style="margin:6px 0 0;font-size:13.5px;opacity:0.8">' + escapeHtml(p.notiz) + '</p>' : ''}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" data-plan-aktiv style="cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">${p.aktiv ? 'Deaktivieren' : 'Aktivieren'}</button>
              <button type="button" data-plan-wochen style="cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">Wochen bearbeiten</button>
              <button type="button" data-plan-edit style="cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;padding:7px 13px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">Bearbeiten</button>
              <button type="button" data-plan-delete aria-label="Löschen" style="cursor:pointer;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:2px">${weeksHtml.join('')}</div>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch kein Trainingsplan angelegt.</p>';

      list.querySelectorAll('[data-plan]').forEach(row => {
        const id = row.dataset.id;
        const plan = trainingsplaene.find(p => p.id === id);
        row.querySelector('[data-plan-aktiv]').addEventListener('click', async () => {
          const makeActive = !plan.aktiv;
          try {
            if (makeActive) {
              const othersActive = trainingsplaene.filter(pl => pl.aktiv && pl.id !== plan.id);
              if (othersActive.length) {
                const { error } = await client.from('trainingsplaene').update({ aktiv: false }).eq('user_id', userId).eq('aktiv', true);
                if (error) throw error;
                othersActive.forEach(pl => { pl.aktiv = false; });
              }
              const { error } = await client.from('trainingsplaene').update({ aktiv: true }).eq('id', plan.id);
              if (error) throw error;
              plan.aktiv = true;
            } else {
              const { error } = await client.from('trainingsplaene').update({ aktiv: false }).eq('id', plan.id);
              if (error) throw error;
              plan.aktiv = false;
            }
            renderPlanList();
            renderPlanWocheBanner();
            renderWochenplan();
          } catch (e) { alert('Konnte nicht gespeichert werden.'); }
        });
        row.querySelector('[data-plan-wochen]').addEventListener('click', () => openWochenEditor(plan));
        row.querySelector('[data-plan-edit]').addEventListener('click', () => openPlanForm(plan));
        row.querySelector('[data-plan-delete]').addEventListener('click', async () => {
          if (!confirm('Plan „' + plan.name + '" wirklich löschen? Alle zugeordneten Wochen werden mitgelöscht.')) return;
          try {
            const { error } = await client.from('trainingsplaene').delete().eq('id', plan.id);
            if (error) throw error;
            trainingsplaene = trainingsplaene.filter(p => p.id !== plan.id);
            trainingsplanEintraege = trainingsplanEintraege.filter(e => e.plan_id !== plan.id);
            renderPlanList();
            renderPlanWocheBanner();
            renderWochenplan();
          } catch (e) { alert('Konnte nicht gelöscht werden.'); }
        });
      });
      renderPlanExportSelect();
    }
    renderPlanList();

    // ---- "Diese Woche im Plan"-Banner (Logbuch-Tab) ----
    function renderPlanWocheBanner() {
      const el = document.getElementById('planWocheBanner');
      if (!el) return;
      const plan = trainingsplaene.find(p => p.aktiv);
      const wn = plan ? currentWeekNrForPlan(plan) : null;
      if (!plan || !wn) { el.hidden = true; return; }
      const entries = trainingsplanEintraege.filter(e => e.plan_id === plan.id && e.woche_nr === wn);
      const phase = entries.length ? entries[0].phase : null;
      const done = entries.filter(e => isEintragErledigt(e, plan)).length;
      el.hidden = false;
      el.innerHTML = `<strong style="font-size:15.5px">${escapeHtml(plan.name)}${phase ? ' · ' + escapeHtml(phase) : ''}</strong>
        <span style="font-size:13.5px;opacity:0.7;margin-left:10px">Woche ${wn} von ${plan.wochen_anzahl}${entries.length ? ' · ' + done + ' von ' + entries.length + ' Workouts erledigt' : ''}</span>`;
    }
    renderPlanWocheBanner();
    renderWochenplan();

    // ---- Trainingsplan exportieren (Auswahl unten im Plan-Tab) ----
    function renderPlanExportSelect() {
      const select = document.getElementById('planExportSelect');
      const controls = document.getElementById('planExportControls');
      const hint = document.getElementById('planExportHint');
      if (!select) return;
      if (!trainingsplaene.length) {
        if (controls) controls.hidden = true;
        if (hint) hint.textContent = 'Noch kein Trainingsplan angelegt. Lege oben einen Plan an, um ihn hier exportieren zu können.';
        return;
      }
      if (controls) controls.hidden = false;
      if (hint) hint.textContent = 'Erstellt ein professionelles PDF-Dokument mit Zyklus-Übersicht und Wochenplan im BETAMOVE-Design — zum Teilen, z.B. mit Kund*innen.';
      const prevValue = select.value;
      select.innerHTML = trainingsplaene.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}${p.aktiv ? ' (Aktiv)' : ''}</option>`
      ).join('');
      const stillExists = trainingsplaene.some(p => p.id === prevValue);
      if (stillExists) select.value = prevValue;
      else {
        const aktiv = trainingsplaene.find(p => p.aktiv);
        select.value = aktiv ? aktiv.id : trainingsplaene[0].id;
      }
    }

    const planExportBtn = document.getElementById('planExportBtn');
    if (planExportBtn) {
      planExportBtn.addEventListener('click', async () => {
        const select = document.getElementById('planExportSelect');
        const plan = trainingsplaene.find(p => p.id === (select && select.value));
        if (!plan) return;
        planExportBtn.disabled = true;
        const original = planExportBtn.textContent;
        planExportBtn.textContent = 'Erstelle PDF…';
        try {
          await generatePlanPdf(plan);
        } catch (e) {
          alert('PDF konnte nicht erstellt werden. Bitte erneut versuchen.');
        } finally {
          planExportBtn.disabled = false;
          planExportBtn.textContent = original;
        }
      });
    }

    // ---- PDF-Export eines Trainingsplans: professionelles Dokument mit Logo,
    // Zyklus-Übersicht (Belastung/Entlastung) und Wochenplan im Detail ----
    let logoDataUrlPromise = null;
    function loadLogoDataUrl() {
      if (!logoDataUrlPromise) {
        logoDataUrlPromise = fetch('assets-min/logo.png')
          .then(res => res.blob())
          .then(blob => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }))
          .catch(() => null);
      }
      return logoDataUrlPromise;
    }

    async function generatePlanPdf(plan) {
      if (!window.jspdf || !window.jspdf.jsPDF) { alert('PDF-Bibliothek konnte nicht geladen werden. Bitte Seite neu laden.'); return; }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const marginX = 18;
      const pageWidth = 210;
      const pageHeight = 297;
      const brand = [17, 74, 122];
      const warnColor = [168, 93, 73];
      const logoDataUrl = await loadLogoDataUrl();

      function addHeaderBand() {
        doc.setFillColor(brand[0], brand[1], brand[2]);
        doc.rect(0, 0, pageWidth, 30, 'F');
        const textX = marginX + (logoDataUrl ? 27 : 0);
        if (logoDataUrl) {
          try { doc.addImage(logoDataUrl, 'PNG', marginX, 4, 22, 22); } catch (e) {}
        }
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text('BETAMOVE', textX, 13);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text('Trainingsplan', textX, 19);
      }

      function addFooter(pageNr, pageCount) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(140);
        doc.text('BETAMOVE · betamove.de', marginX, pageHeight - 10);
        doc.text('Seite ' + pageNr + ' / ' + pageCount, pageWidth - marginX, pageHeight - 10, { align: 'right' });
      }

      let y = 42;
      function ensureSpace(next) {
        if (y + next > pageHeight - 18) { doc.addPage(); addHeaderBand(); y = 42; }
      }

      addHeaderBand();

      doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
      doc.text(plan.name, marginX, y); y += 9;

      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90);
      const range0 = planWocheRange(plan, 1);
      const rangeN = planWocheRange(plan, plan.wochen_anzahl);
      const metaLine = [plan.zyklus, fmtDateShort(range0.start) + ' – ' + fmtDateShort(rangeN.end), plan.wochen_anzahl + ' Wochen', (plan.mikrozyklus_wochen || 4) + '-Wochen-Mikrozyklus'].filter(Boolean).join(' · ');
      doc.text(metaLine, marginX, y); y += 7;
      if (plan.notiz) {
        const lines = doc.splitTextToSize(plan.notiz, pageWidth - marginX * 2);
        doc.setFontSize(10);
        doc.text(lines, marginX, y);
        y += lines.length * 5 + 3;
      }
      doc.setDrawColor(brand[0], brand[1], brand[2]); doc.setLineWidth(0.6);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 10;

      // Zyklus auf einen Blick
      const zyklusWochen = wochenFuerPlan(plan);
      const zyklusBlocks = blocksFuer(zyklusWochen, plan.mikrozyklus_wochen || 4);

      ensureSpace(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(brand[0], brand[1], brand[2]);
      doc.text('Zyklus auf einen Blick', marginX, y); y += 7;

      let vorherPensum = null;
      zyklusBlocks.forEach((blk, bi) => {
        ensureSpace(8);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(60);
        doc.text('Block ' + (bi + 1) + ' · Woche ' + blk[0].nr + '–' + blk[blk.length - 1].nr, marginX, y); y += 6;
        blk.forEach(w => {
          ensureSpace(6);
          const ent = istEntlastungPhase(w.phase);
          let hinweis;
          if (vorherPensum == null) hinweis = 'Basis';
          else if (!vorherPensum) hinweis = '–';
          else {
            const delta = Math.round(((w.pensum - vorherPensum) / vorherPensum) * 100);
            hinweis = (delta >= 0 ? '+' : '') + delta + '% Pensum ggü. Vorwoche';
          }
          doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
          if (ent) doc.setTextColor(warnColor[0], warnColor[1], warnColor[2]);
          else doc.setTextColor(30, 30, 30);
          const kategorie = ent ? 'Entlastung' : 'Belastung';
          const zeigePhase = w.phase && w.phase.trim().toLowerCase() !== kategorie.toLowerCase();
          const label = 'Woche ' + w.nr + ' — ' + kategorie + (zeigePhase ? ' (' + w.phase + ')' : '') + ' — ' + hinweis;
          doc.text(label, marginX + 4, y); y += 5.5;
          vorherPensum = w.pensum;
        });
        y += 2;
      });

      y += 4;
      ensureSpace(4);
      doc.setDrawColor(210); doc.setLineWidth(0.3);
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 10;

      // Wochenplan im Detail
      ensureSpace(10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(brand[0], brand[1], brand[2]);
      doc.text('Wochenplan im Detail', marginX, y); y += 8;

      for (let w = 1; w <= plan.wochen_anzahl; w++) {
        const entries = trainingsplanEintraege.filter(e => e.plan_id === plan.id && e.woche_nr === w);
        const phase = entries.length ? entries[0].phase : null;
        const wr = planWocheRange(plan, w);
        ensureSpace(14);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(20);
        doc.text('Woche ' + w + (phase ? ' — ' + phase : ''), marginX, y); y += 5.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(120);
        doc.text(fmtDateShort(wr.start) + ' – ' + fmtDateShort(wr.end), marginX, y); y += 6;
        doc.setFontSize(10.5); doc.setTextColor(30);
        if (!entries.length) {
          doc.text('Keine Workouts zugeordnet.', marginX + 4, y); y += 7;
        } else {
          entries.slice().sort((a, b) => a.wochentag - b.wochentag).forEach(e => {
            const wd = WOCHENTAGE.find(x => x.n === e.wochentag);
            ensureSpace(6);
            doc.text('• ' + (wd ? wd.label : '') + ': ' + (e.workout_name || '–'), marginX + 4, y); y += 6;
          });
        }
        y += 4;
      }

      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        addFooter(i, pageCount);
      }

      doc.save((plan.name || 'trainingsplan').replace(/[^a-z0-9äöüß_-]+/gi, '_') + '.pdf');
    }

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
      const vorlagenBox = document.getElementById('uebungVorlagenBox');
      if (vorlagenBox) vorlagenBox.hidden = !!uebung;
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

    // ---- Übungs-Vorlagen: füllen das Anlegen-Formular vor, Rest bleibt wie beim manuellen Anlegen ----
    function applyUebungTemplate(tpl) {
      openUebungForm(null);
      document.getElementById('uebung-name').value = tpl.name;
      document.getElementById('uebung-einheit').value = tpl.einheit || '';
      document.getElementById('uebung-wiederholungen').value = tpl.wiederholungen || '';
      document.getElementById('uebung-saetze').value = tpl.saetze || '';
      document.getElementById('uebung-notiz').value = tpl.notiz || '';
      if (tpl.timer_pause_sekunden) document.getElementById('uebung-timer-pause').value = tpl.timer_pause_sekunden;
      uebungSpezifikationen = (tpl.spezifikationen || []).slice();
      renderSpezList();
      setActiveArt(tpl.art);
      setActiveMaske(tpl.typ || 'klassisch');
      setActiveTrainingsart(tpl.trainingsart || null);
      setActiveTimer(tpl.timer_modus || 'keiner');
      uebungFormBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function renderUebungVorlagen() {
      function cardsHtml(list) {
        return list.map((tpl, i) => {
          const sub = [tpl.art, TRAININGSART_LABEL[tpl.trainingsart] || null].filter(Boolean).join(' · ');
          return `<button type="button" class="tpl-card" data-tpl-idx="${i}" title="${escapeHtml(tpl.notiz || '')}"><strong>${escapeHtml(tpl.name)}</strong><span>${escapeHtml(sub)}</span></button>`;
        }).join('');
      }
      const kraftEl = document.getElementById('uebungVorlagenKraft');
      if (kraftEl) {
        kraftEl.innerHTML = cardsHtml(UEBUNG_VORLAGEN_KRAFT);
        kraftEl.querySelectorAll('[data-tpl-idx]').forEach(btn => btn.addEventListener('click', () => applyUebungTemplate(UEBUNG_VORLAGEN_KRAFT[Number(btn.dataset.tplIdx)])));
      }
      const praevEl = document.getElementById('uebungVorlagenPraevention');
      if (praevEl) {
        praevEl.innerHTML = cardsHtml(UEBUNG_VORLAGEN_PRAEVENTION);
        praevEl.querySelectorAll('[data-tpl-idx]').forEach(btn => btn.addEventListener('click', () => applyUebungTemplate(UEBUNG_VORLAGEN_PRAEVENTION[Number(btn.dataset.tplIdx)])));
      }
      const eigenSection = document.getElementById('uebungVorlagenEigenSection');
      const eigenEl = document.getElementById('uebungVorlagenEigen');
      if (eigenSection && eigenEl) {
        eigenSection.hidden = !eigeneVorlagen.length;
        eigenEl.innerHTML = eigeneVorlagen.map((tpl, i) => {
          const sub = [tpl.art, TRAININGSART_LABEL[tpl.trainingsart] || null].filter(Boolean).join(' · ');
          return `<div class="tpl-card" data-tpl-idx="${i}" style="padding-right:26px" title="${escapeHtml(tpl.notiz || '')}">
            <strong>${escapeHtml(tpl.name)}</strong><span>${escapeHtml(sub)}</span>
            <button type="button" class="tpl-card-remove" data-tpl-remove aria-label="Vorlage entfernen">✕</button>
          </div>`;
        }).join('');
        eigenEl.querySelectorAll('.tpl-card').forEach(card => {
          const idx = Number(card.dataset.tplIdx);
          card.addEventListener('click', (e) => {
            if (e.target.closest('[data-tpl-remove]')) return;
            applyUebungTemplate(eigeneVorlagen[idx]);
          });
          card.querySelector('[data-tpl-remove]').addEventListener('click', async (e) => {
            e.stopPropagation();
            const tpl = eigeneVorlagen[idx];
            try {
              const { error } = await client.from('trainingsuebung_vorlagen').delete().eq('id', tpl.id);
              if (error) throw error;
              eigeneVorlagen = eigeneVorlagen.filter(v => v.id !== tpl.id);
              renderUebungVorlagen();
            } catch (err) { alert('Konnte nicht entfernt werden.'); }
          });
        });
      }
    }
    renderUebungVorlagen();

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
          <div style="display:flex;gap:8px;flex:none;flex-wrap:wrap;max-width:100%">
            <button type="button" data-uebung-vorlage-speichern style="cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">+ Vorlage</button>
            <button type="button" data-uebung-edit style="cursor:pointer;font:inherit;font-size:13px;font-weight:600;padding:7px 14px;border-radius:999px;border:2px solid var(--color-divider);background:transparent;color:var(--color-text)">Bearbeiten</button>
            <button type="button" data-uebung-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
          </div>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine eigene Übung angelegt.</p>';
      list.querySelectorAll('[data-uebung]').forEach(row => {
        const id = row.dataset.id;
        const uebung = uebungById(id);
        row.querySelector('[data-uebung-edit]').addEventListener('click', () => openUebungForm(uebung));
        row.querySelector('[data-uebung-vorlage-speichern]').addEventListener('click', async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const payload = {
              user_id: userId,
              name: uebung.name,
              art: uebung.art || null,
              typ: uebung.typ,
              trainingsart: uebung.trainingsart || null,
              einheit: uebung.einheit || null,
              wiederholungen: uebung.wiederholungen || null,
              saetze: uebung.saetze || null,
              spezifikationen: uebung.spezifikationen || [],
              geraet: uebung.geraet || null,
              grad_system: uebung.grad_system || null,
              timer_modus: uebung.timer_modus || 'keiner',
              timer_pause_sekunden: uebung.timer_pause_sekunden || null,
              notiz: uebung.notiz || null
            };
            const { data, error } = await client.from('trainingsuebung_vorlagen').insert(payload).select().single();
            if (error) throw error;
            eigeneVorlagen.push(data);
            renderUebungVorlagen();
            btn.textContent = '✓ Gespeichert';
            setTimeout(() => { btn.textContent = '+ Vorlage'; btn.disabled = false; }, 1800);
          } catch (e) {
            alert('Konnte nicht als Vorlage gespeichert werden.');
            btn.disabled = false;
          }
        });
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

    // ---- Grad-Pyramide / Send-Rate (aus bestehenden routen_versuche) ----
    function routenAttempts() {
      const out = [];
      log.forEach(l => {
        if (!Array.isArray(l.routen_versuche)) return;
        const uebung = l.uebung_id ? uebungById(l.uebung_id) : null;
        const system = (uebung && uebung.grad_system) || 'fontainebleau';
        l.routen_versuche.forEach(r => out.push({ grad: r.grad, system, getoppt: !!r.getoppt, datum: l.datum }));
      });
      return out;
    }

    function renderGradPyramide() {
      const box = document.getElementById('gradAuswertungBox');
      const pyramideEl = document.getElementById('gradPyramide');
      const sendRateEl = document.getElementById('sendRateChart');
      if (!box) return;
      const attempts = routenAttempts();
      box.hidden = !attempts.length;
      if (!attempts.length) return;

      if (pyramideEl) {
        const bySystem = {};
        attempts.forEach(a => {
          bySystem[a.system] = bySystem[a.system] || {};
          bySystem[a.system][a.grad] = bySystem[a.system][a.grad] || { gesamt: 0, getoppt: 0 };
          bySystem[a.system][a.grad].gesamt += 1;
          if (a.getoppt) bySystem[a.system][a.grad].getoppt += 1;
        });
        pyramideEl.innerHTML = Object.keys(bySystem).map(system => {
          const grade = (GRAD_LISTEN[system] || GRAD_LISTEN.fontainebleau).filter(g => bySystem[system][g]);
          const maxGetoppt = Math.max(1, ...grade.map(g => bySystem[system][g].getoppt));
          const rows = grade.slice().reverse().map(g => {
            const d = bySystem[system][g];
            return `<div style="display:flex;align-items:center;gap:10px">
              <span style="width:52px;flex:none;font-size:13px;font-weight:600;text-align:right">${escapeHtml(g)}</span>
              <div style="flex:1;background:var(--color-surface);border-radius:999px;height:16px;overflow:hidden"><div style="height:100%;width:${Math.round((d.getoppt / maxGetoppt) * 100)}%;background:var(--color-accent-2-500);border-radius:999px"></div></div>
              <span style="width:70px;flex:none;font-size:12.5px;opacity:0.65">${d.getoppt} / ${d.gesamt}</span>
            </div>`;
          }).join('');
          return `<div><p style="margin:0 0 8px;font-size:12.5px;font-weight:600;opacity:0.6;text-transform:uppercase;letter-spacing:0.04em">${system === 'uiaa' ? 'UIAA' : 'Fontainebleau'}</p>${rows}</div>`;
        }).join('');
      }

      if (sendRateEl) {
        const thisMonday = startOfWeek();
        const weeks = [];
        for (let i = 7; i >= 0; i--) {
          const monday = new Date(thisMonday);
          monday.setDate(monday.getDate() - i * 7);
          const nextMonday = new Date(monday);
          nextMonday.setDate(nextMonday.getDate() + 7);
          const weekAttempts = attempts.filter(a => {
            if (!a.datum) return false;
            const d = new Date(a.datum + 'T00:00:00');
            return d >= monday && d < nextMonday;
          });
          const rate = weekAttempts.length ? Math.round((weekAttempts.filter(a => a.getoppt).length / weekAttempts.length) * 100) : null;
          weeks.push({ label: monday.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), rate });
        }
        sendRateEl.innerHTML = weeks.map(w => `
          <div style="display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0">
            <div style="font-size:12px;opacity:0.7">${w.rate != null ? w.rate + '%' : '–'}</div>
            <div style="width:100%;height:90px;display:flex;align-items:flex-end">
              <div style="width:100%;height:${w.rate != null ? w.rate : 0}%;min-height:${w.rate ? 4 : 0}px;background:var(--color-accent-2-500);border-radius:4px 4px 0 0"></div>
            </div>
            <div style="font-size:10.5px;opacity:0.55;white-space:nowrap">${w.label}</div>
          </div>`).join('');
      }
    }

    // ---- Logbuch: nach Trainingseinheit gruppiert, einklappbar ----
    // Trainingseinheiten von heute starten aufgeklappt, damit frisch geloggtes
    // Training nach einem Neuladen der Seite nicht wie verschwunden wirkt.
    const heutigesDatum = new Date().toISOString().slice(0, 10);
    let expandedEinheiten = new Set(einheiten.filter(e => e.datum === heutigesDatum).map(e => e.id));

    function logEntryHtml(l) {
      const uebung = l.uebung_id ? uebungById(l.uebung_id) : null;
      const art = uebung ? uebung.name : (TYP_LABEL[l.typ] || l.typ);
      const ergebnisPct = uebung && isKgEinheit(uebung.einheit) && l.ergebnis_wert != null ? prozentKG(l.ergebnis_wert) : null;
      const ergebnis = uebung && l.ergebnis_wert != null ? l.ergebnis_wert + (uebung.einheit ? ' ' + uebung.einheit : '') + (ergebnisPct != null ? ' (' + ergebnisPct + ' % KG)' : '') : null;
      const zeitInfo = l.aktive_zeit_sekunden ? 'Aktivzeit ' + fmtMMSS(l.aktive_zeit_sekunden) : (l.pausen_anzahl ? l.pausen_anzahl + ' Pausen' : null);
      const meta = [ergebnis, zeitInfo, l.dauer_minuten ? l.dauer_minuten + ' Min.' : null, l.anstrengung ? 'RPE ' + l.anstrengung : null].filter(Boolean).join(' · ');
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
            ${s.ergebnis_wert != null ? '<span>' + s.ergebnis_wert + (uebung && uebung.einheit ? ' ' + escapeHtml(uebung.einheit) : '') + (uebung && isKgEinheit(uebung.einheit) && prozentKG(s.ergebnis_wert) != null ? ' (' + prozentKG(s.ergebnis_wert) + ' % KG)' : '') + '</span>' : ''}
            ${s.spezifikation ? '<span style="opacity:0.65">' + escapeHtml(s.spezifikation) + '</span>' : ''}
            ${s.rpe != null ? '<span style="opacity:0.65">RPE ' + s.rpe + '</span>' : ''}
          </div>`).join('')}
        </div>` : '';
      return `<div data-log data-id="${l.id}" style="display:flex;gap:14px;align-items:flex-start;background:#ffffff;border:1px solid var(--color-divider);border-radius:var(--radius-md);padding:12px 14px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14.5px;font-weight:600">${escapeHtml(art)}</div>
          <div style="font-size:13px;opacity:0.65;margin-top:2px">${escapeHtml(meta)}</div>
          ${routen}
          ${saetze}
          ${l.notiz ? '<p style="margin:6px 0 0;font-size:14px;opacity:0.85">' + escapeHtml(l.notiz) + '</p>' : ''}
        </div>
        <button type="button" data-log-delete aria-label="Löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:2px 4px">✕</button>
      </div>`;
    }

    function renderLogbuch() {
      const list = document.getElementById('logList');
      if (!list) return;

      const logByEinheit = new Map();
      log.forEach(l => {
        const key = l.einheit_id || 'ohne';
        if (!logByEinheit.has(key)) logByEinheit.set(key, []);
        logByEinheit.get(key).push(l);
      });

      const einheitIds = new Set(einheiten.map(e => e.id));
      const groups = einheiten.map(e => ({ einheit: e, entries: logByEinheit.get(e.id) || [], loeschbar: true }));
      [...logByEinheit.keys()].filter(k => k !== 'ohne' && !einheitIds.has(k)).forEach(id => {
        const entries = logByEinheit.get(id);
        groups.push({ einheit: { id, workout_name: 'Gelöschtes Workout', datum: entries[0].datum, dauer_sekunden: null }, entries, loeschbar: false });
      });
      if (logByEinheit.has('ohne')) {
        groups.push({ einheit: { id: 'ohne', workout_name: 'Ohne Trainingseinheit', datum: null, dauer_sekunden: null }, entries: logByEinheit.get('ohne'), loeschbar: false });
      }

      list.innerHTML = groups.length ? groups.map(({ einheit: e, entries, loeschbar }) => {
        const date = e.datum ? new Date(e.datum + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const isOpen = expandedEinheiten.has(e.id);
        const metaParts = [date, e.dauer_sekunden ? fmtMMSS(e.dauer_sekunden) + ' Min:Sek' : null, entries.length ? entries.length + ' Übung' + (entries.length > 1 ? 'en' : '') : 'Keine Übung erfasst'].filter(Boolean);
        return `<div data-einheit-group data-id="${e.id}" style="background:var(--color-surface);border-radius:var(--radius-md);overflow:hidden">
          <div style="display:flex;align-items:center;gap:6px;padding:6px 8px 6px 16px">
            <button type="button" data-group-toggle style="flex:1;min-width:0;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;background:transparent;border:0;font:inherit;text-align:left;padding:8px 0">
              <div style="min-width:0">
                <div style="font-size:15.5px;font-weight:600">${escapeHtml(e.workout_name || 'Freies Training')}</div>
                <div style="font-size:13.5px;opacity:0.65;margin-top:3px">${escapeHtml(metaParts.join(' · '))}</div>
              </div>
              <span aria-hidden="true" style="flex:none;font-size:13px;opacity:0.5;transform:${isOpen ? 'rotate(180deg)' : 'none'};transition:transform .15s">▾</span>
            </button>
            ${loeschbar ? '<button type="button" data-einheit-delete aria-label="Trainingseinheit löschen" style="cursor:pointer;flex:none;font:inherit;font-size:13px;opacity:0.5;background:transparent;border:0;padding:8px 10px">✕</button>' : ''}
          </div>
          <div data-group-body ${isOpen ? '' : 'hidden'} style="padding:0 16px 14px;display:flex;flex-direction:column;gap:8px">
            ${entries.length ? entries.map(l => logEntryHtml(l)).join('') : '<p style="margin:0;font-size:14px;opacity:0.6">Keine Übung in dieser Einheit erfasst.</p>'}
          </div>
        </div>`;
      }).join('') : '<p style="margin:0;font-size:15px;opacity:0.65">Noch keine Trainingseinheit abgeschlossen.</p>';

      list.querySelectorAll('[data-einheit-group]').forEach(row => {
        const id = row.dataset.id;
        const toggleBtn = row.querySelector('[data-group-toggle]');
        const body = row.querySelector('[data-group-body]');
        toggleBtn.addEventListener('click', () => {
          if (expandedEinheiten.has(id)) expandedEinheiten.delete(id); else expandedEinheiten.add(id);
          body.hidden = !expandedEinheiten.has(id);
          const caret = toggleBtn.querySelector('span');
          if (caret) caret.style.transform = expandedEinheiten.has(id) ? 'rotate(180deg)' : 'none';
        });
        const deleteBtn = row.querySelector('[data-einheit-delete]');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Trainingseinheit wirklich löschen? Die zugehörigen Logbuch-Einträge bleiben erhalten.')) return;
            try {
              const { error } = await client.from('trainingseinheiten').delete().eq('id', id);
              if (error) throw error;
              einheiten = einheiten.filter(x => x.id !== id);
              renderLogbuch();
              renderPlanList();
              renderPlanWocheBanner();
              renderWochenplan();
            } catch (err) { alert('Konnte nicht gelöscht werden.'); }
          });
        }
        row.querySelectorAll('[data-log-delete]').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const logId = btn.closest('[data-log]').dataset.id;
            if (!confirm('Eintrag wirklich löschen?')) return;
            try {
              const { error } = await client.from('trainingslog').delete().eq('id', logId);
              if (error) throw error;
              log = log.filter(l => l.id !== logId);
              renderLogbuch();
              renderWeekSummary();
              renderCharts();
              renderGradPyramide();
            } catch (err) { alert('Konnte nicht gelöscht werden.'); }
          });
        });
      });
    }

    renderLogbuch();
    renderWeekSummary();
    renderCharts();
    renderGradPyramide();

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
        const kgEinheit = isKgEinheit(uebung.einheit);
        const rows = [];
        for (let i = 1; i <= uebung.saetze; i++) {
          rows.push(`
            <div data-satz-row data-nr="${i}" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;background:var(--color-surface);border-radius:var(--radius-md);padding:10px 12px">
              <strong style="min-width:50px;font-size:13.5px">Satz ${i}</strong>
              <div class="field" style="margin:0"><label style="font-size:11px">Wdh.${uebung.wiederholungen ? ' (Ziel ' + uebung.wiederholungen + ')' : ''}</label><input type="number" min="0" max="999" class="input" data-satz-wdh style="width:80px" placeholder="${uebung.wiederholungen || ''}"></div>
              ${uebung.einheit ? `<div class="field" style="margin:0"><label style="font-size:11px">Ergebnis (${escapeHtml(uebung.einheit)})</label><input type="number" step="any" class="input" data-satz-ergebnis style="width:90px"></div>` : ''}
              ${spezOptions ? `<div class="field" style="margin:0"><label style="font-size:11px">Spezifikation</label><select class="input" data-satz-spez style="width:130px"><option value="">–</option>${spezOptions}</select></div>` : ''}
              <div class="field" style="margin:0"><label style="font-size:11px">RPE (1–10)</label><input type="number" min="1" max="10" class="input" data-satz-rpe style="width:70px"></div>
              ${kgEinheit ? `<span data-satz-kg-pct style="font-size:12px;opacity:0.6;align-self:center"></span>` : ''}
            </div>`);
        }
        bodyFields.push(`<div data-satz-liste style="display:flex;flex-direction:column;gap:8px">${rows.join('')}</div>`);
      } else {
        const info = [uebung.wiederholungen ? uebung.wiederholungen + ' Wdh.' : null, Array.isArray(uebung.spezifikationen) && uebung.spezifikationen.length ? uebung.spezifikationen.join(', ') : null].filter(Boolean).join(' · ');
        if (info) bodyFields.push(`<p style="margin:0;font-size:13.5px;opacity:0.65">${escapeHtml(info)}</p>`);
        if (uebung.einheit) {
          bodyFields.push(`<div class="field"><label>Ergebnis (${escapeHtml(uebung.einheit)})</label><input class="input" type="number" step="any" data-ex-ergebnis placeholder="z.B. 20"></div>`);
          if (isKgEinheit(uebung.einheit)) bodyFields.push(`<p data-ex-kg-pct style="margin:-6px 0 0;font-size:12.5px;opacity:0.6"></p>`);
        }
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

      // %-Körpergewicht-Hinweis live bei kg-Übungen (nur wenn Körpergewicht im Profil hinterlegt ist)
      function updateKgPct(input, out) {
        if (!out) return;
        const pct = koerpergewichtKg != null && input && input.value ? prozentKG(Number(input.value)) : null;
        out.textContent = pct != null ? ('= ' + pct + ' % Körpergewicht') : (koerpergewichtKg == null ? 'Körpergewicht im Profil eintragen, um den %-Anteil zu sehen.' : '');
      }
      const exErgebnisInput = card.querySelector('[data-ex-ergebnis]');
      const exKgPctOut = card.querySelector('[data-ex-kg-pct]');
      if (exKgPctOut) {
        updateKgPct(exErgebnisInput, exKgPctOut);
        exErgebnisInput.addEventListener('input', () => updateKgPct(exErgebnisInput, exKgPctOut));
      }
      card.querySelectorAll('[data-satz-row]').forEach(row => {
        const satzErgInput = row.querySelector('[data-satz-ergebnis]');
        const satzKgPctOut = row.querySelector('[data-satz-kg-pct]');
        if (satzKgPctOut) {
          updateKgPct(satzErgInput, satzKgPctOut);
          satzErgInput.addEventListener('input', () => updateKgPct(satzErgInput, satzKgPctOut));
        }
      });

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
          const rpeInput = row.querySelector('[data-satz-rpe]');
          return {
            nr: Number(row.dataset.nr),
            wiederholungen: wdhInput && wdhInput.value ? Number(wdhInput.value) : null,
            ergebnis_wert: ergInput && ergInput.value ? Number(ergInput.value) : null,
            spezifikation: spezSelect && spezSelect.value ? spezSelect.value : null,
            rpe: rpeInput && rpeInput.value ? Number(rpeInput.value) : null
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
          renderLogbuch();
          renderWeekSummary();
          renderCharts();
          renderGradPyramide();
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
        expandedEinheiten.add(data.id);
        renderPlanList();
        renderPlanWocheBanner();
        renderWochenplan();
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
        renderLogbuch();
        renderPlanList();
        renderPlanWocheBanner();
        renderWochenplan();
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
  // Seite: konto-psa — PSA-Prüftool Schritt 1 (eigenes Material)
  // Datenmodell: siehe supabase/schema-psa-material.sql
  //   psa_material       — ein Gegenstand (PSA oder Inventar), je Nutzer*in
  //   psa_pruefprotokoll — Prüfhistorie zu einem Gegenstand
  //   psa_ausleihe       — Verleih-Historie zu einem ausleihbaren Gegenstand
  // --------------------------------------------------------------------
  const PSA_KATEGORIEN = ['Gurt', 'Helm', 'Seil (dynamisch)', 'Seil (halbstatisch)', 'Verbindungselement / Karabiner', 'Sicherungsgerät', 'Bandschlinge / Express', 'Sonstiges'];
  const INVENTAR_KATEGORIEN = ['Chalkbag', 'Kletterschuhe', 'Theraband / Trainingsband', 'Bekleidung', 'Tasche / Rucksack', 'Sonstiges'];
  const PSA_ERGEBNIS_LABEL = { gut: 'Gut – weiter verwenden', mangel: 'Mangel festgestellt', aussondern: 'Aussondern' };

  function psaFmtDate(d) {
    if (!d) return '–';
    const dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? '–' : dt.toLocaleDateString('de-DE');
  }

  function psaStatus(material, letzePruefung) {
    if (!material.ist_psa || !material.pruefrhythmus_monate || !letzePruefung) return null;
    const next = new Date(letzePruefung + 'T00:00:00');
    next.setMonth(next.getMonth() + material.pruefrhythmus_monate);
    const days = Math.round((next - new Date()) / 86400000);
    if (days < 0) return { label: 'ÜBERFÄLLIG', bg: 'var(--color-warn-bg)', fg: 'var(--color-warn)', next };
    if (days <= 30) return { label: 'bald fällig', bg: '#f7ecd2', fg: '#8a6a1f', next };
    return { label: 'in Ordnung', bg: 'var(--color-accent-2-100)', fg: 'var(--color-accent-2-800)', next };
  }

  function itemMetaLine(it) {
    const parts = [it.kategorie];
    if (it.materialart) parts.push(it.materialart === 'textil' ? 'Textil' : it.materialart === 'metall' ? 'Metall' : 'Textil + Metall');
    if (it.hersteller) parts.push(it.hersteller);
    return parts.join(' · ');
  }

  function itemName(it) {
    return [it.hersteller, it.modellbezeichnung].filter(Boolean).join(' — ') || it.kategorie;
  }

  async function renderPsa(ctx) {
    const { client, session } = ctx;
    const userId = session.user.id;

    let items = [];
    let pruefByMaterial = {};
    let ausleiheByMaterial = {};
    let scope = 'psa';
    let openId = null;

    async function loadAll() {
      const { data: mat } = await client.from('psa_material').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      items = mat || [];
      const ids = items.map(i => i.id);
      pruefByMaterial = {};
      ausleiheByMaterial = {};
      if (ids.length) {
        const [{ data: pruef }, { data: leihe }] = await Promise.all([
          client.from('psa_pruefprotokoll').select('*').in('material_id', ids).order('pruefdatum', { ascending: false }),
          client.from('psa_ausleihe').select('*').in('material_id', ids).order('ausgegeben_am', { ascending: false })
        ]);
        (pruef || []).forEach(p => { (pruefByMaterial[p.material_id] = pruefByMaterial[p.material_id] || []).push(p); });
        (leihe || []).forEach(l => { (ausleiheByMaterial[l.material_id] = ausleiheByMaterial[l.material_id] || []).push(l); });
      }
    }

    function visibleItems() {
      if (scope === 'inaktiv') return items.filter(i => !i.aktiv);
      const aktive = items.filter(i => i.aktiv);
      if (scope === 'psa') return aktive.filter(i => i.ist_psa);
      if (scope === 'inventar') return aktive.filter(i => !i.ist_psa);
      return aktive;
    }

    function renderDetail(it) {
      const pruef = pruefByMaterial[it.id] || [];
      const letzte = pruef[0] ? pruef[0].pruefdatum : null;
      const leihe = ausleiheByMaterial[it.id] || [];
      const laufend = leihe.find(l => !l.zurueckgegeben_am);

      const stammdaten = [
        ['Seriennummer', it.seriennummer], ['Chargennummer', it.chargennummer],
        ['Herstellungsdatum', it.herstellungsdatum ? psaFmtDate(it.herstellungsdatum) : null],
        ['Kaufdatum', it.kaufdatum ? psaFmtDate(it.kaufdatum) : null],
        ['Erste Nutzung', it.erste_nutzung ? psaFmtDate(it.erste_nutzung) : null],
        ['Max. Lebensdauer', it.max_lebensdauer_jahre ? it.max_lebensdauer_jahre + ' Jahre' : null],
        ['Prüfrhythmus', it.pruefrhythmus_monate ? 'alle ' + it.pruefrhythmus_monate + ' Monate' : 'kein Rhythmus']
      ].filter(([, v]) => v);

      return `
        <div style="border-top:1px solid var(--color-divider);margin-top:14px;padding-top:16px;display:flex;flex-direction:column;gap:18px">
          <dl style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 20px;margin:0">
            ${stammdaten.map(([k, v]) => `<div><dt style="font-size:12px;opacity:0.65;margin-bottom:2px">${k}</dt><dd style="margin:0;font-size:14.5px;font-weight:600">${escapeHtml(v)}</dd></div>`).join('')}
          </dl>

          ${it.ist_psa ? `
          <div>
            <h4 style="margin:0 0 10px;font-size:15px">Prüfhistorie</h4>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px">
              ${pruef.length ? pruef.map(p => `
                <div style="background:var(--color-surface);border-radius:var(--radius-sm);padding:10px 14px;font-size:13.5px">
                  <strong>${psaFmtDate(p.pruefdatum)}</strong> · ${escapeHtml(PSA_ERGEBNIS_LABEL[p.ergebnis] || p.ergebnis)}${p.notiz ? ' — ' + escapeHtml(p.notiz) : ''}
                </div>`).join('') : '<p style="margin:0;font-size:13.5px;opacity:0.65">Noch keine Prüfung eingetragen.</p>'}
            </div>
            <form data-pruef-form="${it.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">
              <div class="field" style="min-width:160px"><label>Ergebnis</label>
                <select class="input" data-f="ergebnis" required>
                  <option value="gut">Gut – weiter verwenden</option>
                  <option value="mangel">Mangel festgestellt</option>
                  <option value="aussondern">Aussondern</option>
                </select>
              </div>
              <div class="field" style="flex:1;min-width:200px"><label>Notiz (optional)</label><input class="input" data-f="notiz" maxlength="1000"></div>
              <button type="submit" class="btn btn-secondary" style="font-size:14px;padding:11px 18px">Prüfung eintragen</button>
            </form>
          </div>` : ''}

          ${it.ausleihbar ? `
          <div>
            <h4 style="margin:0 0 10px;font-size:15px">Verleih</h4>
            ${laufend
              ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;background:#f7ecd2;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:10px">
                   <span style="font-size:13.5px">Ausgeliehen an <strong>${escapeHtml(laufend.ausgeliehen_an)}</strong> seit ${psaFmtDate(laufend.ausgegeben_am)}</span>
                   <button type="button" class="btn btn-secondary" data-ausleihe-return="${laufend.id}" style="font-size:13px;padding:8px 14px">Zurückgeben</button>
                 </div>`
              : `<form data-ausleihe-form="${it.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
                   <div class="field" style="flex:1;min-width:200px"><label>An wen?</label><input class="input" data-f="an" required maxlength="160" placeholder="Name"></div>
                   <button type="submit" class="btn btn-secondary" style="font-size:14px;padding:11px 18px">Ausleihen</button>
                 </form>`}
            <div style="display:flex;flex-direction:column;gap:6px">
              ${leihe.filter(l => l !== laufend).map(l => `
                <div style="font-size:12.5px;opacity:0.75">${escapeHtml(l.ausgeliehen_an)} · ${psaFmtDate(l.ausgegeben_am)} → ${l.zurueckgegeben_am ? psaFmtDate(l.zurueckgegeben_am) : 'offen'}</div>`).join('')}
            </div>
          </div>` : ''}

          <div>
            <button type="button" class="btn btn-secondary" data-toggle-aktiv="${it.id}" style="font-size:13px;padding:9px 16px">${it.aktiv ? 'Als inaktiv markieren (aussondern)' : 'Wieder aktivieren'}</button>
          </div>
        </div>`;
    }

    function renderList() {
      const list = visibleItems();
      const listEl = document.getElementById('psaList');
      const emptyEl = document.getElementById('psaEmpty');
      if (!listEl) return;
      emptyEl.hidden = list.length > 0;
      listEl.innerHTML = list.map(it => {
        const pruef = pruefByMaterial[it.id] || [];
        const status = psaStatus(it, pruef[0] ? pruef[0].pruefdatum : null);
        const open = openId === it.id;
        return `
        <div class="card elev-sm" style="gap:0">
          <button type="button" data-toggle-open="${it.id}" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:16px;width:100%">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:15.5px">${escapeHtml(itemName(it))}</div>
              <div style="font-size:12.5px;opacity:0.65;margin-top:2px">${escapeHtml(itemMetaLine(it))}</div>
            </div>
            ${status ? `<span class="tag" style="background:${status.bg};color:${status.fg}">${status.label}</span>` : (it.ist_psa ? '<span class="tag tag-neutral">keine Prüfung</span>' : '')}
            ${it.ausleihbar ? '<span class="tag tag-accent-2">ausleihbar</span>' : ''}
          </button>
          ${open ? renderDetail(it) : ''}
        </div>`;
      }).join('');
      wireListEvents();
    }

    function wireListEvents() {
      document.querySelectorAll('[data-toggle-open]').forEach(el => {
        el.addEventListener('click', () => { const id = el.dataset.toggleOpen; openId = openId === id ? null : id; renderList(); });
      });
      document.querySelectorAll('[data-toggle-aktiv]').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = el.dataset.toggleAktiv;
          const it = items.find(i => i.id === id);
          if (!it) return;
          await client.from('psa_material').update({ aktiv: !it.aktiv }).eq('id', id);
          await loadAll();
          renderList();
        });
      });
      document.querySelectorAll('[data-pruef-form]').forEach(form => {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const materialId = form.dataset.pruefForm;
          const ergebnis = form.querySelector('[data-f="ergebnis"]').value;
          const notiz = form.querySelector('[data-f="notiz"]').value.trim();
          await client.from('psa_pruefprotokoll').insert({ material_id: materialId, geprueft_von: userId, ergebnis, notiz: notiz || null });
          await loadAll();
          renderList();
        });
      });
      document.querySelectorAll('[data-ausleihe-form]').forEach(form => {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const materialId = form.dataset.ausleiheForm;
          const an = form.querySelector('[data-f="an"]').value.trim();
          if (!an) return;
          await client.from('psa_ausleihe').insert({ material_id: materialId, ausgeliehen_an: an });
          await loadAll();
          renderList();
        });
      });
      document.querySelectorAll('[data-ausleihe-return]').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          await client.from('psa_ausleihe').update({ zurueckgegeben_am: new Date().toISOString().slice(0, 10) }).eq('id', el.dataset.ausleiheReturn);
          await loadAll();
          renderList();
        });
      });
    }

    // Scope-Filter
    document.querySelectorAll('#psaScopeFilter [data-scope]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scope === scope);
      btn.addEventListener('click', () => {
        scope = btn.dataset.scope;
        document.querySelectorAll('#psaScopeFilter [data-scope]').forEach(b => b.classList.toggle('active', b === btn));
        renderList();
      });
    });

    // Neu-Formular
    const formBox = document.getElementById('psaFormBox');
    const newBtn = document.getElementById('psaNewBtn');
    const cancelBtn = document.getElementById('psaFormCancel');
    const errBox = document.getElementById('psaFormError');
    const fIstPsa = document.getElementById('fIstPsa');
    const fKategorie = document.getElementById('fKategorie');
    const psaOnlyGroups = ['fMaterialartGroup', 'fSeriennummerGroup', 'fChargennummerGroup', 'fHerstellungsdatumGroup', 'fKaufdatumGroup', 'fErsteNutzungGroup', 'fLebensdauerGroup'];

    function syncFormForType() {
      const isPsa = fIstPsa.checked;
      const kats = isPsa ? PSA_KATEGORIEN : INVENTAR_KATEGORIEN;
      fKategorie.innerHTML = kats.map(k => `<option>${escapeHtml(k)}</option>`).join('');
      psaOnlyGroups.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = !isPsa; });
    }
    fIstPsa.addEventListener('change', syncFormForType);
    syncFormForType();

    newBtn.addEventListener('click', () => {
      formBox.reset();
      fIstPsa.checked = true;
      syncFormForType();
      errBox.hidden = true;
      formBox.hidden = false;
      formBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    cancelBtn.addEventListener('click', () => { formBox.hidden = true; });

    formBox.addEventListener('submit', async (e) => {
      e.preventDefault();
      const kategorie = fKategorie.value;
      if (!kategorie) return;
      const payload = {
        user_id: userId,
        ist_psa: fIstPsa.checked,
        kategorie,
        ausleihbar: document.getElementById('fAusleihbar').checked,
        materialart: document.getElementById('fMaterialart').value || null,
        hersteller: document.getElementById('fHersteller').value.trim() || null,
        modellbezeichnung: document.getElementById('fModell').value.trim() || null,
        seriennummer: document.getElementById('fSeriennummer').value.trim() || null,
        chargennummer: document.getElementById('fChargennummer').value.trim() || null,
        herstellungsdatum: document.getElementById('fHerstellungsdatum').value || null,
        kaufdatum: document.getElementById('fKaufdatum').value || null,
        erste_nutzung: document.getElementById('fErsteNutzung').value || null,
        max_lebensdauer_jahre: document.getElementById('fLebensdauer').value ? Number(document.getElementById('fLebensdauer').value) : null,
        pruefrhythmus_monate: document.getElementById('fPruefrhythmus').value ? Number(document.getElementById('fPruefrhythmus').value) : null
      };
      try {
        const { error } = await client.from('psa_material').insert(payload);
        if (error) throw error;
        formBox.hidden = true;
        await loadAll();
        renderList();
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = 'Konnte nicht gespeichert werden — bitte Pflichtfelder prüfen.';
      }
    });

    await loadAll();
    renderList();
    await renderSachBoxFor(client, userId);
  }

  // --------------------------------------------------------------------
  // Sachkundige-Status/Antrag — wird auf konto-psa im #sachBox angezeigt.
  // Eigene, von admin_emails getrennte Rolle (siehe schema-psa-sachkundige.sql).
  // --------------------------------------------------------------------
  async function renderSachBoxFor(client, userId) {
    const box = document.getElementById('sachBox');
    if (!box) return;
    const { data: row } = await client.from('psa_sachkundige').select('*').eq('user_id', userId).maybeSingle();

    if (!row) {
      box.innerHTML = `
        <h3 style="margin:0;font-size:17px">Sachkundige Person werden</h3>
        <p style="margin:0;font-size:14px;opacity:0.75">Damit darfst du zusätzlich Kund*innen anlegen und deren PSA prüfen (siehe "Kundenmaterial").</p>
        <button type="button" id="sachApplyBtn" class="btn btn-secondary" style="font-size:14px;padding:10px 18px;align-self:flex-start">Antrag stellen</button>
        <form id="sachFormBox" hidden style="display:flex;flex-direction:column;gap:12px;margin-top:6px">
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
            <div class="field"><label for="sfPhone">Handynummer</label><input id="sfPhone" class="input" required></div>
            <div class="field"><label for="sfBirth">Geburtsdatum</label><input id="sfBirth" type="date" class="input" required></div>
            <div class="field" style="grid-column:1/-1"><label for="sfAddress">Adresse</label><input id="sfAddress" class="input" required></div>
            <div class="field"><label for="sfOrg">Tätig für</label><input id="sfOrg" class="input" placeholder="BETAMOVE (Standard, wenn leer)"></div>
            <div class="field"><label for="sfQual">Qualifikationsnachweis</label><input id="sfQual" class="input" placeholder="z.B. DGUV 312-906, Zert.-Nr. …" required></div>
          </div>
          <div><button type="submit" class="btn btn-primary" style="font-size:14px;padding:10px 18px">Antrag absenden</button></div>
          <div id="sachFormError" class="form-error" hidden></div>
        </form>`;
      document.getElementById('sachApplyBtn').addEventListener('click', () => {
        document.getElementById('sachFormBox').hidden = false;
        document.getElementById('sachApplyBtn').hidden = true;
      });
      document.getElementById('sachFormBox').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const { error } = await client.from('psa_sachkundige').insert({
            user_id: userId,
            handynummer: document.getElementById('sfPhone').value.trim(),
            geburtsdatum: document.getElementById('sfBirth').value,
            adresse: document.getElementById('sfAddress').value.trim(),
            organisation: document.getElementById('sfOrg').value.trim() || 'BETAMOVE',
            qualifikationsnachweis: document.getElementById('sfQual').value.trim()
          });
          if (error) throw error;
          await renderSachBoxFor(client, userId);
        } catch (err) {
          const errBox = document.getElementById('sachFormError');
          errBox.hidden = false;
          errBox.textContent = 'Antrag konnte nicht gesendet werden — bitte Pflichtfelder prüfen.';
        }
      });
      return;
    }

    if (row.status === 'offen') {
      box.innerHTML = '<p style="margin:0;font-size:14.5px"><strong>Antrag auf Sachkundige-Freischaltung eingereicht</strong> — wird von der Kursleitung geprüft.</p>';
    } else if (row.status === 'abgelehnt') {
      box.innerHTML = '<p style="margin:0;font-size:14.5px">Dein Antrag auf Sachkundige-Freischaltung wurde nicht angenommen. Bei Fragen wende dich an <a href="kontakt">die Kursleitung</a>.</p>';
    } else {
      box.innerHTML = '<p style="margin:0;font-size:14.5px"><strong>Freigeschaltete Sachkundige Person</strong>' + (row.freigeschaltet_bis ? ' — gültig bis ' + psaFmtDate(row.freigeschaltet_bis) : '') + '.</p><a href="konto-kunden" class="btn btn-secondary" style="font-size:14px;padding:10px 18px;align-self:flex-start;margin-top:8px">Zum Kundenmaterial</a>';
    }
  }

  // --------------------------------------------------------------------
  // Seite: konto-kunden — Kundenmaterial (nur freigeschaltete Sachkundige)
  // --------------------------------------------------------------------
  let kundenLogoDataUrlPromise = null;
  function loadKundenLogoDataUrl() {
    if (!kundenLogoDataUrlPromise) {
      kundenLogoDataUrlPromise = fetch('assets-min/logo.png')
        .then(res => res.blob())
        .then(blob => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }))
        .catch(() => null);
    }
    return kundenLogoDataUrlPromise;
  }

  async function generatePruefbescheinigungPdf(kunde, material, pruefListe, aussteller) {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('PDF-Bibliothek konnte nicht geladen werden. Bitte Seite neu laden.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const marginX = 18;
    const pageWidth = 210;
    const brand = [17, 74, 122];
    const istBetamove = !aussteller.organisation || aussteller.organisation.trim().toLowerCase() === 'betamove';
    const logoDataUrl = istBetamove ? await loadKundenLogoDataUrl() : null;

    doc.setFillColor(brand[0], brand[1], brand[2]);
    doc.rect(0, 0, pageWidth, 30, 'F');
    const textX = marginX + (logoDataUrl ? 27 : 0);
    if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'PNG', marginX, 4, 22, 22); } catch (e) {} }
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(istBetamove ? 'BETAMOVE' : (aussteller.organisation || ''), textX, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('Prüfbescheinigung PSA', textX, 19);

    let y = 42;
    doc.setTextColor(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text(itemName(material), marginX, y); y += 10;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(brand[0], brand[1], brand[2]);
    doc.text('Kund*in', marginX, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(40);
    doc.text(kunde.name + (kunde.kundennummer ? ' · ' + kunde.kundennummer : ''), marginX, y); y += 10;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(brand[0], brand[1], brand[2]);
    doc.text('Material', marginX, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(40);
    const stammLines = [
      'Kategorie: ' + material.kategorie + (material.materialart ? ' · ' + material.materialart : ''),
      material.seriennummer ? 'Seriennummer: ' + material.seriennummer : (material.chargennummer ? 'Chargennummer: ' + material.chargennummer : null),
      material.herstellungsdatum ? 'Herstellungsdatum: ' + psaFmtDate(material.herstellungsdatum) : null,
      material.pruefrhythmus_monate ? 'Prüfrhythmus: alle ' + material.pruefrhythmus_monate + ' Monate' : null
    ].filter(Boolean);
    stammLines.forEach(line => { doc.text(line, marginX, y); y += 6; });
    y += 4;

    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(brand[0], brand[1], brand[2]);
    doc.text('Prüfhistorie', marginX, y); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    if (!pruefListe.length) {
      doc.setTextColor(120); doc.text('Noch keine Prüfung eingetragen.', marginX, y); y += 6;
    } else {
      pruefListe.forEach(p => {
        doc.setTextColor(40);
        doc.text(psaFmtDate(p.pruefdatum) + ' · ' + (PSA_ERGEBNIS_LABEL[p.ergebnis] || p.ergebnis), marginX, y); y += 6;
        if (p.notiz) { doc.setTextColor(100); doc.setFontSize(9.5); doc.text(doc.splitTextToSize(p.notiz, pageWidth - marginX * 2 - 4), marginX + 4, y); y += 6; doc.setFontSize(10); }
      });
    }
    y += 8;

    doc.setDrawColor(brand[0], brand[1], brand[2]); doc.setLineWidth(0.5);
    doc.line(marginX, y, pageWidth - marginX, y); y += 8;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40);
    doc.text('Geprüft von: ' + aussteller.name + (aussteller.organisation ? ' (' + aussteller.organisation + ')' : ''), marginX, y); y += 6;
    doc.text('Ausgestellt am: ' + new Date().toLocaleDateString('de-DE'), marginX, y); y += 10;

    doc.setFontSize(8.5); doc.setTextColor(120);
    const disclaimer = istBetamove
      ? 'BETAMOVE · betamove.de'
      : 'Erstellt mit der BETAMOVE PSA-Prüfsoftware (betamove.de). BETAMOVE selbst stellt diese Bescheinigung nicht aus und übernimmt keine Haftung für Inhalt oder Richtigkeit dieser Prüfung.';
    doc.text(doc.splitTextToSize(disclaimer, pageWidth - marginX * 2), marginX, 282);

    doc.save('Pruefbescheinigung_' + kunde.name.replace(/\s+/g, '-') + '_' + material.kategorie.replace(/\s+/g, '-') + '.pdf');
  }

  async function renderKunden(ctx) {
    const { client, session, profile } = ctx;
    const userId = session.user.id;
    const gateEl = document.getElementById('kundenGate');
    const areaEl = document.getElementById('kundenArea');

    const { data: sachRow } = await client.from('psa_sachkundige').select('*').eq('user_id', userId).maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    const isSach = !!sachRow && sachRow.status === 'freigeschaltet' && (!sachRow.freigeschaltet_bis || sachRow.freigeschaltet_bis >= today);

    if (!isSach) {
      gateEl.hidden = false;
      areaEl.hidden = true;
      document.getElementById('kundenGateText').textContent = sachRow && sachRow.status === 'offen'
        ? 'Dein Antrag auf Sachkundige-Freischaltung wird noch geprüft.'
        : 'Du bist noch keine freigeschaltete Sachkundige Person.';
      return;
    }
    gateEl.hidden = true;
    areaEl.hidden = false;

    let kunden = [];
    let materialByKunde = {};
    let pruefByMaterial = {};
    let openKundeId = null;

    async function loadAll() {
      const { data } = await client.from('kunden').select('*').eq('erstellt_von', userId).order('created_at', { ascending: false });
      kunden = data || [];
      materialByKunde = {};
      pruefByMaterial = {};
      const kIds = kunden.map(k => k.id);
      if (kIds.length) {
        const { data: mat } = await client.from('psa_material').select('*').in('kunde_id', kIds).order('created_at', { ascending: false });
        (mat || []).forEach(m => { (materialByKunde[m.kunde_id] = materialByKunde[m.kunde_id] || []).push(m); });
        const matIds = (mat || []).map(m => m.id);
        if (matIds.length) {
          const { data: pruef } = await client.from('psa_pruefprotokoll').select('*').in('material_id', matIds).order('pruefdatum', { ascending: false });
          (pruef || []).forEach(p => { (pruefByMaterial[p.material_id] = pruefByMaterial[p.material_id] || []).push(p); });
        }
      }
    }

    function renderMaterialDetail(kunde, m) {
      const pruef = pruefByMaterial[m.id] || [];
      return `
        <div style="border-top:1px solid var(--color-divider);margin-top:10px;padding-top:12px">
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
            ${(pruef.length ? pruef : []).map(p => `<div style="font-size:13px;background:var(--color-surface);border-radius:var(--radius-sm);padding:8px 12px">${psaFmtDate(p.pruefdatum)} · ${escapeHtml(PSA_ERGEBNIS_LABEL[p.ergebnis] || p.ergebnis)}${p.notiz ? ' — ' + escapeHtml(p.notiz) : ''}</div>`).join('') || '<p style="margin:0;font-size:13px;opacity:0.65">Noch keine Prüfung eingetragen.</p>'}
          </div>
          <form data-m-pruef="${m.id}" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
            <div class="field" style="min-width:160px"><label>Ergebnis</label>
              <select class="input" data-f="ergebnis" required>
                <option value="gut">Gut – weiter verwenden</option>
                <option value="mangel">Mangel festgestellt</option>
                <option value="aussondern">Aussondern</option>
              </select>
            </div>
            <div class="field" style="flex:1;min-width:200px"><label>Notiz (optional)</label><input class="input" data-f="notiz" maxlength="1000"></div>
            <button type="submit" class="btn btn-secondary" style="font-size:13.5px;padding:10px 16px">Prüfung eintragen</button>
          </form>
          <button type="button" class="btn btn-secondary" data-m-pdf="${m.id}" style="font-size:13px;padding:9px 16px">Prüfbescheinigung herunterladen</button>
        </div>`;
    }

    function renderKundeCard(k) {
      const items = materialByKunde[k.id] || [];
      const open = openKundeId === k.id;
      return `
        <div class="card elev-sm" style="gap:0">
          <button type="button" data-k-toggle="${k.id}" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:16px;width:100%">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:15.5px">${escapeHtml(k.name)}</div>
              <div style="font-size:12.5px;opacity:0.65;margin-top:2px">${escapeHtml([k.kundennummer, k.email, k.telefon].filter(Boolean).join(' · ') || 'keine weiteren Angaben')}</div>
            </div>
            <span class="tag tag-neutral">${items.length} Gegenstände</span>
          </button>
          ${open ? `
          <div style="border-top:1px solid var(--color-divider);margin-top:14px;padding-top:16px">
            <button type="button" class="btn btn-secondary" data-k-newmaterial="${k.id}" style="font-size:13.5px;padding:10px 16px;margin-bottom:14px">+ Neues PSA für ${escapeHtml(k.name)}</button>
            <form data-k-material-form="${k.id}" hidden style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;background:var(--color-surface);border-radius:var(--radius-md);padding:16px;margin-bottom:16px">
              <div class="field"><label>Kategorie</label><select class="input" data-f="kategorie">${PSA_KATEGORIEN.map(kt => `<option>${escapeHtml(kt)}</option>`).join('')}</select></div>
              <div class="field"><label>Materialart</label><select class="input" data-f="materialart"><option value="">—</option><option value="textil">Textil</option><option value="metall">Metall</option><option value="textil_metall">Textil + Metall</option></select></div>
              <div class="field"><label>Hersteller</label><input class="input" data-f="hersteller"></div>
              <div class="field"><label>Modellbezeichnung</label><input class="input" data-f="modellbezeichnung"></div>
              <div class="field"><label>Seriennummer</label><input class="input" data-f="seriennummer"></div>
              <div class="field"><label>Chargennummer</label><input class="input" data-f="chargennummer"></div>
              <div class="field"><label>Herstellungsdatum</label><input type="date" class="input" data-f="herstellungsdatum"></div>
              <div class="field"><label>Max. Lebensdauer (Jahre)</label><input type="number" min="1" max="99" class="input" data-f="max_lebensdauer_jahre"></div>
              <div class="field" style="grid-column:1/-1"><label>Prüfrhythmus</label>
                <select class="input" data-f="pruefrhythmus_monate"><option value="3">Alle 3 Monate</option><option value="6">Alle 6 Monate</option><option value="12" selected>Alle 12 Monate (Standard)</option></select>
              </div>
              <div style="grid-column:1/-1"><button type="submit" class="btn btn-primary" style="font-size:14px;padding:10px 18px">PSA anlegen</button></div>
            </form>
            ${items.map(m => `
              <div style="margin-bottom:14px">
                <div style="font-weight:600;font-size:14.5px">${escapeHtml(itemName(m))}</div>
                <div style="font-size:12px;opacity:0.65">${escapeHtml(itemMetaLine(m))}</div>
                ${renderMaterialDetail(k, m)}
              </div>`).join('') || '<p style="margin:0;font-size:13.5px;opacity:0.65">Noch kein PSA für diese Kund*in erfasst.</p>'}
          </div>` : ''}
        </div>`;
    }

    function render() {
      const listEl = document.getElementById('kundenList');
      document.getElementById('kundenEmpty').hidden = kunden.length > 0;
      listEl.innerHTML = kunden.map(renderKundeCard).join('');
      wireEvents();
    }

    function wireEvents() {
      document.querySelectorAll('[data-k-toggle]').forEach(el => {
        el.addEventListener('click', () => { const id = el.dataset.kToggle; openKundeId = openKundeId === id ? null : id; render(); });
      });
      document.querySelectorAll('[data-k-newmaterial]').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const form = document.querySelector('[data-k-material-form="' + el.dataset.kNewmaterial + '"]');
          if (form) form.hidden = !form.hidden;
        });
      });
      document.querySelectorAll('[data-k-material-form]').forEach(form => {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const kundeId = form.dataset.kMaterialForm;
          const val = (name) => form.querySelector('[data-f="' + name + '"]').value;
          const payload = {
            user_id: userId,
            kunde_id: kundeId,
            eigentuemer_typ: 'kunde',
            ist_psa: true,
            kategorie: val('kategorie'),
            materialart: val('materialart') || null,
            hersteller: val('hersteller').trim() || null,
            modellbezeichnung: val('modellbezeichnung').trim() || null,
            seriennummer: val('seriennummer').trim() || null,
            chargennummer: val('chargennummer').trim() || null,
            herstellungsdatum: val('herstellungsdatum') || null,
            max_lebensdauer_jahre: val('max_lebensdauer_jahre') ? Number(val('max_lebensdauer_jahre')) : null,
            pruefrhythmus_monate: Number(val('pruefrhythmus_monate'))
          };
          await client.from('psa_material').insert(payload);
          await loadAll();
          render();
        });
      });
      document.querySelectorAll('[data-m-pruef]').forEach(form => {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const materialId = form.dataset.mPruef;
          await client.from('psa_pruefprotokoll').insert({
            material_id: materialId,
            geprueft_von: userId,
            ergebnis: form.querySelector('[data-f="ergebnis"]').value,
            notiz: form.querySelector('[data-f="notiz"]').value.trim() || null
          });
          await loadAll();
          render();
        });
      });
      document.querySelectorAll('[data-m-pdf]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const materialId = btn.dataset.mPdf;
          const kunde = kunden.find(k => (materialByKunde[k.id] || []).some(m => m.id === materialId));
          const material = (materialByKunde[kunde.id] || []).find(m => m.id === materialId);
          const pruef = pruefByMaterial[materialId] || [];
          const aussteller = { name: (profile.vorname + ' ' + profile.nachname).trim(), organisation: sachRow.organisation };
          generatePruefbescheinigungPdf(kunde, material, pruef, aussteller);
        });
      });
    }

    const newBtn = document.getElementById('kundeNewBtn');
    const formBox = document.getElementById('kundeFormBox');
    const cancelBtn = document.getElementById('kundeFormCancel');
    const errBox = document.getElementById('kundeFormError');
    newBtn.addEventListener('click', () => { formBox.reset(); errBox.hidden = true; formBox.hidden = false; formBox.scrollIntoView({ behavior: 'smooth' }); });
    cancelBtn.addEventListener('click', () => { formBox.hidden = true; });
    formBox.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('kfName').value.trim();
      if (!name) return;
      try {
        const { error } = await client.from('kunden').insert({
          erstellt_von: userId,
          name,
          kundennummer: document.getElementById('kfKundennummer').value.trim() || null,
          email: document.getElementById('kfEmail').value.trim() || null,
          telefon: document.getElementById('kfTelefon').value.trim() || null
        });
        if (error) throw error;
        formBox.hidden = true;
        await loadAll();
        render();
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = 'Kunde konnte nicht angelegt werden.';
      }
    });

    await loadAll();
    render();
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
      'konto-training': renderTraining,
      'konto-psa': renderPsa,
      'konto-kunden': renderKunden
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
