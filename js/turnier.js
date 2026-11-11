// Tischtennis-Turnier (turnier.html) — Logik + Oberfläche, ohne Build-Schritt.
//
// Datenhaltung: Supabase (supabase/schema-turnier.sql + schema-turnier-v2.sql).
//   turnier.setup     = { title, teamSize, tables, bestOf, finals,
//                         teams:[{id,members:[playerId]}], schedule:[{id,round,a,b}], byes:{round:teamId} }
//   turnier.results   = { matchId: {a, b, at} }   (a/b = gewonnene Sätze von Team a/b)
//   turnier.teamnamen = { teamId: "Name" }        (setzt jedes Team selbst)
//   turnier_spieler   = Selbst-Anmeldungen (Name öffentlich, Spielstärke nur für die Leitung)
// Demo ohne Datenbank: turnier.html?demo=1 (speichert nur im Browser, PIN "demo").
(function () {
  'use strict';

  // =====================================================================
  // 1. Reine Turnier-Logik (ohne DOM) — auch in Node testbar
  // =====================================================================
  const TT = {};

  TT.uid = function () {
    return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  };

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  TT.rng = mulberry32;

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Teamgrößen: n Spieler auf k Teams möglichst gleich verteilen
  TT.teamSizes = function (n, size) {
    if (n === 0) return [];
    const k = size <= 1 ? n : Math.max(1, Math.floor(n / size));
    const base = Math.floor(n / k), extra = n % k;
    return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
  };

  // Kosten: Streuung der Team-Durchschnitte (+ minimal die Summen, damit bei
  // gleichen Größen auch die Summen gleich sind)
  function cost(teams) {
    const avgs = teams.map(t => t.reduce((s, p) => s + p.skill, 0) / t.length);
    const m = avgs.reduce((s, x) => s + x, 0) / avgs.length;
    return avgs.reduce((s, x) => s + (x - m) * (x - m), 0);
  }

  function localSearch(teams) {
    let improved = true, c = cost(teams);
    while (improved) {
      improved = false;
      for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) {
        for (let x = 0; x < teams[i].length; x++) for (let y = 0; y < teams[j].length; y++) {
          const a = teams[i][x], b = teams[j][y];
          if (a.skill === b.skill) continue;
          teams[i][x] = b; teams[j][y] = a;
          const c2 = cost(teams);
          if (c2 < c - 1e-9) { c = c2; improved = true; }
          else { teams[i][x] = a; teams[j][y] = b; }
        }
      }
    }
    return c;
  }

  // Ausgeglichene Teams: viele zufällige Starts + Tausch-Optimierung, dann
  // zufällig eine der besten Lösungen (so liefert "Nochmal mischen" Varianten).
  TT.buildTeams = function (players, size, seed) {
    const rnd = mulberry32(seed == null ? (Date.now() & 0xffffffff) : seed);
    const sizes = TT.teamSizes(players.length, size);
    if (!sizes.length) return [];
    const sols = [];
    const tries = 400;
    for (let t = 0; t < tries; t++) {
      const pool = shuffle(players, rnd);
      const teams = sizes.map(() => []);
      let idx = 0;
      sizes.forEach((s, ti) => { for (let k = 0; k < s; k++) teams[ti].push(pool[idx++]); });
      const c = localSearch(teams);
      sols.push({ c, teams });
    }
    const best = Math.min(...sols.map(s => s.c));
    const seen = new Set(), good = [];
    sols.filter(s => s.c <= best + 1e-6).forEach(s => {
      const key = s.teams.map(t => t.map(p => p.id).sort().join(',')).sort().join('|');
      if (!seen.has(key)) { seen.add(key); good.push(s.teams); }
    });
    const pick = good[Math.floor(rnd() * good.length)];
    return shuffle(pick, rnd).map(t => ({
      id: TT.uid(),
      members: t.slice().sort((a, b) => b.skill - a.skill).map(p => p.id),
    }));
  };

  // Jeder gegen jeden (Kreis-Methode); bei ungerader Teamzahl hat pro Runde ein Team Pause
  TT.roundRobin = function (teamIds) {
    const ids = teamIds.slice();
    if (ids.length < 2) return { schedule: [], byes: {} };
    if (ids.length % 2) ids.push(null);
    const m = ids.length, schedule = [], byes = {};
    let arr = ids.slice();
    for (let r = 0; r < m - 1; r++) {
      let mi = 0;
      for (let i = 0; i < m / 2; i++) {
        let a = arr[i], b = arr[m - 1 - i];
        if (a === null || b === null) { byes[r + 1] = a === null ? b : a; continue; }
        if (r % 2 === 1 && i === 0) [a, b] = [b, a]; // Seiten etwas abwechseln
        schedule.push({ id: 'r' + (r + 1) + 'm' + (++mi), round: r + 1, a, b });
      }
      arr = [arr[0], arr[m - 1]].concat(arr.slice(1, m - 1));
    }
    return { schedule, byes };
  };

  TT.winSets = bestOf => Math.ceil(bestOf / 2);

  // Alle gültigen Satz-Ergebnisse für Schnellauswahl, z. B. bestOf 3 -> 2:0, 2:1, 1:2, 0:2
  TT.validScores = function (bestOf) {
    const w = TT.winSets(bestOf), out = [];
    for (let l = 0; l < w; l++) out.push([w, l]);
    for (let l = w - 1; l >= 0; l--) out.push([l, w]);
    return out;
  };

  TT.standings = function (setup, results) {
    const rows = {};
    (setup.teams || []).forEach(t => {
      rows[t.id] = { team: t.id, played: 0, won: 0, lost: 0, setsFor: 0, setsAgainst: 0 };
    });
    const group = (setup.schedule || []);
    group.forEach(m => {
      const r = results[m.id];
      if (!r || !rows[m.a] || !rows[m.b]) return;
      const A = rows[m.a], B = rows[m.b];
      A.played++; B.played++;
      A.setsFor += r.a; A.setsAgainst += r.b; B.setsFor += r.b; B.setsAgainst += r.a;
      if (r.a > r.b) { A.won++; B.lost++; } else { B.won++; A.lost++; }
    });
    const list = Object.values(rows);
    const h2h = (x, y) => {
      const m = group.find(g => (g.a === x && g.b === y) || (g.a === y && g.b === x));
      const r = m && results[m.id];
      if (!r) return 0;
      const xWon = (m.a === x) === (r.a > r.b);
      return xWon ? -1 : 1;
    };
    list.sort((x, y) =>
      (y.won - x.won) ||
      ((y.setsFor - y.setsAgainst) - (x.setsFor - x.setsAgainst)) ||
      (y.setsFor - x.setsFor) ||
      h2h(x.team, y.team));
    return list;
  };

  TT.groupDone = function (setup, results) {
    const s = setup.schedule || [];
    return s.length > 0 && s.every(m => results[m.id]);
  };

  // Finalspiele, sobald die Gruppenphase komplett ist
  TT.finals = function (setup, results) {
    if (!setup.finals || (setup.teams || []).length < 3 || !TT.groupDone(setup, results)) return [];
    const st = TT.standings(setup, results);
    const f = [{ id: 'f1', round: 'F', label: 'Finale', a: st[0].team, b: st[1].team }];
    if (st.length >= 4) f.unshift({ id: 'f2', round: 'F', label: 'Spiel um Platz 3', a: st[2].team, b: st[3].team });
    return f;
  };

  TT.allMatches = function (setup, results) {
    return (setup.schedule || []).concat(TT.finals(setup, results));
  };

  // Welche Spiele laufen jetzt (pro Platte eins, kein Team doppelt), welche kommen danach
  TT.nextMatches = function (setup, results) {
    const pending = TT.allMatches(setup, results).filter(m => !results[m.id]);
    const tables = Math.max(1, setup.tables || 1);
    const now = [], busy = new Set();
    for (const m of pending) {
      if (now.length >= tables) break;
      if (busy.has(m.a) || busy.has(m.b)) continue;
      now.push(m); busy.add(m.a); busy.add(m.b);
    }
    const later = pending.filter(m => !now.includes(m));
    return { now, later };
  };

  // Endplatzierung (nur wenn alles gespielt ist)
  TT.podium = function (setup, results) {
    if (!TT.groupDone(setup, results)) return null;
    const st = TT.standings(setup, results).map(r => r.team);
    const fin = TT.finals(setup, results);
    if (fin.some(m => !results[m.id])) return null;
    const order = st.slice();
    const apply = (m, pos) => {
      const r = results[m.id], win = r.a > r.b ? m.a : m.b, lose = r.a > r.b ? m.b : m.a;
      order[pos] = win; order[pos + 1] = lose;
    };
    fin.forEach(m => apply(m, m.id === 'f1' ? 0 : 2));
    return order;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TT;
  if (typeof window === 'undefined') return;
  window.TT = TT;

  // =====================================================================
  // 2. Datenzugriff (Supabase oder Demo im Browser)
  // =====================================================================
  const params = new URLSearchParams(location.search);
  const TURNIER_ID = (params.get('t') || 'geburtstag').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'geburtstag';
  const DEMO = params.has('demo');

  function demoBackend() {
    const KEY = 'turnier-demo-' + TURNIER_ID;
    const read = () => {
      let d;
      try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { d = null; }
      d = d || {};
      return { setup: d.setup || {}, results: d.results || {}, teamnamen: d.teamnamen || {}, players: d.players || [] };
    };
    const write = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* egal */ } };
    const pinOk = pin => { if (pin !== 'demo') throw new Error('falsche PIN'); };
    const clean = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const taken = (d, name, id) => d.players.some(p => p.id !== id && p.name.toLowerCase() === name.toLowerCase());
    return {
      async load() {
        const d = read();
        return { setup: d.setup, results: d.results, teamnamen: d.teamnamen,
          players: d.players.map(p => ({ id: p.id, name: p.name, active: p.active })) };
      },
      async signup(name, skill) {
        const d = read(); name = clean(name);
        if ((d.setup.teams || []).length) throw new Error('Die Teams sind schon ausgelost – bitte bei der Turnierleitung melden');
        if (!name) throw new Error('Bitte einen Namen eingeben');
        if (taken(d, name)) throw new Error('Der Name „' + name + '“ ist schon angemeldet');
        const p = { id: TT.uid(), name, skill: Math.min(10, Math.max(1, skill || 5)), active: true };
        d.players.push(p); write(d); return p.id;
      },
      async setTeamName(team, name) {
        const d = read(); name = clean(name);
        if (!(d.setup.teams || []).some(t => t.id === team)) throw new Error('Team nicht gefunden');
        if (name) d.teamnamen[team] = name; else delete d.teamnamen[team];
        write(d);
      },
      async setResult(id, a, b) {
        const d = read();
        if (a == null) delete d.results[id]; else d.results[id] = { a, b, at: new Date().toISOString() };
        write(d);
      },
      async adminSave(pin, setup, reset) {
        pinOk(pin);
        const d = read();
        if (setup) { d.setup = setup; if (reset) { d.results = {}; d.teamnamen = {}; } write(d); }
        return true;
      },
      async adminPlayers(pin, action, player) {
        pinOk(pin);
        const d = read();
        if (action === 'upsert') {
          const name = clean(player.name);
          if (!name) throw new Error('Name fehlt');
          if (taken(d, name, player.id)) throw new Error('Der Name „' + name + '“ ist schon angemeldet');
          const ex = d.players.find(p => p.id === player.id);
          if (ex) Object.assign(ex, { name, skill: player.skill, active: player.active });
          else d.players.push({ id: TT.uid(), name, skill: player.skill || 5, active: player.active !== false });
        } else if (action === 'delete') {
          d.players = d.players.filter(p => p.id !== player.id);
        }
        write(d);
        return d.players.map(p => Object.assign({}, p));
      },
    };
  }

  function supabaseBackend() {
    const res = window.bmGetSupabaseClient ? window.bmGetSupabaseClient() : { client: null, error: 'sdk_missing' };
    if (!res.client) return null;
    const db = res.client;
    const err = e => new Error((e && (e.message || e.details)) || 'Verbindungsfehler');
    const rpc = async (fn, args) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw err(error);
      return data;
    };
    return {
      async load() {
        const [t, s] = await Promise.all([
          db.from('turnier').select('setup,results,teamnamen,updated_at').eq('id', TURNIER_ID).maybeSingle(),
          db.from('turnier_spieler').select('id,name,active,created_at').eq('turnier_id', TURNIER_ID).order('created_at'),
        ]);
        if (t.error || s.error) {
          const e = t.error || s.error;
          if (/teamnamen|turnier_spieler/.test(e.message || '')) throw new Error('v2_missing');
          throw err(e);
        }
        if (!t.data) throw new Error('not_found');
        return { setup: t.data.setup || {}, results: t.data.results || {}, teamnamen: t.data.teamnamen || {}, players: s.data || [] };
      },
      signup: (name, skill) => rpc('turnier_anmelden', { p_turnier: TURNIER_ID, p_name: name, p_skill: skill }),
      setTeamName: (team, name) => rpc('turnier_teamname_setzen', { p_turnier: TURNIER_ID, p_team: team, p_name: name }),
      setResult: (id, a, b) => rpc('turnier_ergebnis_setzen', { p_turnier: TURNIER_ID, p_match: id, p_a: a, p_b: b }),
      adminSave: (pin, setup, reset) => rpc('turnier_admin_speichern', {
        p_turnier: TURNIER_ID, p_pin: pin, p_setup: setup, p_reset_results: !!reset }),
      adminPlayers: (pin, action, player) => rpc('turnier_admin_spieler', {
        p_turnier: TURNIER_ID, p_pin: pin, p_action: action, p_player: player || null }),
    };
  }

  const backend = DEMO ? demoBackend() : supabaseBackend();

  // =====================================================================
  // 3. Oberfläche
  // =====================================================================
  const $ = sel => document.querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'text') n.textContent = v;
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };

  function store(kind, k, v) {
    const s = kind === 'local' ? 'localStorage' : 'sessionStorage';
    try {
      if (v === undefined) return window[s].getItem(k + TURNIER_ID);
      if (v === null) window[s].removeItem(k + TURNIER_ID); else window[s].setItem(k + TURNIER_ID, v);
    } catch (e) { return null; }
    return null;
  }

  const state = {
    setup: {}, results: {}, teamnamen: {}, players: [], loaded: false, error: null,
    tab: 'spiele',
    me: store('local', 'turnier-ich-'),     // eigene Spieler-ID auf diesem Gerät
    pin: store('session', 'turnier-pin-'),
    adminPlayers: null,  // Leitung: Spielerliste inkl. Stärke
    settings: null,      // Leitung: Einstellungs-Entwurf
    preview: null,       // Leitung: Vorschau neu gebildeter Teams
    swapSel: null,
    busy: false,
  };

  const DEFAULTS = { title: 'Geburtstags-Turnier', teamSize: 2, tables: 2, bestOf: 3, finals: true };
  const S = () => Object.assign({}, DEFAULTS, state.setup);

  function playerName(id) {
    const p = state.players.find(x => x.id === id) || (state.adminPlayers || []).find(x => x.id === id);
    return p ? p.name : '?';
  }
  function team(id) { return (S().teams || []).find(t => t.id === id); }
  function members(id) { const t = team(id); return t ? t.members.map(playerName).join(' & ') : '?'; }
  function teamName(id) { return state.teamnamen[id] || members(id); }
  function teamLabel(id) {
    // Teamname groß, Mitglieder klein darunter (nur wenn ein eigener Name vergeben ist)
    return state.teamnamen[id]
      ? el('span', { class: 'tl' }, state.teamnamen[id], el('small', null, members(id)))
      : el('span', { class: 'tl' }, members(id));
  }
  function myTeam() {
    if (!state.me) return null;
    return (S().teams || []).find(t => t.members.includes(state.me)) || null;
  }
  function signupUrl() {
    const u = new URL(location.href);
    u.hash = ''; u.search = '';
    if (TURNIER_ID !== 'geburtstag') u.searchParams.set('t', TURNIER_ID);
    if (DEMO) u.searchParams.set('demo', '1');
    return u.toString().replace(/\.html(?=$|\?)/, '');
  }

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2800);
  }
  const niceErr = e => String(e && e.message || e).replace(/^.*?ERROR:\s*/, '');

  function typing() {
    const a = document.activeElement;
    return $('#dlg').open || (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox');
  }

  async function refresh(silent) {
    if (!backend) { state.error = 'Keine Datenbank-Verbindung konfiguriert.'; state.loaded = true; render(); return; }
    try {
      const d = await backend.load();
      const before = JSON.stringify([state.setup, state.results, state.teamnamen, state.players]);
      state.setup = d.setup; state.results = d.results; state.teamnamen = d.teamnamen; state.players = d.players;
      let changed = before !== JSON.stringify([d.setup, d.results, d.teamnamen, d.players]) || !!state.error;
      state.error = null; state.loaded = true;
      if (state.me && !state.players.some(p => p.id === state.me)) { state.me = null; store('local', 'turnier-ich-', null); changed = true; }
      if (state.pin && state.tab === 'leitung') {
        const before2 = JSON.stringify(state.adminPlayers);
        await loadAdminPlayers();
        if (before2 !== JSON.stringify(state.adminPlayers)) changed = true;
      }
      $('#live').textContent = 'Live · ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('#live').classList.remove('off');
      if (!silent || (changed && !typing())) render();
    } catch (e) {
      state.loaded = true;
      state.error = e.message === 'not_found'
        ? 'Das Turnier „' + TURNIER_ID + '“ ist noch nicht angelegt (supabase/schema-turnier.sql ausführen).'
        : e.message === 'v2_missing'
          ? 'Datenbank-Update fehlt: bitte supabase/schema-turnier-v2.sql im Supabase SQL-Editor ausführen.'
          : 'Keine Verbindung zur Datenbank: ' + niceErr(e);
      $('#live').textContent = 'Offline';
      $('#live').classList.add('off');
      if (!silent || !typing()) render();
    }
  }

  async function loadAdminPlayers() {
    try { state.adminPlayers = await backend.adminPlayers(state.pin, 'list'); }
    catch (e) { if (/pin/i.test(e.message)) logout(); else throw e; }
  }
  function logout() { state.pin = null; store('session', 'turnier-pin-', null); state.adminPlayers = null; state.settings = null; state.preview = null; }

  // ---------------------------------------------------------------- Rendern
  function render() {
    document.title = S().title + ' 🏓';
    $('#title').textContent = S().title;
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
    const main = $('#main');
    main.replaceChildren();
    if (DEMO) main.append(el('div', { class: 'note' }, 'Demo-Modus: Daten liegen nur in diesem Browser. PIN der Turnierleitung: ', el('b', null, 'demo')));
    if (state.error) main.append(el('div', { class: 'note bad' }, state.error));
    if (!state.loaded) { main.append(el('p', { class: 'muted center' }, 'Lade Turnier …')); return; }
    const view = { spiele: renderGames, tabelle: renderTable, teams: renderTeams, leitung: renderAdmin }[state.tab];
    view(main);
  }

  // ------------------------------------------------ Anmeldung (vor Auslosung)
  const SKILL_HINT = ['', 'spiele so gut wie nie', '', 'ab und zu im Urlaub', '', 'ganz okay', '', 'spiele regelmäßig', '', 'sehr stark', 'Vereinsniveau'];
  function skillHint(v) { for (let i = v; i >= 1; i--) if (SKILL_HINT[i]) return SKILL_HINT[i]; return ''; }

  function renderSignup(main) {
    const me = state.players.find(p => p.id === state.me);
    if (me) {
      main.append(el('section', { class: 'card ok' },
        el('div', { class: 'big' }, '✅'),
        el('h2', null, 'Du bist angemeldet, ' + me.name + '!'),
        el('p', { class: 'muted' }, 'Sobald alle da sind, lost die Turnierleitung die Teams aus. Dann siehst du hier dein Team und kannst euch einen Namen geben.'),
        el('button', { class: 'link small', onclick: () => {
          if (!confirm('Dieses Handy nicht mehr ' + me.name + ' zuordnen?')) return;
          state.me = null; store('local', 'turnier-ich-', null); render();
        } }, 'Nicht ' + me.name + '?')));
    } else {
      const name = el('input', { class: 'in', placeholder: 'Dein Name', maxlength: 30, autocomplete: 'given-name', enterkeyhint: 'done' });
      const out = el('b', null, '5');
      const hint = el('span', { class: 'muted small' }, skillHint(5));
      const range = el('input', { type: 'range', min: 1, max: 10, value: 5, 'aria-label': 'Wie gut spielst du?',
        oninput: e => { out.textContent = e.target.value; hint.textContent = skillHint(+e.target.value); } });
      const btn = el('button', { class: 'btn wide' }, 'Anmelden');
      const go = async () => {
        if (state.busy) return;
        if (!name.value.trim()) { name.focus(); return; }
        state.busy = true; btn.disabled = true;
        try {
          const id = await backend.signup(name.value, +range.value);
          state.me = id; store('local', 'turnier-ich-', id);
          toast('Angemeldet – viel Spaß! 🏓');
          await refresh();
        } catch (e) { toast(niceErr(e), true); btn.disabled = false; }
        finally { state.busy = false; }
      };
      btn.addEventListener('click', go);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      main.append(el('section', { class: 'card hl' },
        el('h2', null, '🏓 Zum Turnier anmelden'),
        el('label', { class: 'fld' }, el('span', null, 'Name'), name),
        el('div', { class: 'fld' }, el('span', null, 'Wie gut spielst du Tischtennis? ', out, ' / 10'), range, hint),
        el('p', { class: 'muted small' }, 'Deine Einschätzung sieht nur die Turnierleitung – sie wird genutzt, um faire Teams zu mischen.'),
        btn));
    }
    const active = state.players.filter(p => p.active);
    main.append(el('h2', { class: 'sec' }, 'Angemeldet (' + active.length + ')'),
      active.length
        ? el('div', { class: 'chips' }, active.map(p => el('span', { class: 'nchip' + (p.id === state.me ? ' me' : '') }, p.name)))
        : el('p', { class: 'muted' }, 'Noch niemand – sei die erste Person!'));
  }

  // --------------------------------------------------------- Mein Team
  function renderMyTeam(main) {
    const setup = S();
    const t = myTeam();
    if (!t) {
      const inTeams = setup.teams.flatMap(x => x.members);
      const sel = el('select', { class: 'in', onchange: e => {
        if (!e.target.value) return;
        state.me = e.target.value; store('local', 'turnier-ich-', state.me); render();
      } }, el('option', { value: '' }, 'Wer bist du? Bitte auswählen …'),
        inTeams.map(id => ({ id, n: playerName(id) })).sort((a, b) => a.n.localeCompare(b.n, 'de'))
          .map(p => el('option', { value: p.id }, p.n)));
      main.append(el('section', { class: 'card' },
        el('h2', null, '👋 Wer bist du?'),
        el('p', { class: 'muted small' }, 'Wähle deinen Namen, dann siehst du dein Team und könnt euch einen Teamnamen geben.'),
        sel));
      return;
    }
    const others = t.members.filter(id => id !== state.me).map(playerName);
    const input = el('input', { class: 'in', maxlength: 30, placeholder: 'z. B. Die Schmetterlinge', value: state.teamnamen[t.id] || '' });
    const save = async () => {
      if (state.busy) return;
      state.busy = true;
      try { await backend.setTeamName(t.id, input.value); input.blur(); toast(input.value.trim() ? 'Teamname gespeichert' : 'Teamname entfernt'); await refresh(); }
      catch (e) { toast(niceErr(e), true); }
      finally { state.busy = false; }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });

    const { now, later } = TT.nextMatches(setup, state.results);
    const all = TT.allMatches(setup, state.results);
    const mine = m => m.a === t.id || m.b === t.id;
    const nowIdx = now.findIndex(mine);
    const next = nowIdx >= 0 ? now[nowIdx] : later.find(mine);
    let nextInfo;
    if (next) {
      const opp = next.a === t.id ? next.b : next.a;
      nextInfo = el('div', { class: 'nextup' + (nowIdx >= 0 ? ' now' : '') },
        nowIdx >= 0 ? el('b', null, '🔥 Ihr seid jetzt dran' + (now.length > 1 ? ' – Platte ' + (nowIdx + 1) : '') + '!') : el('b', null, 'Euer nächstes Spiel'),
        el('div', null, 'gegen ', el('b', null, teamName(opp))),
        el('button', { class: 'btn small', onclick: () => openScore(next) }, 'Ergebnis eintragen'));
    } else if (all.some(mine)) {
      nextInfo = el('div', { class: 'nextup' }, 'Alle eure Spiele sind gespielt 🎉');
    }
    const played = all.filter(m => mine(m) && state.results[m.id]);
    const won = played.filter(m => { const r = state.results[m.id]; return (m.a === t.id) === (r.a > r.b); }).length;

    main.append(el('section', { class: 'card myteam' },
      el('div', { class: 'between' }, el('span', { class: 'tnum' }, 'Dein Team'),
        el('span', { class: 'muted small' }, played.length ? won + ' von ' + played.length + ' Spielen gewonnen' : '')),
      el('h2', { class: 'tname' }, state.teamnamen[t.id] || 'Team ohne Namen'),
      el('div', { class: 'mates' }, '🏓 Du', others.length ? ' + ' + others.join(' + ') : ''),
      el('div', { class: 'row tight' }, input, el('button', { class: 'btn ghost', onclick: save }, 'Speichern')),
      nextInfo,
      el('button', { class: 'link small', onclick: () => { state.me = null; store('local', 'turnier-ich-', null); render(); } }, 'Nicht ' + playerName(state.me) + '?')));
  }

  function matchCard(m, opts) {
    const r = state.results[m.id];
    const winA = r && r.a > r.b, winB = r && r.b > r.a;
    const t = myTeam();
    const isMine = t && (m.a === t.id || m.b === t.id);
    return el('div', { class: 'match' + (r ? ' done' : '') + (opts && opts.hot ? ' hot' : '') + (isMine ? ' mine' : '') },
      el('div', { class: 'mmeta' },
        opts && opts.table ? el('span', { class: 'pill' }, 'Platte ' + opts.table) : null,
        el('span', null, m.label || ('Runde ' + m.round)),
        isMine ? el('span', { class: 'pill soft' }, 'Dein Team') : null),
      el('div', { class: 'mrow' },
        el('span', { class: 'mteam' + (winA ? ' win' : '') }, teamLabel(m.a)),
        el('span', { class: 'mscore' }, r ? r.a + ' : ' + r.b : 'vs'),
        el('span', { class: 'mteam right' + (winB ? ' win' : '') }, teamLabel(m.b))),
      el('button', { class: 'btn ' + (r ? 'ghost ' : '') + 'small wide', onclick: () => openScore(m) },
        r ? 'Ergebnis ändern' : '✏️ Ergebnis eintragen'));
  }

  function renderGames(main) {
    const setup = S();
    if (!(setup.teams || []).length) return renderSignup(main);
    renderMyTeam(main);
    const { now, later } = TT.nextMatches(setup, state.results);
    const podium = TT.podium(setup, state.results);

    if (podium) {
      const medals = ['🥇', '🥈', '🥉'];
      main.append(el('section', { class: 'card podium' },
        el('h2', null, '🏆 Turnier beendet!'),
        podium.slice(0, 3).map((t, i) => el('div', { class: 'prow p' + i }, el('span', { class: 'medal' }, medals[i]), teamName(t)))));
    }
    if (now.length) {
      main.append(el('h2', { class: 'sec' }, 'Jetzt spielen'));
      now.forEach((m, i) => main.append(matchCard(m, { hot: true, table: now.length > 1 || setup.tables > 1 ? i + 1 : null })));
    }
    if (later.length) {
      main.append(el('h2', { class: 'sec' }, 'Als Nächstes'));
      later.slice(0, 4).forEach(m => main.append(matchCard(m)));
      if (later.length > 4) main.append(el('p', { class: 'muted small' }, '… und ' + (later.length - 4) + ' weitere Spiele (siehe Spielplan unten).'));
    }
    if (!TT.groupDone(setup, state.results) && setup.finals && setup.teams.length >= 3) {
      main.append(el('p', { class: 'muted small' },
        'Nach der Gruppenphase: ' + (setup.teams.length >= 4 ? 'Spiel um Platz 3 (3. gegen 4.) und ' : '') + 'Finale (1. gegen 2.).'));
    }
    const all = TT.allMatches(setup, state.results);
    const byRound = {};
    all.forEach(m => { (byRound[m.round] = byRound[m.round] || []).push(m); });
    const det = el('details', { class: 'plan' }, el('summary', null,
      'Kompletter Spielplan (' + all.filter(m => state.results[m.id]).length + '/' + all.length + ' gespielt)'));
    Object.keys(byRound).forEach(r => {
      det.append(el('h3', null, r === 'F' ? 'Finalspiele' : 'Runde ' + r,
        setup.byes && setup.byes[r] ? el('span', { class: 'muted small' }, ' · Pause: ' + teamName(setup.byes[r])) : null));
      byRound[r].forEach(m => det.append(matchCard(m)));
    });
    main.append(det);
  }

  function renderTable(main) {
    const setup = S();
    if (!(setup.teams || []).length) return noTeamsYet(main);
    const st = TT.standings(setup, state.results);
    const podium = TT.podium(setup, state.results);
    const t = myTeam();
    const tbl = el('table', { class: 'tbl' },
      el('thead', null, el('tr', null,
        el('th', null, '#'), el('th', { class: 'l' }, 'Team'), el('th', null, 'Sp'),
        el('th', null, 'S'), el('th', null, 'N'), el('th', null, 'Sätze'), el('th', null, '+/−'))),
      el('tbody', null, st.map((r, i) => el('tr', { class: [i < 2 && setup.finals ? 'top' : '', t && t.id === r.team ? 'mine' : ''].join(' ').trim() || null },
        el('td', null, i + 1), el('td', { class: 'l' }, teamLabel(r.team)), el('td', null, r.played),
        el('td', null, el('b', null, r.won)), el('td', null, r.lost),
        el('td', null, r.setsFor + ':' + r.setsAgainst),
        el('td', null, (r.setsFor - r.setsAgainst > 0 ? '+' : '') + (r.setsFor - r.setsAgainst))))));
    main.append(el('h2', { class: 'sec' }, 'Tabelle Gruppenphase'), el('div', { class: 'card flush' }, tbl),
      el('p', { class: 'muted small' }, 'Reihenfolge: Siege, dann Satzdifferenz, dann gewonnene Sätze, dann direkter Vergleich.' +
        (setup.finals && setup.teams.length >= 3 ? ' Die ersten zwei spielen das Finale.' : '')));
    if (podium) {
      main.append(el('h2', { class: 'sec' }, 'Endstand'),
        el('ol', { class: 'card final' }, podium.map(id => el('li', null, teamName(id)))));
    }
  }

  function noTeamsYet(main) {
    main.append(el('div', { class: 'card center empty' },
      el('div', { class: 'big' }, '🏓'),
      el('h2', null, 'Die Teams werden am Tag ausgelost'),
      el('p', { class: 'muted' }, 'Bis dahin kannst du dich im Tab „Spiele“ anmelden.')));
  }

  function renderTeams(main) {
    const setup = S();
    if (!(setup.teams || []).length) return noTeamsYet(main);
    const mine = myTeam();
    main.append(el('h2', { class: 'sec' }, 'Teams'));
    const grid = el('div', { class: 'grid' });
    setup.teams.forEach((t, i) => {
      grid.append(el('div', { class: 'card team' + (mine && mine.id === t.id ? ' mine' : '') },
        el('div', { class: 'tnum' }, 'Team ' + (i + 1) + (mine && mine.id === t.id ? ' · deins' : '')),
        state.teamnamen[t.id] ? el('div', { class: 'tname2' }, state.teamnamen[t.id]) : null,
        t.members.map(id => el('div', { class: 'tplayer' }, playerName(id)))));
    });
    main.append(grid);
    if (setup.teamSize > 1 && setup.teams.some(t => t.members.length > setup.teamSize)) {
      main.append(el('p', { class: 'muted small' }, 'Teams mit einer Person mehr wechseln sich beim Spielen ab.'));
    }
  }

  // ------------------------------------------------------- Ergebnis-Dialog
  function openScore(m) {
    const setup = S();
    const r = state.results[m.id];
    const w = TT.winSets(setup.bestOf);
    const dlg = $('#dlg');
    const sc = { a: r ? r.a : 0, b: r ? r.b : 0 };
    const valA = el('span', { class: 'sv' }), valB = el('span', { class: 'sv' });
    const info = el('div', { class: 'sinfo' });
    const ok = el('button', { type: 'button', class: 'btn wide big' });
    const valid = () => Math.max(sc.a, sc.b) === w && Math.min(sc.a, sc.b) < w;
    const upd = () => {
      valA.textContent = sc.a; valB.textContent = sc.b;
      if (valid()) {
        info.textContent = '🏆 ' + teamName(sc.a > sc.b ? m.a : m.b) + ' gewinnt ' + Math.max(sc.a, sc.b) + ':' + Math.min(sc.a, sc.b);
        info.className = 'sinfo good';
        ok.disabled = false; ok.textContent = '✓ Ergebnis bestätigen';
      } else {
        info.textContent = 'Gewonnen hat, wer zuerst ' + w + (w === 1 ? ' Satz' : ' Sätze') + ' hat.';
        info.className = 'sinfo';
        ok.disabled = true; ok.textContent = 'Ergebnis bestätigen';
      }
    };
    const stepper = (key, label, val) => el('div', { class: 'step' },
      el('div', { class: 'slabel' }, label),
      el('div', { class: 'sctl' },
        el('button', { type: 'button', class: 'sb', 'aria-label': 'weniger', onclick: () => { sc[key] = Math.max(0, sc[key] - 1); upd(); } }, '−'),
        val,
        el('button', { type: 'button', class: 'sb', 'aria-label': 'mehr', onclick: () => { sc[key] = Math.min(w, sc[key] + 1); upd(); } }, '+')));
    const save = async (a, b) => {
      if (state.busy) return;
      state.busy = true; ok.disabled = true;
      try {
        await backend.setResult(m.id, a, b);
        dlg.close();
        toast(a == null ? 'Ergebnis gelöscht' : 'Gespeichert: ' + a + ':' + b + ' ✓');
        await refresh();
      } catch (e) { toast('Speichern fehlgeschlagen: ' + niceErr(e), true); ok.disabled = false; }
      finally { state.busy = false; }
    };
    ok.addEventListener('click', () => save(sc.a, sc.b));
    dlg.replaceChildren(el('div', { class: 'dlgin' },
      el('div', { class: 'between' },
        el('span', { class: 'muted small' }, (m.label || 'Runde ' + m.round) + ' · gewonnene Sätze'),
        el('button', { type: 'button', class: 'x', 'aria-label': 'schließen', onclick: () => dlg.close() }, '×')),
      el('div', { class: 'steps' },
        stepper('a', teamName(m.a), valA),
        el('div', { class: 'colon' }, ':'),
        stepper('b', teamName(m.b), valB)),
      info, ok,
      r ? el('button', { type: 'button', class: 'link bad small', onclick: () => { if (confirm('Ergebnis wirklich löschen?')) save(null, null); } }, 'Ergebnis löschen') : null));
    upd();
    dlg.showModal();
    ok.blur();
  }

  // ------------------------------------------------------- Turnierleitung
  function renderAdmin(main) {
    if (!state.pin) {
      const inp = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'PIN', class: 'in' });
      const login = async () => {
        const pin = inp.value.trim();
        if (!pin) return;
        try {
          await backend.adminSave(pin, null, false);
          state.pin = pin; store('session', 'turnier-pin-', pin);
          await loadAdminPlayers(); render();
        } catch (e) { toast(/pin/i.test(e.message) ? 'Falsche PIN' : 'Fehler: ' + niceErr(e), true); }
      };
      main.append(el('div', { class: 'card' },
        el('h2', null, 'Turnierleitung'),
        el('p', { class: 'muted' }, 'Hier gibt es den QR-Code zur Anmeldung, die Spielstärken und die Team-Auslosung. Ergebnisse und Teamnamen können alle selbst eintragen.'),
        el('div', { class: 'row' }, inp, el('button', { class: 'btn', onclick: login }, 'Anmelden'))));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
      return;
    }
    if (!state.adminPlayers) { main.append(el('p', { class: 'muted center' }, 'Lade Spieler …')); loadAdminPlayers().then(render); return; }

    renderQrCard(main);
    renderPlayersAdmin(main);
    renderPreview(main);
    renderSettings(main);

    if ((S().teams || []).length) {
      main.append(el('section', { class: 'card' },
        el('h2', null, 'Gefahrenzone'),
        el('div', { class: 'row' },
          el('button', { class: 'btn danger', onclick: async () => {
            if (!confirm('Alle Ergebnisse löschen? Teams und Spielplan bleiben.')) return;
            await adminSave(S(), false, 'Ergebnisse gelöscht', true);
          } }, 'Alle Ergebnisse löschen'),
          el('button', { class: 'btn danger', onclick: async () => {
            if (!confirm('Teams auflösen? Spielplan, Ergebnisse und Teamnamen werden gelöscht, die Anmeldung ist wieder offen.')) return;
            const s = S(); delete s.teams; delete s.schedule; delete s.byes;
            await adminSave(s, true, 'Teams aufgelöst – Anmeldung wieder offen');
          } }, 'Teams auflösen'))));
    }
    main.append(el('div', { class: 'center' }, el('button', { class: 'link', onclick: () => { logout(); render(); } }, 'Leitung abmelden')));
  }

  function qrSvg(text, cell) {
    if (typeof window.qrcode !== 'function') return null;
    const q = window.qrcode(0, 'M');
    q.addData(text); q.make();
    // GIF als data:-URL (bleibt komplett lokal im Browser)
    return el('div', { class: 'qr' }, el('img', { src: q.createDataURL(cell || 6, 2), alt: 'QR-Code: ' + text }));
  }

  function renderQrCard(main) {
    const url = signupUrl();
    const teamsDone = (S().teams || []).length > 0;
    main.append(el('section', { class: 'card' },
      el('h2', null, '📱 QR-Code zur Anmeldung'),
      el('p', { class: 'muted small' }, teamsDone
        ? 'Die Teams sind ausgelost – Anmeldung ist geschlossen. Über den Code kommen alle trotzdem auf die Turnierseite.'
        : 'Gäste scannen den Code, tragen ihren Namen ein und schätzen sich selbst ein. Du kannst die Stärke unten anpassen.'),
      el('div', { class: 'qrbox' }, qrSvg(url, 5) || el('p', null, url)),
      el('div', { class: 'center small' }, el('a', { href: url }, url)),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => showQrFull(url) }, 'Groß anzeigen'),
        navigator.share ? el('button', { class: 'btn ghost', onclick: () => navigator.share({ title: S().title, url }).catch(() => {}) }, 'Link teilen') : null)));
  }

  function showQrFull(url) {
    const dlg = $('#dlg');
    dlg.replaceChildren(el('div', { class: 'dlgin center qrfull' },
      el('h2', null, '🏓 ' + S().title),
      el('p', null, 'Scannen & anmelden!'),
      qrSvg(url, 10),
      el('p', { class: 'muted small' }, url),
      el('button', { class: 'btn ghost', onclick: () => dlg.close() }, 'Schließen')));
    dlg.showModal();
  }

  async function adminPlayer(action, player) {
    try {
      state.adminPlayers = await backend.adminPlayers(state.pin, action, player);
      await refresh(true);
      return true;
    } catch (e) {
      if (/pin/i.test(e.message)) logout();
      toast(niceErr(e), true); render();
      return false;
    }
  }

  function renderPlayersAdmin(main) {
    const list = el('div', { class: 'plist' });
    const ap = state.adminPlayers;
    const inTeam = new Set((S().teams || []).flatMap(t => t.members));
    ap.forEach(p => {
      const out = el('output', { class: 'sval' }, p.skill);
      const name = el('input', { class: 'in name', value: p.name, maxlength: 30,
        onchange: e => { if (e.target.value.trim() && e.target.value !== p.name) adminPlayer('upsert', Object.assign({}, p, { name: e.target.value })); } });
      list.append(el('div', { class: 'prow2' + (p.active ? '' : ' off') },
        el('input', { type: 'checkbox', title: 'ist da / spielt mit', checked: p.active,
          onchange: e => adminPlayer('upsert', Object.assign({}, p, { active: e.target.checked })).then(render) }),
        name,
        el('input', { type: 'range', min: 1, max: 10, step: 1, value: p.skill, 'aria-label': 'Spielstärke ' + p.name,
          oninput: e => { out.textContent = e.target.value; },
          onchange: e => adminPlayer('upsert', Object.assign({}, p, { skill: +e.target.value })) }),
        out,
        el('button', { class: 'x', title: 'entfernen', onclick: () => {
          if (inTeam.has(p.id) && !confirm(p.name + ' ist schon in einem Team. Trotzdem entfernen?')) return;
          if (!inTeam.has(p.id) && !confirm(p.name + ' entfernen?')) return;
          adminPlayer('delete', { id: p.id }).then(render);
        } }, '×')));
    });
    const newName = el('input', { class: 'in', placeholder: 'Spieler ohne Handy hinzufügen …' });
    const add = async () => {
      const names = newName.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      for (const n of names) if (!(await adminPlayer('upsert', { name: n, skill: 5, active: true }))) break;
      render();
      setTimeout(() => { const f = $('#main .addrow input'); if (f) f.focus(); }, 0);
    };
    newName.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    const active = ap.filter(p => p.active);
    const d = settingsDraft();
    main.append(el('section', { class: 'card' },
      el('h2', null, 'Spieler (' + active.length + ' spielen mit)'),
      el('p', { class: 'muted small' }, 'Häkchen = spielt mit. Regler = Spielstärke 1–10 (Selbsteinschätzung, von dir anpassbar; sieht nur die Leitung). Neue Anmeldungen erscheinen automatisch.'),
      ap.length ? list : el('p', { class: 'muted' }, 'Noch niemand angemeldet.'),
      el('div', { class: 'row addrow' }, newName, el('button', { class: 'btn ghost', onclick: add }, 'Hinzufügen')),
      el('div', { class: 'row' },
        el('button', { class: 'btn wide', disabled: active.length < 2, onclick: () => {
          state.preview = TT.buildTeams(active, d.teamSize); state.swapSel = null; render();
          setTimeout(() => { const p = $('#preview'); if (p) p.scrollIntoView({ behavior: 'smooth' }); }, 0);
        } }, '⚖️ Ausgeglichene Teams bilden (' + TT.teamSizes(active.length, d.teamSize).length + ' Teams)'))));
  }

  function renderPreview(main) {
    if (!state.preview) return;
    const sk = id => { const p = state.adminPlayers.find(x => x.id === id); return p ? p.skill : 0; };
    const avg = t => t.members.reduce((s, id) => s + sk(id), 0) / t.members.length;
    const avgs = state.preview.map(avg);
    const grid = el('div', { class: 'grid' });
    state.preview.forEach((t, ti) => {
      grid.append(el('div', { class: 'card team' },
        el('div', { class: 'tnum' }, 'Team ' + (ti + 1)),
        t.members.map((id, mi) => el('button', {
          class: 'tplayer chip' + (state.swapSel && state.swapSel[0] === ti && state.swapSel[1] === mi ? ' sel' : ''),
          onclick: () => swapClick(ti, mi),
        }, playerName(id), el('span', { class: 'skill' }, sk(id)))),
        el('div', { class: 'muted small' }, 'Summe ' + t.members.reduce((s, id) => s + sk(id), 0) + ' · Ø ' + avg(t).toFixed(1))));
    });
    const d = settingsDraft();
    main.append(el('section', { class: 'card hl', id: 'preview' },
      el('h2', null, 'Vorschau: ' + state.preview.length + ' Teams'),
      el('p', { class: 'muted small' }, 'Unterschied stärkstes/schwächstes Team: ' + (Math.max(...avgs) - Math.min(...avgs)).toFixed(1) +
        ' Punkte im Schnitt. Zum Tauschen zwei Spieler aus verschiedenen Teams antippen.'),
      grid,
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => {
          state.preview = TT.buildTeams(state.adminPlayers.filter(p => p.active), d.teamSize); state.swapSel = null; render();
        } }, '🔀 Nochmal mischen'),
        el('button', { class: 'btn ghost', onclick: () => { state.preview = null; render(); } }, 'Verwerfen'),
        el('button', { class: 'btn', onclick: startTournament }, '✅ Übernehmen & Spielplan erstellen'))));
  }

  function settingsDraft() {
    if (!state.settings) {
      const s = S();
      state.settings = { title: s.title, teamSize: s.teamSize, tables: s.tables, bestOf: s.bestOf, finals: s.finals };
    }
    return state.settings;
  }

  function renderSettings(main) {
    const d = settingsDraft();
    const sel = (label, key, options) => el('label', { class: 'fld' }, el('span', null, label),
      el('select', { class: 'in', onchange: e => { d[key] = +e.target.value; render(); } },
        options.map(([v, t]) => el('option', { value: v, selected: d[key] === v }, t))));
    const started = (S().teams || []).length > 0;
    main.append(el('section', { class: 'card' },
      el('h2', null, 'Einstellungen'),
      el('label', { class: 'fld' }, el('span', null, 'Turniername'),
        el('input', { class: 'in', value: d.title, maxlength: 60, oninput: e => { d.title = e.target.value; } })),
      el('div', { class: 'grid2' },
        sel('Spieler pro Team', 'teamSize', [[1, 'Einzel (1)'], [2, 'Doppel (2)'], [3, '3er-Teams']]),
        sel('Platten', 'tables', [[1, '1 Platte'], [2, '2 Platten'], [3, '3 Platten'], [4, '4 Platten']]),
        sel('Spiellänge', 'bestOf', [[1, '1 Gewinnsatz'], [3, 'Best of 3 (2 Gewinnsätze)'], [5, 'Best of 5 (3 Gewinnsätze)']]),
        el('label', { class: 'fld check' }, el('input', { type: 'checkbox', checked: d.finals, onchange: e => { d.finals = e.target.checked; } }),
          el('span', null, 'Finale + Spiel um Platz 3'))),
      started ? el('p', { class: 'muted small' }, '„Spieler pro Team“ wirkt erst bei der nächsten Auslosung.') : null,
      el('button', { class: 'btn ghost', onclick: () => {
        const s = Object.assign(S(), d, { title: (d.title || DEFAULTS.title).trim().slice(0, 60) });
        adminSave(s, false, 'Einstellungen gespeichert');
      } }, 'Einstellungen speichern')));
  }

  function swapClick(ti, mi) {
    const sel = state.swapSel;
    if (!sel) { state.swapSel = [ti, mi]; render(); return; }
    if (sel[0] === ti) { state.swapSel = sel[1] === mi ? null : [ti, mi]; render(); return; }
    const A = state.preview[sel[0]].members, B = state.preview[ti].members;
    [A[sel[1]], B[mi]] = [B[mi], A[sel[1]]];
    state.swapSel = null; render();
  }

  async function adminSave(setup, reset, msg, onlyResults) {
    try {
      if (onlyResults) {
        // Ergebnisse löschen, Teamnamen behalten
        for (const id of Object.keys(state.results)) await backend.setResult(id, null, null);
      } else {
        await backend.adminSave(state.pin, setup, reset);
      }
      toast(msg);
      state.settings = null;
      await refresh();
      return true;
    } catch (e) {
      if (/pin/i.test(e.message)) { logout(); render(); }
      toast('Fehler: ' + niceErr(e), true);
      return false;
    }
  }

  async function startTournament() {
    const hasResults = Object.keys(state.results).length > 0;
    if (hasResults && !confirm('Es gibt schon Ergebnisse. Neue Teams löschen alle bisherigen Ergebnisse und Teamnamen. Fortfahren?')) return;
    const d = settingsDraft();
    const setup = Object.assign(S(), d, { title: (d.title || DEFAULTS.title).trim().slice(0, 60) });
    delete setup.players;
    setup.teams = state.preview;
    const rr = TT.roundRobin(setup.teams.map(t => t.id));
    setup.schedule = rr.schedule; setup.byes = rr.byes;
    const ok = await adminSave(setup, true, 'Turnier gestartet – viel Spaß!');
    if (ok) { state.preview = null; state.tab = 'spiele'; render(); window.scrollTo(0, 0); }
  }

  // ------------------------------------------------------------ Start
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
    if (state.tab === 'leitung' && state.pin) refresh(true);
  }));
  render();
  refresh();
  setInterval(() => { if (!document.hidden) refresh(true); }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
})();
