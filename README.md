# BETAMOVE — Website

Statische Website für BETAMOVE (Kletterschule Leipzig: Kurse, Ausbildung, Bildungsurlaub,
Wissensplattform). Reines HTML/CSS/JS, kein Build-Schritt, kein Framework — bewusst so gehalten,
damit der Inhalt später leicht in WordPress übernommen werden kann (siehe unten).

Diese Fassung ersetzt eine frühere, kleinere Platzhalter-Version des Repos durch das
tatsächliche, fertige Design (ursprünglich als Claude-Design-Canvas-Export geliefert) mit den
echten Texten, Kursen, Preisen und Seiten der Seitenbetreiberin.

## Seitenstruktur

Marketing- und Infoseiten:

```
index.html                      Startseite
kurse.html                       Kursübersicht mit Suche/Filtern
anmeldung.html                   Kursanmeldung (4-Schritte-Formular, schreibt per Supabase in
                                  `kursanmeldungen` — echte Zugangsdaten fehlen noch, siehe unten)
ausbildung.html                  Ausbildungskonzept, Module, Jahrespakete
bildungsurlaub.html              Bildungsurlaub: Wochenkurse, Anspruch nach Bundesland, FAQ
bildungsurlaub-antrag.html       Antrag erstellen (4-Schritte-Formular mit Live-Briefvorschau)
team.html                        Team
ueber-uns.html                   Über BETAMOVE
kontakt.html                     Kontaktformular (schreibt per Supabase in `kontaktanfragen`;
                                  kein Newsletter-Formular mehr)
agb.html / impressum.html / datenschutz.html / widerruf.html   Rechtstexte
```

Wissensplattform (kostenlos nutzbar, Fortschritt nur im Browser via `localStorage`):

```
wissen.html                       Übersicht: Suche, Filter, Themenbereiche, Fortschritt
wissen-thema-*.html                6 Themenseiten (sichern, fels, alpin, training, natur, freizeit)
artikel-*.html                     6 Artikel (inkl. artikel-halle-an-den-fels.html als Langform)
quiz-sichern.html / quiz-fels.html Zwei interaktive Quiz (rein im Browser ausgewertet)
pruefung-sicherungsschein.html     Interaktive Online-Prüfung (8 Fragen)
```

Konto-Bereich (Design-Vorschau, siehe Hinweis unten):

```
login.html                        Anmelden / Konto erstellen (Formulare senden noch nirgends hin)
konto.html                        Dashboard-Übersicht
konto-weg.html                    Ausbildungsweg als Karte
konto-qualifikationen.html        Qualifikationen im Detail
konto-lernen.html                 Lernstand
konto-profil.html                 Profildaten
```

Gemeinsame Dateien:

```
css/style.css              Gesamtes Styling (Design-Tokens, Farben, Buttons, Komponenten oben in der Datei)
js/main.js                 Mobiles Menü, aktive Nav-Markierung, Chat-Widget-Optik, Accordion-Helfer,
                            kleine Lernfortschritts-Hilfsfunktion (bmProgress, nutzt nur localStorage)
js/supabase-config.js      Supabase-URL + anon key — aktuell Platzhalter, siehe unten
js/supabase-client.js      Baut daraus (defensiv, ohne zu crashen) den Supabase-Client für
                            anmeldung.html und kontakt.html
supabase/schema.sql        Tabellen + Row-Level-Security für Supabase, einmalig im SQL-Editor
                            des Supabase-Projekts auszuführen (siehe unten)
assets-min/                Bild- und Videodateien (siehe assets-min/README.md — Ordner ist absichtlich leer)
.github/workflows/deploy-pages.yml   Deployment nach GitHub Pages
```

Jede Seite bindet Header, Footer und den Chat-Widget-Baustein identisch als eigenständiges HTML
ein (kein Template-System) — Änderungen an Navigation oder Footer müssen deshalb in jeder Datei
einzeln nachgezogen werden. Das ist bewusst so gehalten (siehe "Kein Build-Schritt" oben).

## Vor der Veröffentlichung unbedingt anpassen

