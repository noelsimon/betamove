// BETAMOVE — gemeinsames JS für alle Seiten (Nav, Footer-Jahr, Chat-Widget-Optik,
// Accordion-Helfer). Kein Framework, keine Build-Schritte.

document.addEventListener('DOMContentLoaded', () => {
  // Mobiles Menü
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const isOpen = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      links.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }));
  }

  // Aktuelle Seite in der Navigation hervorheben (funktioniert mit und
  // ohne ".html" in der URL, da GitHub Pages beide Formen bedient).
  let here = location.pathname.split('/').pop() || '';
  here = /^index\.html$/i.test(here) ? '' : here.replace(/\.html$/i, '');
  document.querySelectorAll('[data-r="navlinks"] a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === here || (here === '' && href === '/')) {
      a.setAttribute('aria-current', 'page');
    }
  });

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Generische Accordion-Buttons: <button class="disclosure-btn" data-accordion-target="#id">
  document.querySelectorAll('[data-accordion-target]').forEach(btn => {
    const panel = document.querySelector(btn.getAttribute('data-accordion-target'));
    if (!panel) return;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
      const mark = btn.querySelector('.disclosure-mark');
      if (mark) mark.textContent = open ? '+' : '–';
    });
  });

  // Chat-Widget: regelbasierter Assistent (keine KI, kein Backend, keine Kosten).
  // Erkennt Stichworte in der Nutzereingabe und antwortet mit passenden,
  // fest hinterlegten Informationen zu Kursen, Material, Preisen etc.
  // Bewusst kein "Verstehen" freier Sprache — nur zuverlässiges Keyword-Matching.
  const chatFab = document.getElementById('chatFab');
  const chatPanel = document.getElementById('chatPanel');
  const chatClose = document.getElementById('chatClose');
  const chatList = document.getElementById('chatList');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  function chatSetOpen(open) {
    if (!chatPanel) return;
    chatPanel.hidden = !open;
    if (chatFab) chatFab.setAttribute('aria-expanded', String(open));
    if (open && chatInput) chatInput.focus();
  }
  if (chatFab) chatFab.addEventListener('click', () => chatSetOpen(chatPanel.hidden));
  if (chatClose) chatClose.addEventListener('click', () => chatSetOpen(false));

  function addChatMsg(text, role) {
    if (!chatList) return;
    const div = document.createElement('div');
    div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'bot');
    div.textContent = text;
    chatList.appendChild(div);
    chatList.scrollTop = chatList.scrollHeight;
  }

  function chatSend(text) {
    const value = (text !== undefined ? text : chatInput.value).trim();
    if (!value) return;
    addChatMsg(value, 'user');
    if (chatInput) chatInput.value = '';
    setTimeout(() => {
      addChatMsg(bmChatReply(value), 'bot');
    }, 350);
  }

  if (chatForm) {
    chatForm.addEventListener('submit', e => {
      e.preventDefault(); // Kein Server-Versand — die Antwort kommt clientseitig aus bmChatReply()
      chatSend();
    });
  }
  document.querySelectorAll('.chat-suggestions button').forEach(btn => {
    btn.addEventListener('click', () => chatSend(btn.textContent));
  });
});

