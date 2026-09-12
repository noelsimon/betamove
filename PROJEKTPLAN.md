# BETAMOVE — Projektplan

Stand: 2026-09-12 · Projektmanager: Claude (dieser Chat) · Programmierer: von mir beauftragter Coding-Agent

## 0. Rollen in diesem Projekt

- **Auftraggeberin/Product Owner:** du — triffst Entscheidungen, stellst Zugänge/Konten bereit, gibst Texte/Bilder frei.
- **Projektmanager:** ich — plane, beauftrage den Programmierer, prüfe seine Arbeit kritisch, halte dich informiert.
- **Programmierer:** ein von mir beauftragter Coding-Agent, der die eigentliche Implementierung übernimmt. Ich gebe ihm einen klaren Auftrag, er bestätigt Machbarkeit/Scope, erst dann beginnt die Umsetzung.

## 1. Tech-Stack (entschieden)

| Baustein | Wahl | Warum |
|---|---|---|
| Code & Hosting Frontend | **GitHub** (Repo `noelsimon/betamove`) + **GitHub Pages** | kostenlos, kein eigener Server, bereits eingerichtet |
| Backend / Datenbank | **Supabase** (Postgres + Auth + Storage) | eine Lösung für Formular-Speicherung jetzt UND Accounts/Quiz/Zertifikate später — kein Formspree/Drittanbieter nötig |
| E-Mail | **Zoho Mail** auf eigener Domain | von dir gewählt |
| Framework | Keins — reines HTML/CSS/JS | bleibt portabel (z. B. falls später WordPress gewünscht) |

**Wichtige Änderung gegenüber vorherigem Stand:** Die bereits gebauten Formulare (`kontakt.html`, `anmeldung.html`) nutzen aktuell einen Formspree-Platzhalter. Da du dich für Supabase entscheidest, ersetzt der Programmierer das durch eine Supabase-Tabelle — dann brauchst du Formspree gar nicht erst einzurichten.

## 2. Phasen-Übersicht

- **Phase 1 — Minimal-Launch:** Nur die Kursanmeldung soll live und voll funktionsfähig sein.
- **Phase 2 — Ausbau:** Rest der bereits gebauten Seiten (Ausbildung, Bildungsurlaub, Team, Wissen, Konto/Login) wird schrittweise dazugeschaltet, inkl. echter Nutzerkonten.

## 3. Phase 1 — im Detail

### 3.1 Welche Seiten gehen live

**Entschieden (2026-09-12):** Alle 32 bereits gebauten Seiten bleiben live/verlinkt, inklusive Ausbildung, Bildungsurlaub, Team, Über uns, Wissen und dem Konto/Login-Bereich (weiterhin als reine Design-Vorschau mit "folgt mit Supabase-Anbindung"-Hinweis). Keine Navigation wird gekürzt.

Der eigentliche **funktionale Fokus von Phase 1** ist ausschließlich: die Kursanmeldung (`anmeldung.html`) soll echt funktionieren (Supabase-Anbindung statt Formspree-Platzhalter). Alles andere bleibt wie es ist — Design sichtbar, aber ohne echtes Backend, wie in den jeweiligen Vorschau-Bannern schon markiert.

### 3.2 Technische Umsetzung (nach Feasibility-Check des Programmierers, final entschieden)

1. Supabase-Projekt (EU-Region) wird angelegt — **das musst du selbst tun** (Kontoerstellung/Zahlungsdaten sind nicht delegierbar).
2. Zwei Tabellen, beide mit RLS **explizit aktiviert** und nur einer INSERT-Policy (kein SELECT von außen):
   - `kursanmeldungen` — vollständiges Schema nach den tatsächlichen Feldern im 4-Schritte-Formular: Vorname, Nachname, E-Mail, Telefon, gewählter Kurs/Paket, Kletterlevel, Material-Leihe (ja/nein), Studierenden-/Azubi-Rabatt (ja/nein + Hinweis auf Nachweispflicht), Nachricht, AGB-Bestätigung, Zeitstempel.
   - `kontaktanfragen` — Name, E-Mail, Betreff, Nachricht, Zeitstempel. Ersetzt Formspree auf `kontakt.html`.
   - **Newsletter-Formular auf `kontakt.html` wird entfernt** (kein Bedarf zum Launch, spart eine dritte Tabelle/einen Anbieter).
