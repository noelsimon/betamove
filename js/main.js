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
// tatsächlichen Kurskatalog. Läuft komplett im Browser, verursacht keine
// laufenden Kosten. Die Kursdaten kommen aus js/courses-data.js (gemeinsame
// Quelle mit kurse und anmeldung) — hier nichts mehr doppelt pflegen.

function bmChatReply(raw) {
  const t = raw.toLowerCase();
  const has = (...words) => words.some(w => t.indexOf(w) > -1);
  const COURSES = window.BM_COURSES.filter(c => !c.isPaket);

  function courseLine(c) {
    return c.title + ' (' + c.level + ', ' + c.dauer + ', ' + window.BM_EUR(c.price) + ')';
  }

  // 1) Konkreter Kurs + Material/Ausrüstungsfrage
  const materialFrage = has('material', 'ausrüstung', 'ausruestung', 'equipment', 'mitbringen', 'was brauche', 'brauche ich');
  const genannterKurs = COURSES.find(c => has(...c.keywords));
  if (materialFrage && genannterKurs) {
    return 'Für „' + genannterKurs.title + '“ brauchst du: ' + genannterKurs.equipment.join(', ') + '.\n\nMehr Details findest du auf kurse unter „Alle Details“.';
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
    const halleCourse = COURSES.find(c => c.id === 'halle');
    if (nullErfahrung && !hallenErfahrung) {
      return 'Ehrlich gesagt: Unsere aktuellen Kurse setzen etwas Vorerfahrung voraus (mindestens Vorstiegsklettern im 5. Grad in der Kletterhalle). Hast du noch nie geklettert, empfehlen wir dir zuerst ein paar Einheiten in einer Kletterhalle vor Ort, um Grundtechnik und Vorstieg zu lernen. Sobald du dort sicher im Vorstieg kletterst, ist „' + halleCourse.title + '“ (' + halleCourse.dauer + ', ' + window.BM_EUR(halleCourse.price) + ') genau dein nächster Schritt zu uns – meld dich dann gerne nochmal über kontakt.';
    }
    return 'Kletterst du schon im Vorstieg in der Kletterhalle, ist „' + halleCourse.title + '“ dein perfekter Einstieg bei uns (' + halleCourse.dauer + ', ' + window.BM_EUR(halleCourse.price) + ', ' + halleCourse.ort + ') – der Klassiker für alle, die von drinnen nach draußen wollen. Hast du dagegen noch gar keine Klettererfahrung, empfehlen wir dir zuerst ein paar Einheiten in einer Kletterhalle, bevor unsere Kurse Sinn ergeben. Details und Anmeldung: kurse.';
  }

  // 5) Sicherungs-Update / Auffrischung
  const updateCourse = COURSES.find(c => c.id === 'update');
  if (has(...updateCourse.keywords)) {
    return updateCourse.teaser + ' (' + updateCourse.dauer + ', ' + window.BM_EUR(updateCourse.price) + ', ' + updateCourse.date + '). Voraussetzung: ' + updateCourse.voraussetzungen.join(', ') + '. Mehr auf kurse.';
  }

  // 6) Sturz / Angst
  const sturzCourse = COURSES.find(c => c.id === 'sturz');
  if (has(...sturzCourse.keywords)) {
    return sturzCourse.teaser + ' (' + sturzCourse.dauer + ', ' + window.BM_EUR(sturzCourse.price) + ', ' + sturzCourse.date + '). Voraussetzung: ' + sturzCourse.voraussetzungen.join(', ') + '. Mehr auf kurse.';
  }

  // 7) Mobile Sicherung / Cams
  const mobilCourse = COURSES.find(c => c.id === 'mobil');
  if (has(...mobilCourse.keywords)) {
    return mobilCourse.teaser + ' (' + mobilCourse.dauer + ', ' + window.BM_EUR(mobilCourse.price) + '). Voraussetzung: ' + mobilCourse.voraussetzungen.join(', ') + '. Mehr auf kurse.';
  }

  // 8) Bewegungstechnik
  const technikCourse = COURSES.find(c => c.id === 'technik');
  if (has(...technikCourse.keywords)) {
    return technikCourse.teaser + ' (' + technikCourse.dauer + ', ' + window.BM_EUR(technikCourse.price) + ', ' + technikCourse.date + '). Offen für alle Level. Mehr auf kurse.';
  }

  // 9) Mehrseillängen (ohne "neu", s.o.)
  const mslCourse = COURSES.find(c => c.id === 'msl');
  if (has(...mslCourse.keywords)) {
    return mslCourse.teaser + ' (' + mslCourse.dauer + ', ' + window.BM_EUR(mslCourse.price) + '). Voraussetzung: ' + mslCourse.voraussetzungen.join(', ') + '. Mehr auf kurse.';
  }

  // 10) Irgendein anderer Kurs beim Namen genannt (allgemeine Infofrage)
  if (genannterKurs) {
    return genannterKurs.teaser + ' (' + genannterKurs.dauer + ', ' + window.BM_EUR(genannterKurs.price) + '). Voraussetzung: ' + genannterKurs.voraussetzungen.join(', ') + '. Mehr auf kurse.';
  }

  // 11) Preise generell
  if (has('preis', 'kosten', 'wie teuer', 'was kostet')) {
    return 'Unsere Kurspreise im Überblick:\n' + COURSES.map(c => '• ' + courseLine(c)).join('\n') + '\n\nStudierende und Azubis bekommen Rabatt (Nachweis vor Ort). Alle Details: kurse.';
  }

  // 12) Termine generell — dynamisch aus den echten Kursdaten, damit die
  // Antwort nie wieder veraltet, wenn sich ein Termin ändert.
  if (has('termin', 'wann ist', 'nächste kurs', 'naechste kurs', 'wann findet')) {
    const terminiert = COURSES.filter(c => c.sortDate).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
    const ohneTermin = COURSES.filter(c => !c.sortDate);
    let antwort = 'Feste Termine: ' + terminiert.map(c => '„' + c.title + '“ (' + c.date + ')').join(', ') + '.';
    if (ohneTermin.length) antwort += ' Bei ' + ohneTermin.map(c => '„' + c.title + '“').join(' und ') + ' stimmen wir den Termin individuell mit dir ab.';
    antwort += ' Aktuelle Termine und Buchung: kurse bzw. direkt anmeldung.';
    return antwort;
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
