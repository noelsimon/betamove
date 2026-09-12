# assets-min/ — benötigte Bild- und Videodateien

Dieser Ordner ist im Repo absichtlich (fast) leer. Das Original-Design (Claude Design Canvas)
verlinkt Bilder und ein Video aus `assets-min/`, aber die eigentlichen Dateien waren beim Export
nicht dabei. Die HTML-Seiten verweisen bereits auf die exakten Pfade unten — sobald du die echten
Dateien hier mit demselben Namen ablegst, funktionieren Header-Logo, Hero-Video, Kursbilder,
Team-Fotos usw. ohne weitere Änderungen am Code.

Bis dahin zeigen Browser für `<img>`/`<video>` ein "kaputtes Bild"-Icon; die umgebenden Elemente
haben eine `background`-Fläche in `var(--color-surface)` bzw. eine feste `aspect-ratio`/
`min-height`, damit das Layout nicht zusammenfällt.

## Benötigte Dateien

| Datei | Verwendung |
|---|---|
| `logo.png` | BETAMOVE-Logo in Header (56px hoch) und Footer (74px hoch), transparenter Hintergrund empfohlen |
| `hero.mp4` | Autoplay-Hintergrundvideo im Hero der Startseite, stumm, in Schleife, ca. 1900×1000 oder größer, Klettern am Fels |
| `hero.jpg` | Poster-/Vorschaubild für `hero.mp4`, gleicher Bildausschnitt wie das Video |
| `vdbs-logo.png` | Logo des VDBS (Verband Deutscher Berg- und Skiführer), quadratisch/transparent, wird zweimal verwendet (Startseite Trust-Leiste + Medaillon) |
| `vdbs.jpg` | Bild zur VDBS-Ausbildung, Startseite, Seitenverhältnis 4:3 |
| `vorstieg.jpg` | Vorschaubild "Einzelkurse" auf der Startseite (Angebote-Sektion) |
| `technik.jpg` | Vorschaubild "Jahresausbildung" auf der Startseite (Angebote-Sektion) |
| `reisen.jpg` | Bildungsurlaub: Hero-Hintergrund und Vorschaubild "Bildungsurlaub" auf der Startseite |
| `ueber-1.jpg` | Hero-Hintergrund auf der Seite „Über uns" |
| `ueber-2.jpg` | Startseite (Team-Sektion) und „Über uns" (Kachel „Erfahrung trifft Fachwissen"), Hochformat |
| `ueber-3.jpg` | „Über uns" (Kachel „Lernen braucht Zeit") und Wissensartikel „Sperrzeiten verstehen", Hochformat |
| `ueber-4.jpg` | „Über uns" (Kachel „Verantwortung am Fels"), Hochformat |
| `ausbildungskonzept.png` | Diagramm des Ausbildungskonzepts, verwendet auf `ausbildung.html` und `konto-weg.html` (breites Format, Text lesbar) |
| `kurs-halle.jpg` | Kurs „Von der Halle an den Fels" (Kursliste, Startseite, Bildungsurlaub-Wochenkurs „Sicher am Fels") |
| `kurs-msl.jpg` | Kurs „Mehrseillängen für Fortgeschrittene" (Kursliste, Bildungsurlaub-Wochenkurs „Mehrseillängen-Woche", Wissensartikel „Standplatz") |
| `kurs-mobil.jpg` | Kurs „Keile, Friends und Co. – Mobile Sicherung" (Kursliste) |
| `kurs-technik.jpg` | Kurs „Besser Klettern – Bewegungstechnik" (Kursliste, Bildungsurlaub-Wochenkurs „Bewegung & Mentale Stärke", Wissensartikel „Trainingsplan") |
| `kurs-update.jpg` | Kurs „Sicherungs-Update" (Kursliste, Startseite) |
| `kurs-sturz.jpg` | Kurs „Sturz- und Sicherungstraining" (Kursliste, Startseite, Wissensartikel „Die Bremshand") |
| `team-noel.jpg` | Teamfoto Noel (Hochformat 4:5) |
| `team-anna.jpg` | Teamfoto Anna (Hochformat 4:5) |
| `wissen-hero.jpg` | Wissensplattform: Vorschaubild "Wissensplattform" (Startseite), Artikel-Titelbild „Halle an den Fels" |
| `wissen-1.jpg` | Bild im Artikel „Halle an den Fels" (Materialkunde-Abschnitt), 16:9 |
| `kontakt.jpg` | Bild auf der Kontaktseite neben dem Formular, 4:3 |

## Partner-Logos (im Original per Claude-Design „image-slot" direkt im Browser editiert)

Auf der Startseite gibt es drei Plätze für Partnerlogos unter „Unsere Kooperationen". Im Original
waren das interaktive `<image-slot>`-Elemente, die die Website-Betreiberin direkt im
Design-Tool bestücken sollte. In diesem statischen Export sind es einfache gestrichelte
Platzhalter-Boxen ohne Funktion — trage die Partnerlogos ein, indem du die drei
`<div style="...border:2px dashed...">Logo Partner 1</div>`-Blöcke in `index.html` durch
`<img>`-Tags ersetzt, sobald echte Logos vorliegen.

## Format-Hinweise

- Fotos idealerweise als komprimiertes `.jpg` (WebP wäre technisch möglich, dann müssten die
  `<img src="...">`-Pfade in den HTML-Dateien angepasst werden).
- `hero.mp4` sollte klein gehalten werden (idealerweise unter 5–8 MB), da es beim Laden der
  Startseite automatisch abgespielt wird.
- Alle Pfade sind bereits als `assets-min/<dateiname>` in den HTML-Dateien verlinkt — einfach
  Dateien mit exakt diesen Namen in diesen Ordner legen.