// ============================================================================
// bmChatReply — regelbasierte Antwortlogik für das Chat-Widget
// ============================================================================
// Kein KI-Modell, keine Serveranfrage: reines Keyword-Matching gegen den
// tatsächlichen Kurskatalog (siehe kurse). Läuft komplett im Browser,
// verursacht keine laufenden Kosten. Wird der Kurskatalog auf kurse
// geändert (neuer Kurs, neuer Preis), bitte auch COURSES hier unten pflegen.
const COURSES = [
  {
    id: 'halle',
    name: 'Von der Halle an den Fels',
    level: 'Einstieg Fels',
    dauer: '2 Tage',
    preis: '75 €',
    kurz: 'Der Einstieg vom Hallen- ins Felsklettern: Vorsteigen und Sichern am Naturfels, Routenauswahl, Abbauen und Abseilen.',
    voraussetzung: 'Vorstieg klettern im 5. Grad in der Kletterhalle sowie Erfahrung im Vorstiegsichern (auch Stürze).',
    equipment: 'Helm, Gurt, Seil, Sicherungsgerät (Halbautomat oder Autotuber), Exen. Equipment kann ausgeliehen werden, bitte anfragen.',
    keywords: ['halle an den fels', 'halle-fels', 'von der halle', 'zum fels', 'naturfels', 'erster felskurs']
  },
  {
    id: 'msl',
    name: 'Mehrseillängen für Fortgeschrittene',
    level: 'Fortgeschritten',
    dauer: '2 Tage',
    preis: '169 €',
    kurz: 'Standplatzbau, behelfsmäßige Bergrettung und individuelles Feedback zu deinen Gewohnheiten in der Mehrseillänge.',
    voraussetzung: 'Erfahrung im Mehrseillängenklettern, Umgang mit dem Alpin-Tuber, Erfahrung im Abseilen.',
    equipment: 'Gurt, Halbseile, Alpin-Tuber, 5–10 Karabiner, Helm, Alpinexen, Reepschnur/Prusikschnur, Bandschlingen, Adjust. Kann teilweise ausgeliehen werden, bitte anfragen.',
    keywords: ['mehrseillänge', 'mehrseillaenge', 'msl', 'alpin', 'standplatz']
  },
  {
    id: 'mobil',
    name: 'Keile, Friends und Co. – Mobile Sicherung',
    level: 'Fortgeschritten',
    dauer: '1 Tag',
    preis: '149 €',
    kurz: 'Cams und Keile legen, testen und vertrauen lernen – inklusive Trainingsaufbau für dein eigenes Üben.',
    voraussetzung: 'Sicheres Vorstiegsklettern im 5. Grad am Naturfels, gute Sicherungspraxis.',
    equipment: 'Klettergurt, Helm, mobile Sicherungen (Cams, Keile), Einfachseil, Sicherungsgerät. Kann ausgeliehen werden, bitte anfragen.',
    keywords: ['mobile sicherung', 'cam', 'friend', 'keil', 'trad klettern', 'clean klettern']
  },
  {
    id: 'technik',
    name: 'Besser Klettern – Bewegungstechnik',
    level: 'Alle Level',
    dauer: '1 Tag',
    preis: '99 €',
    kurz: 'Bewegungsanalyse mit individuellem Feedback statt Schema F – wir finden heraus, was dich bremst.',
    voraussetzung: 'Ideal ab Bewegungserfahrung im 6. Grad, aber offen für alle Level – bei wenig Erfahrung bitte bei der Anmeldung angeben.',
    equipment: 'Gurt, Einfachseil, Sicherungsgerät, eventuell Reibungsassistent. Kann ausgeliehen werden, bitte anfragen.',
    keywords: ['bewegungstechnik', 'besser klettern', 'technik verbessern', 'bewegungsanalyse']
  },
  {
    id: 'update',
    name: 'Sicherungs-Update',
    level: 'Auffrischung',
    dauer: '3 Stunden',
    preis: '75 €',
    kurz: 'Aktuelle Lehrmeinung, Gewohnheiten-Check und Sicherungsmythen aufgedeckt – mit Zertifikat.',
    voraussetzung: 'Vorstieg klettern im 5. Grad in der Kletterhalle, Erfahrung im Vorstiegsichern.',
    equipment: 'Seil, Sicherungsgerät, Gurt. Kann ausgeliehen werden, bitte anfragen.',
    keywords: ['sicherungs-update', 'sicherungsupdate', 'auffrischung', 'lange nicht mehr geklettert', 'aktueller stand']
  },
  {
    id: 'sturz',
    name: 'Sturz- und Sicherungstraining',
    level: 'Alle Level',
    dauer: '3 Stunden',
    preis: '75 €',
    kurz: 'Weich sichern, Gewichtsunterschiede verstehen und Stürze ohne Verletzung erlernen.',
    voraussetzung: 'Vorstiegsichern (idealerweise bereits Stürze gehalten), Routine mit dem eigenen Sicherungsgerät.',
    equipment: 'Gurt, Seil, Sicherungsgerät (Halbautomat oder Autotuber). Kann ausgeliehen werden, bitte anfragen.',
    keywords: ['sturztraining', 'sturz', 'angst vorm stürzen', 'angst vorm sturz', 'weich sichern']
  }
];

