// Tischtennis-Turnier (turnier.html) — Logik + Oberfläche, ohne Build-Schritt.
//
// Datenhaltung: Supabase-Tabelle `turnier` (siehe supabase/schema-turnier.sql).
//   setup   = { title, teamSize, tables, bestOf, finals, players:[{id,name,skill,active}],
//               teams:[{id,members:[playerId]}], schedule:[{id,round,a,b}], byes:{round:teamId} }
//   results = { matchId: {a, b, at} }   (a/b = gewonnene Sätze von Team a/b)
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
      try { return JSON.parse(localStorage.getItem(KEY)) || { setup: {}, results: {} }; }
      catch (e) { return { setup: {}, results: {} }; }
    };
    const write = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* egal */ } };
    return {
      async load() { const d = read(); return { setup: d.setup || {}, results: d.results || {} }; },
      async setResult(id, a, b) {
        const d = read();
        if (a == null) delete d.results[id]; else d.results[id] = { a, b, at: new Date().toISOString() };
        write(d);
      },
      async adminSave(pin, setup, reset) {
        if (pin !== 'demo') throw new Error('falsche PIN');
        const d = read();
        if (setup) { d.setup = setup; if (reset) d.results = {}; write(d); }
        return true;
      },
    };
  }

  function supabaseBackend() {
    const res = window.bmGetSupabaseClient ? window.bmGetSupabaseClient() : { client: null, error: 'sdk_missing' };
    if (!res.client) return null;
    const db = res.client;
    const err = e => new Error((e && (e.message || e.details)) || 'Verbindungsfehler');
    return {
      async load() {
        const { data, error } = await db.from('turnier').select('setup,results,updated_at').eq('id', TURNIER_ID).maybeSingle();
        if (error) throw err(error);
        if (!data) throw new Error('not_found');
        return { setup: data.setup || {}, results: data.results || {} };
      },
      async setResult(id, a, b) {
        const { error } = await db.rpc('turnier_ergebnis_setzen', { p_turnier: TURNIER_ID, p_match: id, p_a: a, p_b: b });
        if (error) throw err(error);
      },
      async adminSave(pin, setup, reset) {
        const { error } = await db.rpc('turnier_admin_speichern', {
          p_turnier: TURNIER_ID, p_pin: pin, p_setup: setup, p_reset_results: !!reset,
        });
        if (error) throw err(error);
        return true;
      },
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
      else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  };

  const state = {
    setup: {}, results: {}, loaded: false, error: null,
    tab: 'spiele',
    pin: sessionGet('turnier-pin'),
    draft: null,        // Admin: bearbeitete Spielerliste + Einstellungen
    preview: null,      // Admin: Vorschau neu gebildeter Teams
    swapSel: null,      // Admin: ausgewählter Spieler zum Tauschen
    busy: false,
  };

  function sessionGet(k) { try { return sessionStorage.getItem(k + TURNIER_ID); } catch (e) { return null; } }
  function sessionSet(k, v) { try { v == null ? sessionStorage.removeItem(k + TURNIER_ID) : sessionStorage.setItem(k + TURNIER_ID, v); } catch (e) { /* egal */ } }

  const DEFAULTS = { title: 'Geburtstags-Turnier', teamSize: 2, tables: 2, bestOf: 3, finals: true };
  const S = () => Object.assign({}, DEFAULTS, state.setup);

  function playerMap(setup) {
    const m = {};
    (setup.players || []).forEach(p => { m[p.id] = p; });
    return m;
  }
  function teamName(setup, teamId) {
    const t = (setup.teams || []).find(x => x.id === teamId);
    if (!t) return '?';
    const pm = playerMap(setup);
    return t.members.map(id => (pm[id] ? pm[id].name : '?')).join(' & ');
  }
  function teamAvg(setup, members) {
    const pm = playerMap(setup);
    const s = members.map(id => (pm[id] ? pm[id].skill : 0));
    return { sum: s.reduce((a, b) => a + b, 0), avg: s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0 };
  }

  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
  }

  async function refresh(silent) {
    if (!backend) { state.error = 'Keine Datenbank-Verbindung konfiguriert.'; render(); return; }
    try {
      const d = await backend.load();
      const changed = JSON.stringify(d) !== JSON.stringify({ setup: state.setup, results: state.results });
      state.setup = d.setup; state.results = d.results; state.error = null; state.loaded = true;
      $('#live').textContent = 'Live · ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      $('#live').classList.remove('off');
      if (changed || !silent) render();
    } catch (e) {
      state.loaded = true;
      state.error = e.message === 'not_found'
        ? 'Das Turnier „' + TURNIER_ID + '“ ist noch nicht angelegt (supabase/schema-turnier.sql ausführen).'
        : 'Keine Verbindung zur Datenbank: ' + e.message;
      $('#live').textContent = 'Offline';
      $('#live').classList.add('off');
      if (!silent) render();
    }
  }

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

  function noTeamsYet(main) {
    main.append(el('div', { class: 'card center empty' },
      el('div', { class: 'big' }, '🏓'),
      el('h2', null, 'Die Teams werden am Tag ausgelost'),
      el('p', { class: 'muted' }, 'Sobald die Turnierleitung die Teams gebildet hat, stehen hier Spielplan, nächste Spiele und Tabelle.')));
  }

  function matchCard(setup, m, opts) {
    const r = state.results[m.id];
    const nameA = teamName(setup, m.a), nameB = teamName(setup, m.b);
    const winA = r && r.a > r.b, winB = r && r.b > r.a;
    return el('button', { class: 'match' + (r ? ' done' : '') + (opts && opts.hot ? ' hot' : ''), onclick: () => openScore(m) },
      el('div', { class: 'mmeta' },
        opts && opts.table ? el('span', { class: 'pill' }, 'Platte ' + opts.table) : null,
        el('span', null, m.label || ('Runde ' + m.round))),
      el('div', { class: 'mrow' },
        el('span', { class: 'mteam' + (winA ? ' win' : '') }, nameA),
        el('span', { class: 'mscore' }, r ? r.a + ' : ' + r.b : 'vs'),
        el('span', { class: 'mteam right' + (winB ? ' win' : '') }, nameB)),
      !r ? el('div', { class: 'mhint' }, 'Tippen, um das Ergebnis einzutragen') : null);
  }

  function renderGames(main) {
    const setup = S();
    if (!(setup.teams || []).length) return noTeamsYet(main);
    const { now, later } = TT.nextMatches(setup, state.results);
    const podium = TT.podium(setup, state.results);

    if (podium) {
      const medals = ['🥇', '🥈', '🥉'];
      main.append(el('section', { class: 'card podium' },
        el('h2', null, '🏆 Turnier beendet!'),
        podium.slice(0, 3).map((t, i) => el('div', { class: 'prow p' + i }, el('span', { class: 'medal' }, medals[i]), teamName(setup, t)))));
    }

    if (now.length) {
      main.append(el('h2', { class: 'sec' }, 'Jetzt spielen'));
      now.forEach((m, i) => main.append(matchCard(setup, m, { hot: true, table: setup.tables > 1 || now.length > 1 ? i + 1 : null })));
    }
    if (later.length) {
      main.append(el('h2', { class: 'sec' }, 'Als Nächstes'));
      later.slice(0, 4).forEach(m => main.append(matchCard(setup, m)));
      if (later.length > 4) main.append(el('p', { class: 'muted small' }, '… und ' + (later.length - 4) + ' weitere Spiele.'));
    }
    if (!TT.groupDone(setup, state.results) && setup.finals && setup.teams.length >= 3) {
      main.append(el('p', { class: 'muted small' },
        'Nach der Gruppenphase: ' + (setup.teams.length >= 4 ? 'Spiel um Platz 3 (3. gegen 4.) und ' : '') + 'Finale (1. gegen 2.).'));
    }

    const byRound = {};
    TT.allMatches(setup, state.results).forEach(m => { (byRound[m.round] = byRound[m.round] || []).push(m); });
    const played = TT.allMatches(setup, state.results).filter(m => state.results[m.id]);
    const det = el('details', { class: 'plan' }, el('summary', null, 'Kompletter Spielplan (' + played.length + '/' + TT.allMatches(setup, state.results).length + ' gespielt)'));
    Object.keys(byRound).forEach(r => {
      det.append(el('h3', null, r === 'F' ? 'Finalspiele' : 'Runde ' + r,
        setup.byes && setup.byes[r] ? el('span', { class: 'muted small' }, ' · Pause: ' + teamName(setup, setup.byes[r])) : null));
      byRound[r].forEach(m => det.append(matchCard(setup, m)));
    });
    main.append(det);
  }

  function renderTable(main) {
    const setup = S();
    if (!(setup.teams || []).length) return noTeamsYet(main);
    const st = TT.standings(setup, state.results);
    const podium = TT.podium(setup, state.results);
    const tbl = el('table', { class: 'tbl' },
      el('thead', null, el('tr', null,
        el('th', null, '#'), el('th', { class: 'l' }, 'Team'), el('th', null, 'Sp'),
        el('th', null, 'S'), el('th', null, 'N'), el('th', null, 'Sätze'), el('th', null, '+/−'))),
      el('tbody', null, st.map((r, i) => el('tr', { class: i < 2 && setup.finals ? 'top' : null },
        el('td', null, i + 1), el('td', { class: 'l' }, teamName(setup, r.team)), el('td', null, r.played),
        el('td', null, el('b', null, r.won)), el('td', null, r.lost),
        el('td', null, r.setsFor + ':' + r.setsAgainst),
        el('td', null, (r.setsFor - r.setsAgainst > 0 ? '+' : '') + (r.setsFor - r.setsAgainst))))));
    main.append(el('h2', { class: 'sec' }, 'Tabelle Gruppenphase'), el('div', { class: 'card flush' }, tbl),
      el('p', { class: 'muted small' }, 'Reihenfolge: Siege, dann Satzdifferenz, dann gewonnene Sätze, dann direkter Vergleich.' +
        (setup.finals && setup.teams.length >= 3 ? ' Die ersten zwei spielen das Finale.' : '')));
    if (podium) {
      main.append(el('h2', { class: 'sec' }, 'Endstand'),
        el('ol', { class: 'card final' }, podium.map(t => el('li', null, teamName(setup, t)))));
    }
  }

  function renderTeams(main) {
    const setup = S();
    if (!(setup.teams || []).length) return noTeamsYet(main);
    const pm = playerMap(setup);
    const admin = !!state.pin;
    main.append(el('h2', { class: 'sec' }, 'Teams'));
    const grid = el('div', { class: 'grid' });
    setup.teams.forEach((t, i) => {
      const a = teamAvg(setup, t.members);
      grid.append(el('div', { class: 'card team' },
        el('div', { class: 'tnum' }, 'Team ' + (i + 1)),
        t.members.map(id => el('div', { class: 'tplayer' }, pm[id] ? pm[id].name : '?',
          admin && pm[id] ? el('span', { class: 'skill' }, pm[id].skill) : null)),
        admin ? el('div', { class: 'muted small' }, 'Ø Stärke ' + a.avg.toFixed(1)) : null));
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
    const dlg = $('#dlg');
    const nameA = teamName(setup, m.a), nameB = teamName(setup, m.b);
    const save = async (a, b) => {
      if (state.busy) return;
      if (r && a != null && !confirm('Für dieses Spiel steht schon ' + r.a + ':' + r.b + '. Überschreiben?')) return;
      if (a == null && !confirm('Ergebnis wirklich löschen?')) return;
      state.busy = true;
      try {
        await backend.setResult(m.id, a, b);
        dlg.close();
        toast(a == null ? 'Ergebnis gelöscht' : 'Gespeichert: ' + a + ':' + b);
        await refresh();
      } catch (e) { toast('Speichern fehlgeschlagen: ' + e.message, true); }
      finally { state.busy = false; }
    };
    const scores = TT.validScores(setup.bestOf);
    dlg.replaceChildren(el('form', { method: 'dialog', class: 'dlgin' },
      el('div', { class: 'muted small' }, (m.label || 'Runde ' + m.round) + ' · gewonnene Sätze (Best of ' + setup.bestOf + ')'),
      el('div', { class: 'dteams' }, el('b', null, nameA), el('span', { class: 'muted' }, 'gegen'), el('b', null, nameB)),
      el('div', { class: 'scores' }, scores.map(([a, b]) =>
        el('button', { type: 'button', class: 'sbtn' + (r && r.a === a && r.b === b ? ' cur' : ''), onclick: () => save(a, b) },
          el('span', { class: 'sn' }, a + ' : ' + b),
          el('span', { class: 'sw' }, (a > b ? nameA : nameB) + ' gewinnt')))),
      el('div', { class: 'drow' },
        r ? el('button', { type: 'button', class: 'link bad', onclick: () => save(null, null) }, 'Ergebnis löschen') : el('span'),
        el('button', { class: 'btn ghost', value: 'cancel' }, 'Abbrechen'))));
    dlg.showModal();
  }

  // ------------------------------------------------------- Turnierleitung
  function ensureDraft() {
    if (state.draft) return;
    const s = S();
    state.draft = {
      title: s.title, teamSize: s.teamSize, tables: s.tables, bestOf: s.bestOf, finals: s.finals,
      players: (s.players || []).map(p => Object.assign({ active: true }, p)),
    };
  }

  function renderAdmin(main) {
    if (!state.pin) {
      const inp = el('input', { type: 'password', inputmode: 'text', autocomplete: 'current-password', placeholder: 'PIN', class: 'in' });
      const login = async () => {
        const pin = inp.value.trim();
        if (!pin) return;
        try {
          await backend.adminSave(pin, null, false);
          state.pin = pin; sessionSet('turnier-pin', pin); state.draft = null; render();
        } catch (e) { toast(/pin/i.test(e.message) ? 'Falsche PIN' : 'Fehler: ' + e.message, true); }
      };
      main.append(el('div', { class: 'card' },
        el('h2', null, 'Turnierleitung'),
        el('p', { class: 'muted' }, 'Spieler, Spielstärken und Teams kann nur die Turnierleitung ändern. Ergebnisse eintragen darf jeder – dafür einfach im Tab „Spiele“ auf ein Spiel tippen.'),
        el('div', { class: 'row' }, inp, el('button', { class: 'btn', onclick: login }, 'Anmelden'))));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
      return;
    }
    ensureDraft();
    const d = state.draft;
    const active = d.players.filter(p => p.active && p.name.trim());

    // Einstellungen
    const sel = (label, key, options) => el('label', { class: 'fld' }, el('span', null, label),
      el('select', { class: 'in', onchange: e => { d[key] = isNaN(+e.target.value) ? e.target.value : +e.target.value; render(); } },
        options.map(([v, t]) => el('option', { value: v, selected: d[key] === v }, t))));
    main.append(el('section', { class: 'card' },
      el('div', { class: 'between' }, el('h2', null, 'Einstellungen'),
        el('button', { class: 'link', onclick: () => { state.pin = null; sessionSet('turnier-pin', null); render(); } }, 'Abmelden')),
      el('label', { class: 'fld' }, el('span', null, 'Turniername'),
        el('input', { class: 'in', value: d.title, oninput: e => { d.title = e.target.value; } })),
      el('div', { class: 'grid2' },
        sel('Spieler pro Team', 'teamSize', [[1, 'Einzel (1)'], [2, 'Doppel (2)'], [3, '3er-Teams']]),
        sel('Platten', 'tables', [[1, '1 Platte'], [2, '2 Platten'], [3, '3 Platten'], [4, '4 Platten']]),
        sel('Spiellänge', 'bestOf', [[1, '1 Gewinnsatz'], [3, 'Best of 3'], [5, 'Best of 5']]),
        el('label', { class: 'fld check' }, el('input', { type: 'checkbox', checked: d.finals, onchange: e => { d.finals = e.target.checked; } }),
          el('span', null, 'Finale + Spiel um Platz 3')))));

    // Spieler
    const list = el('div', { class: 'plist' });
    d.players.forEach((p, i) => {
      const out = el('output', { class: 'sval' }, p.skill);
      list.append(el('div', { class: 'prow2' + (p.active ? '' : ' off') },
        el('input', { type: 'checkbox', title: 'ist da', checked: p.active, onchange: e => { p.active = e.target.checked; render(); } }),
        el('input', { class: 'in name', value: p.name, placeholder: 'Name', oninput: e => { p.name = e.target.value; } }),
        el('input', { type: 'range', min: 1, max: 10, step: 1, value: p.skill, 'aria-label': 'Spielstärke',
          oninput: e => { p.skill = +e.target.value; out.textContent = p.skill; } }),
        out,
        el('button', { class: 'x', title: 'entfernen', onclick: () => { d.players.splice(i, 1); render(); } }, '×')));
    });
    const newName = el('input', { class: 'in', placeholder: 'Neuer Spieler …' });
    const add = () => {
      const names = newName.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      names.forEach(n => d.players.push({ id: TT.uid(), name: n.slice(0, 30), skill: 5, active: true }));
      render();
      setTimeout(() => { const f = $('#main .addrow input'); if (f) f.focus(); }, 0);
    };
    newName.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    main.append(el('section', { class: 'card' },
      el('h2', null, 'Spieler (' + active.length + ' dabei)'),
      el('p', { class: 'muted small' }, 'Häkchen = ist heute da. Regler = Spielstärke 1 (Anfänger) bis 10 (Profi). Die Stärken sieht nur die Turnierleitung.'),
      list,
      el('div', { class: 'row addrow' }, newName, el('button', { class: 'btn ghost', onclick: add }, 'Hinzufügen')),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', onclick: () => saveSetup(false) }, 'Nur speichern'),
        el('button', { class: 'btn', disabled: active.length < 2, onclick: () => { state.preview = TT.buildTeams(active, d.teamSize); state.swapSel = null; render(); } },
          '⚖️ Ausgeglichene Teams bilden'))));

    // Vorschau
    if (state.preview) {
      const fake = { players: d.players };
      const pm = playerMap(fake);
      const avgs = state.preview.map(t => teamAvg(fake, t.members).avg);
      const spread = Math.max(...avgs) - Math.min(...avgs);
      const grid = el('div', { class: 'grid' });
      state.preview.forEach((t, ti) => {
        const a = teamAvg(fake, t.members);
        grid.append(el('div', { class: 'card team' },
          el('div', { class: 'tnum' }, 'Team ' + (ti + 1)),
          t.members.map((id, mi) => el('button', {
            class: 'tplayer chip' + (state.swapSel && state.swapSel[0] === ti && state.swapSel[1] === mi ? ' sel' : ''),
            onclick: () => swapClick(ti, mi),
          }, pm[id] ? pm[id].name : '?', el('span', { class: 'skill' }, pm[id] ? pm[id].skill : ''))),
          el('div', { class: 'muted small' }, 'Summe ' + a.sum + ' · Ø ' + a.avg.toFixed(1))));
      });
      main.append(el('section', { class: 'card hl' },
        el('h2', null, 'Vorschau: ' + state.preview.length + ' Teams'),
        el('p', { class: 'muted small' }, 'Unterschied stärkstes/schwächstes Team: ' + spread.toFixed(1) +
          ' Punkte im Schnitt. Zum Tauschen zwei Spieler aus verschiedenen Teams antippen.'),
        grid,
        el('div', { class: 'row' },
          el('button', { class: 'btn ghost', onclick: () => { state.preview = TT.buildTeams(active, d.teamSize); state.swapSel = null; render(); } }, '🔀 Nochmal mischen'),
          el('button', { class: 'btn', onclick: startTournament }, '✅ Übernehmen & Spielplan erstellen'))));
    }

    // Ergebnisse zurücksetzen
    if ((S().teams || []).length) {
      main.append(el('section', { class: 'card' },
        el('h2', null, 'Gefahrenzone'),
        el('div', { class: 'row' },
          el('button', { class: 'btn danger', onclick: async () => {
            if (!confirm('Alle Ergebnisse löschen? Teams und Spielplan bleiben.')) return;
            await adminSave(S(), true, 'Ergebnisse gelöscht');
          } }, 'Alle Ergebnisse löschen'))));
    }
  }

  function swapClick(ti, mi) {
    const sel = state.swapSel;
    if (!sel) { state.swapSel = [ti, mi]; render(); return; }
    if (sel[0] === ti) { state.swapSel = sel[1] === mi ? null : [ti, mi]; render(); return; }
    const A = state.preview[sel[0]].members, B = state.preview[ti].members;
    [A[sel[1]], B[mi]] = [B[mi], A[sel[1]]];
    state.swapSel = null; render();
  }

  function setupFromDraft() {
    const d = state.draft, s = S();
    return Object.assign({}, s, {
      title: (d.title || DEFAULTS.title).slice(0, 60), teamSize: d.teamSize, tables: d.tables, bestOf: d.bestOf, finals: d.finals,
      players: d.players.filter(p => p.name.trim()).map(p => ({ id: p.id, name: p.name.trim().slice(0, 30), skill: p.skill, active: p.active })),
    });
  }

  async function adminSave(setup, reset, msg) {
    try {
      await backend.adminSave(state.pin, setup, reset);
      toast(msg);
      await refresh();
      return true;
    } catch (e) {
      if (/pin/i.test(e.message)) { state.pin = null; sessionSet('turnier-pin', null); render(); }
      toast('Fehler: ' + e.message, true);
      return false;
    }
  }

  async function saveSetup() {
    const ok = await adminSave(setupFromDraft(), false, 'Gespeichert');
    if (ok) { state.draft = null; render(); }
  }

  async function startTournament() {
    const hasResults = Object.keys(state.results).length > 0;
    if (hasResults && !confirm('Es gibt schon Ergebnisse. Neue Teams löschen alle bisherigen Ergebnisse. Fortfahren?')) return;
    const setup = setupFromDraft();
    setup.teams = state.preview;
    const rr = TT.roundRobin(setup.teams.map(t => t.id));
    setup.schedule = rr.schedule; setup.byes = rr.byes;
    const ok = await adminSave(setup, true, 'Turnier gestartet – viel Spaß!');
    if (ok) { state.preview = null; state.draft = null; state.tab = 'spiele'; render(); }
  }

  // ------------------------------------------------------------ Start
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
  }));
  render();
  refresh();
  setInterval(() => {
    // Nicht neu zeichnen, während jemand in der Turnierleitung tippt oder der Dialog offen ist
    if (document.hidden || $('#dlg').open) return;
    if (state.tab === 'leitung' && state.pin) return;
    refresh(true);
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
})();
