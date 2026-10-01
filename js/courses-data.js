// BETAMOVE — einzige Quelle für alle Kursdaten (Preise, Termine, Beschreibungen).
// Wird von kurse, anmeldung und dem Chatbot (js/main.js) gemeinsam genutzt.
// Ändert sich ein Kurs (neuer Termin, neuer Preis, neue Beschreibung), reicht
// eine Änderung hier — vorher standen dieselben Angaben an drei Stellen und
// liefen auseinander (das hat u.a. zu einem falschen Kurstermin geführt).
//
// sortDate: ISO-Datum (erster Termin) für die Sortierung "nächste Kurse zuerst".
// null = kein fester Termin ("Termin auf Anfrage") — solche Kurse stehen in
// der Terminliste immer ganz unten, unabhängig vom Filter.

window.BM_COURSES = [
  {
    id: 'halle',
    title: 'Von der Halle an den Fels',
    level: 'Einstieg Fels',
    dauer: '2 Tage',
    price: 75,
    img: 'kurs-halle.jpg',
    date: '06.06. – 07.06.2026',
    sortDate: '2026-06-06',
    ort: 'Klettergarten um Leipzig',
    teaser: 'Der Klassiker für alle, die aus der Halle raus wollen: Vorsteigen und Sichern am Naturfels, Routenauswahl, Abbauen und Abseilen.',
    beschreibung: 'Du hast bereits Klettererfahrungen in der Kletterhalle gesammelt und hast Lust, endlich draußen am Fels zu klettern? Dann solltest du auf jeden Fall diesen Kurs besuchen.',
    lernziel: 'Nach dem Kurs kannst du selbstständig in einem Klettergarten klettern und kennst alle wichtigen Techniken, um sicher nach oben sowie nach unten zu kommen.',
    inhalte: ['Vorsteigen und Sichern am Naturfels', 'Einhängen der Zwischensicherungen', 'Sinnvolle Fels- und Routenauswahl', 'Abbauen des Materials und Abseilen', 'Gefahrensituationen Outdoor'],
    voraussetzungen: ['Vorstieg klettern im 5. Grad in der Kletterhalle', 'Erfahrungen im Vorstieg sichern (auch bereits Stürze gesichert)'],
    equipment: ['Gurt', 'Seil', 'Sicherungsgerät (Halbautomat o. Autotuber)', 'Helm', 'Exen'],
    hinweis: 'Der Ort wird vor dem Kurs mitgeteilt. Vergünstigter Preis für Studierende und Azubis.',
    keywords: ['halle an den fels', 'halle-fels', 'von der halle', 'zum fels', 'naturfels', 'erster felskurs']
  },
  {
    id: 'msl',
    title: 'Mehrseillängen für Fortgeschrittene',
    level: 'Fortgeschritten',
    dauer: '2 Tage',
    price: 169,
    img: 'kurs-msl.jpg',
    date: 'Termin auf Anfrage',
    sortDate: null,
    ort: 'Wird vor dem Kurs mitgeteilt',
    teaser: 'Standplatzbau, behelfsmäßige Bergrettung und individuelles Feedback zu deinen Gewohnheiten in der Mehrseillänge.',
    beschreibung: 'Du besitzt bereits Erfahrung im Klettern von Mehrseillängen, hast ein gutes Handling mit dem Alpin-Tuber und kannst selbstständig einen Standplatz bauen? In diesem Kurs erweitern wir diese Fähigkeiten und schauen deine Gewohnheiten oder eventuelle Fehler genau an. Du lernst die Grundlagen der behelfsmäßigen Bergrettung, sodass du auch im Notfall reagieren kannst.',
    lernziel: 'Durch individuelles Feedback und die Einschätzung des Kletterlehrers kannst du deinen derzeitigen Wissensstand prüfen. Außerdem weißt du, woran du noch arbeiten kannst. Dazu erhältst du Grundkenntnisse in der behelfsmäßigen Bergrettung und erweiterte Fähigkeiten im Standplatzbau.',
    inhalte: ['Behelfsmäßige Bergrettung', 'Individuelles Feedback und aktuelle Lehrmeinung Mehrseillängen', 'Möglichst viel Praxis'],
    voraussetzungen: ['Erfahrungen beim Mehrseillängen klettern', 'Umgang mit Alpin-Tuber', 'Erfahrungen im Abseilen'],
    equipment: ['Gurt', 'Halbseile', 'Sicherungsgerät (Alpin-Tuber)', '5–10 Karabiner', 'Helm', 'Alpinexen', '5 m 6 mm Reepschnur und Prusikschnur', 'Bandschlinge (120 cm, 240 cm)', 'Adjust (Selbstsicherung)'],
    hinweis: 'BETAMOVE passt sich an die Gruppe an – die Lehrinhalte können sich dadurch etwas verschieben.',
    keywords: ['mehrseillänge', 'mehrseillaenge', 'msl', 'alpin', 'standplatz']
  },
  {
    id: 'mobil',
    title: 'Keile, Friends und Co. – Mobile Sicherung',
    level: 'Fortgeschritten',
    dauer: '1 Tag',
    price: 149,
    img: 'kurs-mobil.jpg',
    date: 'Termin auf Anfrage',
    sortDate: null,
    ort: 'Klettergebiet nach Absprache',
    teaser: 'Cams und Keile legen, testen und vertrauen lernen – inklusive Trainingsaufbau für dein eigenes Üben.',
    beschreibung: 'Du hast erste Erfahrungen mit mobilen Sicherungen gesammelt oder möchtest in das Thema einsteigen? In diesem Kurs lernst du den sicheren Umgang mit mobilen Sicherungsmitteln – mit besonderem Fokus auf Cams. Ziel ist es, ein fundiertes Verständnis zu entwickeln und Sicherheit beim Legen zu gewinnen. Zusätzlich bekommst du einen sinnvollen Trainingsaufbau an die Hand, mit dem du deine Fähigkeiten eigenständig weiterentwickeln kannst.',
    lernziel: 'Der Kurs vermittelt dir ein solides Gefühl für mobile Sicherungen – durch Wissen, Ausprobieren und Wiederholen. In einer sicheren Umgebung hast du die Möglichkeit, verschiedene Sicherungen zu testen und ein Gespür für ihre Zuverlässigkeit zu entwickeln. Nach dem Kurs bist du in der Lage, selbstständig am Fels mit mobilen Sicherungen zu klettern und Vertrauen in dein Material aufzubauen – auch im Falle eines Sturzes.',
    inhalte: ['Theoretische Grundlagen zu mobilen Sicherungen', 'Intensives Praxistraining im Legen von Cams und Keilen', 'Konkrete Übungen für dein eigenes Training', 'Optional: Einführung in die Rissklettertechnik (je nach Zeit)'],
    voraussetzungen: ['Sicheres Vorstiegsklettern im 5. Grad am Naturfels', 'Gute Sicherungspraxis beim Sichern von Kletternden'],
    equipment: ['Klettergurt', 'Helm', 'Mobile Sicherungen (Cams, Keile etc.)', 'Einfachseil', 'Sicherungsgerät (Autotuber oder Halbautomat)', 'Optional: Reibungsassistent (bei großem Gewichtsunterschied)'],
    hinweis: 'Leihmaterial kann bei Bedarf gestellt werden – bitte vorher anfragen.',
    keywords: ['mobile sicherung', 'cam', 'friend', 'keil', 'trad klettern', 'clean klettern']
  },
  {
    id: 'technik',
    title: 'Besser Klettern – Bewegungstechnik',
    level: 'Alle Level',
    levelBadge: 'Offen für alle',
    dauer: '1 Tag',
    price: 99,
    img: 'kurs-technik.jpg',
    date: '02.12. / 09.12. / 16.12.2026',
    sortDate: '2026-12-02',
    ort: 'Kletterhalle No Limit',
    teaser: 'Bewegungsanalyse mit individuellem Feedback statt Schema F – wir finden heraus, was dich bremst.',
    beschreibung: 'Du hast das Gefühl, beim Klettern auf der Stelle zu treten? Deine Technik fühlt sich nicht stimmig an, die Motivation lässt nach und eine klare Lösung ist nicht in Sicht? In diesem Kurs nehmen wir deine Bewegungen gezielt unter die Lupe. Dabei erhältst du individuelles, praxisnahes Feedback und keine starren Standardlösungen. Statt vorgegebener Schemata erhältst du persönliches Feedback, das genau auf dich und dein Klettern zugeschnitten ist. Gemeinsam finden wir heraus, was dich aktuell bremst und wie du effizienter vorankommst.',
    lernziel: 'Du erhältst individuelles Feedback zu deinen Bewegungen. Du verstehst nach dem Kurs, welche kleinen Gewohnheiten sich eingeschlichen haben, was dir fehlt, um dein Ziel zu erreichen und erhältst konkrete Aufgaben, die dir helfen werden, die Bewegungen zu verbessern.',
    inhalte: ['Bewegungsanalyse mit individuellem Feedback', 'Konkrete individuelle Aufgaben zur Verbesserung deiner Bewegungstechnik', 'Verständnis-Aufbau der Kletter-Phasen'],
    voraussetzungen: ['Bewegungserfahrung im 6. Grad (idealerweise Vorstieg)', 'Vorstieg sichern von Vorteil'],
    equipment: ['Gurt', 'Einfachseil', 'Sicherungsgerät (Autotuber, Halbautomat)', 'Eventuell Reibungsassistent (bei großem Gewichtsunterschied)'],
    hinweis: 'Hast du noch keine langjährige Erfahrung, schreibe das bitte bei der Anmeldung dazu, damit wir vorher nochmal telefonieren können – anmelden kannst du dich trotzdem. Drei Termine (02.12., 09.12., 16.12.2026), Equipment kann ausgeliehen werden, bitte anfragen.',
    keywords: ['bewegungstechnik', 'besser klettern', 'technik verbessern', 'bewegungsanalyse']
  },
  {
    id: 'update',
    title: 'Sicherungs-Update',
    level: 'Auffrischung',
    dauer: '3 Stunden',
    price: 75,
    img: 'kurs-update.jpg',
    imgPosition: 'center 22%',
    date: '16.01.2027',
    sortDate: '2027-01-16',
    ort: 'Kletterhalle No Limit',
    teaser: 'Aktuelle Lehrmeinung, Gewohnheiten-Check und Sicherungsmythen aufgedeckt – mit Zertifikat.',
    beschreibung: 'Du bist dir unsicher, ob du alles richtig machst? In diesem Kurs werden wir dich auf den aktuellen Stand der Lehrmeinung bringen. Wir betrachten deine Gewohnheiten und werden eventuelle Sicherungs-Mythen aufdecken und besprechen.',
    lernziel: 'Nach dem Kurs kennst du die aktuelle Lehrmeinung und hast deine Sicherungspraxis nachhaltig verbessert.',
    inhalte: ['Übung der Sicherungspraxis', 'Vermittlung der aktuellen Lehrmeinung', 'Gewohnheiten-Check mit individueller Rückmeldung eines Kletterlehrers', 'Zertifikat Sicherungsupdate'],
    voraussetzungen: ['Vorstieg klettern im 5. Grad in der Kletterhalle', 'Erfahrungen im Vorstieg sichern (auch bereits Stürze gesichert)'],
    equipment: ['Seil', 'Sicherungsgerät', 'Gurt'],
    hinweis: 'Es kann Equipment ausgeliehen werden. Bitte anfragen.',
    keywords: ['sicherungs-update', 'sicherungsupdate', 'auffrischung', 'lange nicht mehr geklettert', 'aktueller stand']
  },
  {
    id: 'sturz',
    title: 'Sturz- und Sicherungstraining',
    level: 'Alle Level',
    levelBadge: 'Offen für alle',
    dauer: '3 Stunden',
    price: 75,
    img: 'kurs-sturz.jpg',
    date: '17.01.2027',
    sortDate: '2027-01-17',
    ort: 'Kletterhalle No Limit',
    teaser: 'Weich sichern, Gewichtsunterschiede verstehen und Stürze ohne Verletzung erlernen.',
    beschreibung: 'Angst ist ein wichtiger Teil des Kletterns, jedoch ist der Umgang mit diesem Gefühl manchmal schwer. Wir schauen uns diese Ängste an und behandeln sie mit praxisnahen Übungen.',
    lernziel: 'Nach dem Kurs verstehst du, wie du weich sichern kannst, wie sich ein Gewichtsunterschied auf Stürze auswirkt und was NoGos sind. Du verstehst viele Zusammenhänge zwischen Sturz, Sichern und externen sowie internen Faktoren.',
    inhalte: ['Umgang mit dem Sicherungsgerät', 'Sturztraining (mit Aufbau für das Üben privat)', 'Umgang mit Gewichtsunterschieden', 'Gefahrenanalyse (interne und externe Faktoren)', 'Individuelles Coaching und Empfehlungen', 'Kommunikation in einer Seilschaft', 'Erlernen von Fallen ohne Verletzung', 'Erlernen weiches Sichern'],
    voraussetzungen: ['Vorstieg sichern (idealerweise bereits ein paar Stürze gehalten – kein Muss, jedoch sinnvoll)', 'Routinierter Umgang mit deinem Sicherungsgerät (Halbautomat o. Autotuber)'],
    equipment: ['Gurt', 'Seil', 'Sicherungsgerät (Halbautomat o. Autotuber)'],
    hinweis: '',
    keywords: ['sturztraining', 'sturz', 'angst vorm stürzen', 'angst vorm sturz', 'weich sichern']
  },
  {
    id: 'paket-basis',
    title: 'Jahresausbildung Basis',
    level: 'Stufe 1–3',
    dauer: '1 Jahr',
    price: 799,
    date: 'Einstieg jederzeit · nächster Zyklus ab März',
    sortDate: null,
    ort: 'Leipzig, Elbsandstein und Umgebung',
    isPaket: true
  },
  {
    id: 'paket-komplett',
    title: 'Jahresausbildung Komplett',
    level: 'Stufe 1–3 + Woche',
    dauer: '1 Jahr',
    price: 1490,
    date: 'Einstieg jederzeit · nächster Zyklus ab März',
    sortDate: null,
    ort: 'Leipzig, Elbsandstein, Ausbildungswoche outdoor',
    isPaket: true
  }
];

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