function bmChatReply(raw) {
  const t = raw.toLowerCase();
  const has = (...words) => words.some(w => t.indexOf(w) > -1);

  function courseLine(c) {
    return c.name + ' (' + c.level + ', ' + c.dauer + ', ' + c.preis + ')';
  }
  function courseUrl() { return 'kurse'; }

  // 1) Konkreter Kurs + Material/Ausrüstungsfrage
  const materialFrage = has('material', 'ausrüstung', 'ausruestung', 'equipment', 'mitbringen', 'was brauche', 'brauche ich');
  const genannterKurs = COURSES.find(c => has(...c.keywords));
  if (materialFrage && genannterKurs) {
    return 'Für „' + genannterKurs.name + '“ brauchst du: ' + genannterKurs.equipment + '\n\nMehr Details findest du auf kurse unter „Alle Details“.';
  }

  // 2) Bildungsurlaub
  if (has('bildungsurlaub', 'bildungszeit', 'bildungsfreistellung', 'arbeitgeber bezahlt')) {
    return 'Bildungsurlaub ist gesetzlicher Extraurlaub für Weiterbildung, zusätzlich zum normalen Urlaub – geregelt pro Bundesland, entscheidend ist dein Arbeitsort. Unsere Wochenkurse (5 Tage, mind. 6 Unterrichtsstunden/Tag) erfüllen die üblichen Anforderungen der Landesgesetze. Alle Infos, den Anspruch je Bundesland und die Unterlagen für deinen Arbeitgeber findest du auf bildungsurlaub.';
  }

  // 3) Rabatt / Studierende / Azubis
  if (has('rabatt', 'ermäßig', 'ermaessig', 'vergünstig', 'verguenstig', 'student', 'azubi', 'auszubildende')) {
    return 'Studierende, Azubis, FSJler*innen und Menschen in vergleichbaren Bildungswegen bekommen bei uns vergünstigte Kursgebühren. Wichtig: das schon im Anmeldeformular angeben und zum Kurs einen gültigen Nachweis (z. B. Studi- oder Azubi-Ausweis) mitbringen — nur so kann der Rabatt gewährt werden.';
  }

  // 4) Neu / Anfänger / Einsteiger / allgemeine Kursempfehlung
  const neuSignal = has('neu im klettern', 'neu beim klettern', 'anfänger', 'anfaenger', 'einsteiger', 'beginner', 'fange an zu klettern', 'will klettern lernen');
  const nullErfahrung = has('noch nie geklettert', 'noch nie', 'komplett neu', 'keine erfahrung', 'null erfahrung', 'zum ersten mal', 'erstes mal klettern', 'gar nicht geklettert');
  const hallenErfahrung = has('vorstieg', 'kletterhalle', 'in der halle', 'schon erfahrung', 'halle klettere', '5. grad', 'fünften grad');
  const empfehlungsFrage = has('kurs empfehlen', 'welcher kurs', 'welchen kurs', 'kurs passt', 'kurs würdest du', 'kurs wuerdest du', 'was empfiehlst du');
  if (neuSignal || nullErfahrung || empfehlungsFrage) {
    if (nullErfahrung && !hallenErfahrung) {
      return 'Ehrlich gesagt: Unsere aktuellen Kurse setzen etwas Vorerfahrung voraus (mindestens Vorstiegsklettern im 5. Grad in der Kletterhalle). Hast du noch nie geklettert, empfehlen wir dir zuerst ein paar Einheiten in einer Kletterhalle vor Ort, um Grundtechnik und Vorstieg zu lernen. Sobald du dort sicher im Vorstieg kletterst, ist „Von der Halle an den Fels“ (2 Tage, 75 €) genau dein nächster Schritt zu uns – meld dich dann gerne nochmal über kontakt.';
    }
    return 'Kletterst du schon im Vorstieg in der Kletterhalle, ist „Von der Halle an den Fels“ dein perfekter Einstieg bei uns (2 Tage, 75 €, Klettergarten um Leipzig) – der Klassiker für alle, die von drinnen nach draußen wollen. Hast du dagegen noch gar keine Klettererfahrung, empfehlen wir dir zuerst ein paar Einheiten in einer Kletterhalle, bevor unsere Kurse Sinn ergeben. Details und Anmeldung: kurse.';
  }

  // 5) Sicherungs-Update / Auffrischung
  const updateCourse = COURSES.find(c => c.id === 'update');
  if (has(...updateCourse.keywords)) {
    return updateCourse.kurz + ' (' + updateCourse.dauer + ', ' + updateCourse.preis + '). Voraussetzung: ' + updateCourse.voraussetzung + ' Mehr auf kurse.';
  }

  // 6) Sturz / Angst
  const sturzCourse = COURSES.find(c => c.id === 'sturz');
  if (has(...sturzCourse.keywords)) {
    return sturzCourse.kurz + ' (' + sturzCourse.dauer + ', ' + sturzCourse.preis + '). Voraussetzung: ' + sturzCourse.voraussetzung + ' Mehr auf kurse.';
  }

  // 7) Mobile Sicherung / Cams
  const mobilCourse = COURSES.find(c => c.id === 'mobil');
  if (has(...mobilCourse.keywords)) {
    return mobilCourse.kurz + ' (' + mobilCourse.dauer + ', ' + mobilCourse.preis + '). Voraussetzung: ' + mobilCourse.voraussetzung + ' Mehr auf kurse.';
  }

  // 8) Bewegungstechnik
  const technikCourse = COURSES.find(c => c.id === 'technik');
  if (has(...technikCourse.keywords)) {
    return technikCourse.kurz + ' (' + technikCourse.dauer + ', ' + technikCourse.preis + '). Offen für alle Level. Mehr auf kurse.';
  }

  // 9) Mehrseillängen (ohne "neu", s.o.)
  const mslCourse = COURSES.find(c => c.id === 'msl');
  if (has(...mslCourse.keywords)) {
    return mslCourse.kurz + ' (' + mslCourse.dauer + ', ' + mslCourse.preis + '). Voraussetzung: ' + mslCourse.voraussetzung + ' Mehr auf kurse.';
  }

  // 10) Irgendein anderer Kurs beim Namen genannt (allgemeine Infofrage)
  if (genannterKurs) {
    return genannterKurs.kurz + ' (' + genannterKurs.dauer + ', ' + genannterKurs.preis + '). Voraussetzung: ' + genannterKurs.voraussetzung + ' Mehr auf kurse.';
  }

  // 11) Preise generell
  if (has('preis', 'kosten', 'wie teuer', 'was kostet')) {
    return 'Unsere Kurspreise im Überblick:\n' + COURSES.map(c => '• ' + courseLine(c)).join('\n') + '\n\nStudierende und Azubis bekommen Rabatt (Nachweis vor Ort). Alle Details: kurse.';
  }

  // 12) Termine generell
  if (has('termin', 'wann ist', 'nächste kurs', 'naechste kurs', 'wann findet')) {
    return '„Von der Halle an den Fels“ hat feste Termine (aktuell 06.–07.06.2026), das „Sicherungs-Update“ ebenfalls (16.01.2027). Die anderen Kurse sind „Termin auf Anfrage“ – wir stimmen den Termin individuell mit dir ab. Aktuelle Termine und Buchung: kurse bzw. direkt anmeldung.';
  }

  // 13) Kontakt / Team
  if (has('kontakt', 'team', 'wer seid ihr', 'anrufen', 'telefon', 'email', 'e-mail')) {
    return 'Am schnellsten erreichst du uns über das Kontaktformular auf kontakt oder per E-Mail an info@betamove.de. Wer hinter BETAMOVE steckt, siehst du auf team.';
  }

  // 14) Reine Begrüßung
  if (/\b(hallo|hi|hey|moin|servus)\b/.test(t) && t.length < 20) {
    return 'Hi! Frag mich zum Beispiel nach einer Kursempfehlung, nötigem Material, Preisen oder Bildungsurlaub – oder schau direkt auf kurse vorbei.';
  }

  // 15) Fallback
  return 'Dazu habe ich noch keine feste Antwort — ich bin ein einfacher Regel-Assistent, kein freies KI-System. Schau gerne auf kurse oder wissen vorbei, oder schreib uns direkt über kontakt, dann meldet sich ein Mensch bei dir.';
}

// Kleine gemeinsame Hilfsfunktion für Lernfortschritt (Wissensplattform),
// bewusst nur im Browser gespeichert — ohne Konto/Backend.
const bmProgress = {
  key: 'betamove-progress',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch (e) { return {}; }
  },
  // kind/opts sind optional: Artikel-Seiten rufen einfach markDone(id) auf
  // (Standard: kind "artikel"). Quiz- und Prüfungsseiten übergeben zusätzlich
  // kind: "quiz"/"pruefung" und opts: {score, total, passed}, damit im Konto
  // (falls eingeloggt) das echte Ergebnis landet statt nur "erledigt".
  markDone(id, kind, opts) {
    try {
      const data = this.read();
      data[id] = true;
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) { /* localStorage kann in Privat-Modus fehlschlagen — dann bleibt es unmarkiert */ }
    // Zusätzlich mit dem Konto synchronisieren, falls eingeloggt (js/account.js).
    // Ohne Konto passiert hier nichts — rein lokal wie bisher.
    try { if (window.bmSyncLernfortschritt) window.bmSyncLernfortschritt(id, kind || 'artikel', opts); } catch (e) {}
  },
  isDone(id) {
    return !!this.read()[id];
  }
};