1. **Supabase-Zugangsdaten in `js/supabase-config.js`**: Die Formulare auf `anmeldung.html` und
   `kontakt.html` schreiben per Supabase-JS-Client (CDN, kein Build-Schritt) direkt in eine
   Supabase-Tabelle — es wird kein Formspree oder anderer Drittanbieter mehr gebraucht. Dafür
   nötig:
   1. Ein Supabase-Projekt anlegen (EU-Region empfohlen) — das ist Kontoerstellung und kann nicht
      automatisiert werden.
   2. In `js/supabase-config.js` die beiden Platzhalter `DEINE-SUPABASE-PROJECT-URL` und
      `DEIN-SUPABASE-ANON-KEY` durch die echten Werte aus dem Supabase-Dashboard ersetzen
      (Project Settings → API → "Project URL" bzw. "anon public" Key — **nicht** den
      `service_role`-Key verwenden, der hebelt die Zugriffsbeschränkung komplett aus).
   3. Den kompletten Inhalt von `supabase/schema.sql` einmalig im Supabase SQL-Editor ausführen
      (legt die Tabellen `kursanmeldungen` und `kontaktanfragen` inkl. Row-Level-Security an —
      Details und Sicherheitshinweise stehen als Kommentare in der Datei).

   Ohne echte Werte in `js/supabase-config.js` zeigen beide Formulare beim Absenden einen
   sauberen Hinweis ("nicht verbunden") statt Daten zu verlieren oder mit einem kaputten
   JavaScript-Fehler abzubrechen.
2. **Bilder und Video in `assets-min/`**: Beim Export aus Claude Design waren keine echten
   Bilddateien dabei, nur die Pfade dazu. Die vollständige Liste der erwarteten Dateinamen
   (Logo, Hero-Video, Kursbilder, Teamfotos, Ausbildungskonzept-Diagramm usw.) steht in
   `assets-min/README.md`. Sobald die echten Dateien mit denselben Namen dort abgelegt werden,
   funktioniert alles ohne Codeänderungen.
3. **Drei Partnerlogos** auf der Startseite (Abschnitt „Unsere Kooperationen“) sind aktuell
   gestrichelte Platzhalter-Boxen — sobald echte Partnerlogos vorliegen, die drei
   `<div>`-Platzhalter in `index.html` durch `<img>`-Tags ersetzen.
4. **Team-Platzhalter** in `team.html`: Noels und Annas persönliche Texte sowie die
   „Lieblingsgebiet/Lieblingskurs“-Angaben sind noch mit `[z. B. …]`-Platzhaltern markiert und
   sollten von den beiden selbst geschrieben werden.
5. **Datenschutzerklärung/Formular-Text** nochmal von einer Person mit Rechtskenntnis prüfen
   lassen (Pflicht bei Kontakt-/Anmeldeformularen in Deutschland).

## GitHub Pages aktivieren (einmalig, manuell)

Der Workflow `.github/workflows/deploy-pages.yml` deployt automatisch bei jedem Push auf `main`.
Damit das greift, muss einmalig in den Repo-Einstellungen aktiviert werden:

**Settings → Pages → Source → „GitHub Actions“**

Das kann nur ein Mensch mit Repo-Zugriff anklicken — kein Automatisierungs-Tool kann das für dich
erledigen.

## Wichtig: keine echten Nutzerdaten in diesem Repo speichern

Git-Historie vergisst nichts. Anmeldungen, Kontaktanfragen und alles, was Nutzer*innen über
Formulare eingeben, darf deshalb nie als Datei ins Repo committet werden — diese Daten laufen
ausschließlich über Supabase (Tabellen `kursanmeldungen` und `kontaktanfragen`, siehe oben).

## Konto, Quiz-Nachweise und Zertifikate: aktuell nur Design-Vorschau

Die Seiten `login.html`, `konto*.html`, die Online-Prüfung sowie die Kommentarbereiche unter den
Wissensartikeln zeigen bereits das fertige Design und teils funktionierende Interaktionen
(Quiz/Prüfung werten clientseitig aus, Formulare validieren) — aber **es gibt noch kein echtes
Backend dahinter**. Diese Seiten tragen deshalb einen kleinen Hinweis-Banner
("Vorschau — … folgt mit Supabase-Anbindung"), und ihre Formulare (Login, Registrierung,
Profil speichern, Kommentar schreiben) brechen den Submit bewusst ab, statt Daten irgendwohin zu
schicken.

**Geplanter Weg:** [Supabase](https://supabase.com) für Authentifizierung (Login/Registrierung)
und Datenbank (Qualifikationen, Prüfungsnachweise, Kommentare, Profil, Lernfortschritt über
Geräte hinweg). Sobald das steht, ersetzen die `alert(...)`-Platzhalter in den `<script>`-Blöcken
der Konto-/Login-/Kommentar-Bereiche echte Supabase-Aufrufe, und der Vorschau-Banner kann
entfernt werden. Die reinen Wissensplattform-Inhalte (Artikel, Quiz, Prüfungsfragen) funktionieren
schon jetzt clientseitig und bräuchten für den anonymen Gebrauch kein Backend — nur das
Konto-Andocken (Nachweise dauerhaft & geräteübergreifend speichern) fehlt noch.

Für Kursbuchung/Bezahlung und die Kursverwaltung selbst (nicht Teil dieses Repos) bleibt
zusätzlich ein weiterer Baustein offen, z. B. eine externe Buchungslösung oder ein eigenes
kleines Backend — je nachdem, was die Betreiberin bevorzugt.