3. Spam-/Datenschutz für die offen beschreibbaren Tabellen: `WITH CHECK`-Constraints (Pflichtfelder, E-Mail-Format, Längenlimits) + ein unsichtbares Honeypot-Feld im Formular (Bots füllen es aus, echte Nutzer sehen es nicht — Einsendung mit ausgefülltem Honeypot wird client-seitig verworfen). Kein Captcha, kein zusätzlicher Dienst.
4. `anmeldung.html` und `kontakt.html` schreiben direkt per Supabase-JS-Client (CDN-Script, kein Build-Schritt) in die jeweilige Tabelle. Klarer Fehlerzustand im Formular, falls der Insert fehlschlägt (aktuell nicht vorhanden — wird ergänzt).
5. **Keine E-Mail-Benachrichtigung in Phase 1.** Du prüfst neue Anmeldungen/Anfragen zunächst im Supabase-Dashboard. E-Mail-Alarm (Supabase Edge Function + Zoho SMTP, geschätzt 4–8 Std.) ist bewusst auf später verschoben (Fast-Follow, nicht Teil von Phase 1).
6. GitHub Pages aktivieren (dein einmaliger Klick in den Repo-Einstellungen).
7. Bilder/Video für die Seiten (Logo, Hero, Kursbilder) müssen von dir geliefert werden (Liste steht in `assets-min/README.md`).

**Sicherheitshinweis (vom Programmierer bestätigt):** Der Supabase `anon key` ist ein öffentlicher Client-Schlüssel, kein Geheimnis — Sicherheit kommt ausschließlich von aktiviertem RLS + der INSERT-only-Policy, nicht von der Geheimhaltung des Keys. Wichtig: es muss der `anon key` geliefert werden, niemals der `service_role`-Key (der hebelt RLS komplett aus).

### 3.3 Rechtliches (nicht vom Programmierer lösbar)
Impressum/Datenschutz/AGB/Widerruf wurden von der KI entworfen — **müssen vor Launch von dir bzw. einer Person mit Rechtskenntnis geprüft werden**, insbesondere weil jetzt echte Personendaten (Kursanmeldungen, Kontaktanfragen) gespeichert werden. Das ist ein Blocker, keine Nebensache. Die Datenschutzerklärung sollte dabei **Supabase als Auftragsverarbeiter (inkl. AVV)** konkret benennen, sobald echte Anmeldedaten dort liegen.

### 3.4 Was ich von dir brauche, bevor Phase 1 starten kann
- [ ] Supabase-Konto + Projekt angelegt (EU-Region) → Projekt-URL und `anon key` an mich/den Programmierer
- [ ] Zoho-Mail-Konto für die Domain eingerichtet (zumindest die Absenderadresse, z. B. `info@deinedomain.de`)
- [ ] Bestätigung des Seiten-Scopes aus 3.1
- [ ] Rechtstexte gegengelesen (oder zumindest "vorläufig okay, wird vor echtem Launch final geprüft")

### 3.5 Definition of Done — Phase 1
Kursanmeldung ist live, schreibt erfolgreich in Supabase, GitHub Pages läuft, nur die vereinbarten Seiten sind sichtbar/verlinkt, Rechtstexte sind freigegeben.

## 4. Phase 2 — grober Ausblick (noch nicht beauftragt)
- Restliche Seiten scharfschalten (Navigation erweitern)
- Supabase Auth: Login/Registrierung echt anbinden
- Quiz-Fortschritt, Zertifikate, Kursbuchungen pro Nutzerkonto in Supabase statt Design-Vorschau
- Team-Texte, Partnerlogos final einpflegen

## 5. Was der Programmierer für den Start braucht (mein Scope-Check als PM)
Damit der Programmierer sinnvoll loslegen kann, ohne stecken zu bleiben, muss er VOR dem ersten Code haben:
1. Diesen Plan (Phase-1-Scope, Abschnitt 3)
2. Supabase-Projektzugang (URL + anon key) — **fehlt noch, siehe 3.4**
3. Klarheit, ob Phase 1 wirklich nur die 5 Seitengruppen umfasst oder ob z. B. "Über uns" mit rein soll

→ Ohne Supabase-Zugang kann der Programmierer die Anmeldung technisch vorbereiten (Formular, Tabellen-Schema, Code), aber nicht live testen. Das ist der aktuelle Flaschenhals.

## 6. Offene Entscheidungen

1. ~~Seiten-Scope~~ — **erledigt:** alle 32 Seiten bleiben live (siehe 3.1).
2. ~~Kontakt-/Newsletter-Formular~~ — **erledigt:** Newsletter entfällt, Kontaktformular bekommt eigene Supabase-Tabelle (siehe 3.2).
3. ~~E-Mail-Benachrichtigung~~ — **erledigt:** nicht Teil von Phase 1, nur Dashboard-Check (siehe 3.2).
4. ~~Spam-Schutz~~ — **erledigt:** Basis-Schutz (DB-Validierung + Honeypot-Feld), kein Captcha (siehe 3.2).

**Alle Vorab-Entscheidungen sind getroffen. Der Programmierer kann mit dem Code beginnen** (Formulare, Tabellenschema/SQL, Fehlerbehandlung) — nur der **echte Supabase-Projektzugang (URL + anon key)** fehlt noch für den Live-Test, siehe 3.4. Bis dahin arbeitet der Programmierer mit klar markierten Platzhaltern (analog zum bisherigen Formspree-TODO-Muster).
