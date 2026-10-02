# BETAMOVE — Datenschutz- und Informationssicherheitskonzept

Stand: 02.10.2026 · Version 1.0 · Erstellt von: Datenschutz-Agent (Claude) · Abstimmung mit: Projektmanager, ISMS

> Dieses Konzept stellt sicher, dass Datenschutz und Informationssicherheit bei BETAMOVE **dauerhaft aktuell** bleiben —
> nicht als einmalige Prüfung, sondern als fester Ablauf bei jeder Änderung, ergänzt um automatische und regelmäßige Prüfungen.
> Es ersetzt keine Rechtsberatung. Rechtstexte (Impressum, Datenschutzerklärung, AGB, Widerruf) müssen vor dem echten Launch
> von einer Person mit Rechtskenntnis freigegeben werden.

---

## 1. Rollen und Zuständigkeiten

| Rolle | Wer | Aufgabe im Datenschutz |
|---|---|---|
| **Verantwortlicher** (Art. 4 Nr. 7 DSGVO) | Noel Uhlrich (BETAMOVE) | trifft Entscheidungen, schließt AV-Verträge ab, gibt Rechtstexte frei, beantwortet Betroffenenanfragen |
| **Datenschutz-Ansprechperson** | Datenschutz-Agent | prüft Daten, Bilder, Rechtstexte und jede Änderung; pflegt dieses Konzept, das Verarbeitungsverzeichnis und die Datenschutzerklärung |
| **ISMS** | ISMS-Agent | Informationssicherheit: Zugriffsrechte (RLS), Secrets, Härtung, Sicherheitsvorfälle; liefert TOMs (Abschnitt 4) zu |
| **Projektmanager** | Projektmanager-Agent | bindet die Datenschutz-Prüfung in jeden Auftrag ein (Abschnitt 6.1), meldet Befunde an die Verantwortliche |
| **Programmierer** | Coding-Agent | setzt um; hält den automatischen Check (`scripts/datenschutz-check.py`) grün |

Eine Pflicht zur Benennung eines Datenschutzbeauftragten besteht nicht (weniger als 20 Personen ständig mit der Verarbeitung beschäftigt, § 38 BDSG; keine Kerntätigkeit mit umfangreicher Verarbeitung besonderer Kategorien).

---

## 2. Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

| # | Verarbeitung | Betroffene | Datenkategorien | Zweck | Rechtsgrundlage | Empfänger / Auftragsverarbeiter | Speicherort | Löschfrist |
|---|---|---|---|---|---|---|---|---|
| V1 | Website-Auslieferung | Besucher*innen | IP, Zeitpunkt, URL, User-Agent, Referrer | Bereitstellung, Sicherheit | Art. 6 (1) f | GitHub (Pages) | USA (DPF) | gem. GitHub |
| V2 | Kursanmeldung | Teilnehmende | Name, E-Mail, Telefon, Kurs, Termin, Level, Leihmaterial, Rabattstatus, Anmerkungen, AGB-Bestätigung, Storno, Teilnahmebestätigung, Admin-Notiz | Vertragsdurchführung, Abrechnung | Art. 6 (1) b, c | Supabase, Resend | EU (Supabase) | Kursende + 6/8 J. (HGB/AO) für Buchungsbelege; Storno ohne Zahlung: 12 Mon. nach Termin |
| V3 | Kontaktformular / E-Mail | Interessierte | Name, E-Mail, Betreff, Nachricht | Beantwortung | Art. 6 (1) b / f | Supabase, Resend, E-Mail-Postfach | EU / s. offene Punkte | 12 Mon. nach Abschluss |
| V4 | Lernkonto | Nutzer*innen | E-Mail, Passwort-Hash, Vor-/Nachname, Level, Lernfortschritt inkl. Prüfungsergebnis, Prüfungsfreigaben | Lernplattform, Nachweise | Art. 6 (1) b | Supabase | EU | bis Löschung; 3 J. Inaktivität → Löschung nach Ankündigung |
| V5 | Kommentare | Nutzer*innen | Vorname, Kommentartext, Zeitpunkt, User-ID | Austausch zu Artikeln | Art. 6 (1) b | öffentlich sichtbar | EU | bis Löschung durch Nutzer*in / Konto |
| V6 | Lernfortschritt ohne Konto | Besucher*innen | erledigte Inhalte (`betamove-progress`) | Fortschrittsanzeige | § 25 (2) Nr. 2 TDDDG | — (nur Browser) | Endgerät | durch Nutzer*in |
| V7 | Chat-Assistent | Besucher*innen | Chat-Eingaben | Antworten auf FAQs | — | — (läuft nur im Browser, keine Übertragung) | Endgerät (flüchtig) | beim Schließen der Seite |
| V8 | Bildungsurlaub-Antrag | Besucher*innen | Formulareingaben | Antragsbrief erzeugen | — | — (aktuell nur im Browser, kein Versand) | Endgerät | flüchtig |
| V9 | Fotos auf der Website | Team, Teilnehmende | Abbildungen von Personen | Darstellung des Angebots | Art. 6 (1) a (Einwilligung) / § 22 KUG | öffentlich | GitHub | bis Widerruf |

**Pflege-Regel:** Jede neue Tabelle, jedes neue Formularfeld, jeder neue Dienst → zuerst hier eine Zeile, dann Datenschutzerklärung anpassen, dann live gehen.

---

## 3. Auftragsverarbeiter und Drittlandübermittlung

| Dienst | Zweck | Sitz | AVV (Art. 28) | Drittlandgrundlage | Status |
|---|---|---|---|---|---|
| Supabase | DB, Auth, Edge Functions | USA, Daten in EU-Region | DPA im Dashboard abschließen (Organization → Legal) | SCC (+ DPF prüfen) | **offen — Abschluss bestätigen, EU-Region im Dashboard verifizieren** |
| Resend | Transaktions-Mails | USA | DPA auf resend.com akzeptieren | SCC / DPF | **offen — Abschluss bestätigen** |
| GitHub | Hosting (Pages), Code | USA | GitHub DPA (Teil der Customer Terms) | DPF | prüfen |
| Zoho Mail | Postfach info@betamove.de | EU-Rechenzentrum wählen | Zoho DPA | — bei EU-RZ | **offen — Einrichtung + AVV** |
| Google (Gmail, privat) | derzeit Empfänger der Benachrichtigungs-Mails | USA | **kein AVV möglich (Privatkonto)** | — | **Befund: ablösen** (s. Abschnitt 9) |

Nicht mehr eingebunden (seit 02.10.2026): Google Fonts, jsDelivr-CDN — beides wird jetzt lokal ausgeliefert.

---

## 4. Technische und organisatorische Maßnahmen (TOMs, Art. 32 DSGVO)

*Technische und organisatorische Sicherheitsmaßnahmen werden im internen ISMS der Betreiberin geführt (nicht öffentlich). Hier steht nur der datenschutzrelevante, bereits umgesetzte Mindeststand.*

> **Öffentliches Repo:** Offene Sicherheitsbefunde werden in diesem Repository weder beschrieben noch nummeriert.

| Schutzziel | Maßnahme | Status |
|---|---|---|
| Vertraulichkeit | HTTPS (GitHub Pages, „Enforce HTTPS“ aktiv halten) | prüfen in Repo-Settings → Pages |
| Vertraulichkeit | Row-Level-Security auf allen Tabellen; anonym nur INSERT auf `kursanmeldungen`/`kontaktanfragen` | umgesetzt |
| Vertraulichkeit | Nur `anon key` im Frontend; `service_role` und `RESEND_API_KEY` nur als Server-Secret | umgesetzt, automatisch geprüft |
| Integrität | Supabase Auth: „Leaked password protection“ + Mindestlänge Passwort ≥ 10 | prüfen |
| Integrität | Honeypot + DB-Constraints gegen Spam | umgesetzt |
| Datenminimierung | keine Tracker, keine Cookies, keine externen Ressourcen außer Supabase | umgesetzt, automatisch geprüft |
| Datenminimierung | Bild-Metadaten (GPS, Kamera, Namen) werden vor Veröffentlichung entfernt | umgesetzt, automatisch geprüft |
| Verfügbarkeit | Supabase-Backups (Plan prüfen: Free-Tier ohne PITR) ; Export der Tabellen monatlich | prüfen |
| Trennung | Interne Dateien (SQL, Edge-Function-Code, Projektplan, Konzepte) werden **nicht** auf betamove.de veröffentlicht (Deploy-Workflow baut `_site` ohne diese Dateien) | umgesetzt |

---

## 5. Prüfzyklus — so bleibt der Datenschutz aktuell

| Wann | Was | Wer | Wie |
|---|---|---|---|
| **Bei jedem Push / PR** | Bild-Metadaten, externe Ressourcen, Tracking, Rechtstexte verlinkt, Datenschutzerklärung nennt alle Dienste, Secrets | automatisch | GitHub Action `Datenschutz-Check` (`scripts/datenschutz-check.py`) — rot = nicht mergen |
| **Bei jedem neuen Auftrag** | Change-Gate (Abschnitt 6.1) | PM → Datenschutz-Agent | Checkliste im Auftrag abhaken |
| **Monatlich** | automatischer Check (auch ohne Push), Postfach auf Betroffenenanfragen prüfen | automatisch / Verantwortliche | Action läuft am 1. jedes Monats |
| **Quartalsweise** | Löschkonzept anwenden (alte Anmeldungen/Anfragen löschen), Admin-Zugänge prüfen, RLS-Policies gegen VVT abgleichen | Datenschutz-Agent + ISMS | Abschnitt 7 + Abschnitt 8.1 |
| **Jährlich** (spätestens 12 Monate nach „Stand“) | Vollprüfung: VVT, AVVs, Datenschutzerklärung, AGB, Impressum, Widerruf, Bild-Einwilligungen; neues „Stand“-Datum | Datenschutz-Agent, Freigabe Verantwortliche | Check schlägt automatisch fehl, wenn „Stand“ älter als 12 Monate |
| **Anlassbezogen** | neue Rechtslage (z. B. Urteile, Gesetzesänderungen), Datenpanne, Beschwerde | Datenschutz-Agent | Abschnitt 10 |

---

## 6. Ablauf bei Änderungen

### 6.1 Change-Gate (vor jedem Auftrag an den Programmierer)

Der Projektmanager fragt bei jedem Auftrag ab — sobald eine Frage mit **Ja** beantwortet wird, geht der Auftrag vor Umsetzung an den Datenschutz-Agenten:

1. Werden **neue personenbezogene Daten** erhoben (neues Formularfeld, neue Tabelle, neue Spalte)?
2. Wird ein **neuer externer Dienst** eingebunden (Skript, Schrift, Video, Karte, Zahlungsanbieter, KI, Mail, Analytics)?
3. Werden Daten **für andere sichtbar** (öffentlich, andere Nutzer*innen, Kursleitung)?
4. Ändern sich **Zugriffsrechte** (RLS-Policy, Admin-Funktion, `security definer`-Funktion)?
5. Werden **Bilder oder Videos mit Personen** veröffentlicht?
6. Ändern sich **Preise, Buchungs- oder Stornobedingungen** (→ AGB/Widerruf)?

Ergebnis: Datenschutz-Agent aktualisiert VVT (Abschnitt 2), ggf. AVV-Liste (3), Datenschutzerklärung und — falls nötig — AGB/Widerruf **im selben PR** wie die Funktion.

### 6.2 Bilder und Videos — Prüfschritte

1. **Einwilligung:** Für jede erkennbare Person liegt eine schriftliche Einwilligung vor (Zweck „Website/Social Media BETAMOVE“, widerruflich). Bei Minderjährigen zusätzlich der Erziehungsberechtigten. Ablage außerhalb des Repos (z. B. Ordner „Einwilligungen“).
2. **Bildrechte:** Fotograf*in/Lizenz geklärt; Urhebernennung im Impressum unter „Bildnachweise“ (aktuell: Sebastian Ossinger). Partnerlogos nur mit Zustimmung der Partner.
3. **Metadaten entfernen:** `python3 scripts/bild-metadaten-entfernen.py assets-min/<datei>` (verlustfrei, entfernt GPS, Gerät, Namen, Canva-IDs). Der automatische Check verhindert, dass Bilder mit Metadaten live gehen.
4. **Inhalt prüfen:** keine Kennzeichen, Hausnummern, Bildschirme, Namensschilder, Unfall-/Verletzungsdetails erkennbar.
5. **Widerruf:** Wird eine Einwilligung widerrufen, Bild sofort entfernen (auch `og:image`/Social-Vorschau) und Git-Historie bewerten.

### 6.3 Rechtstexte — Pflichtbestand

Immer vorhanden und in **jedem** Seiten-Footer verlinkt (automatisch geprüft): `impressum.html`, `datenschutz.html`, `agb.html`, `widerruf.html`.
Jede Datenschutzerklärung trägt ein „Stand: TT.MM.JJJJ“.

---

## 7. Löschkonzept

| Daten | Frist | Auslöser | Umsetzung |
|---|---|---|---|
| `kursanmeldungen` mit Zahlung | 8 J. (Buchungsbeleg, § 147 AO) bzw. 6 J. (Handelsbrief) nach Jahresende | Kursende | quartalsweise: personenbezogene Felder nach Fristablauf löschen |
| `kursanmeldungen` storniert / ohne Zahlung | 12 Mon. nach Kurstermin | Kurstermin | quartalsweise SQL-Löschlauf (Vorschlag: `pg_cron`-Job) |
| `kontaktanfragen` | 12 Mon. nach Eingang | Eingang | quartalsweise / `pg_cron` |
| Lernkonto (`auth.users`, `profiles`, `lernfortschritt`, `pruefungsfreigaben`, `kommentare`) | auf Anfrage sofort; nach 3 J. Inaktivität nach Ankündigung | Anfrage / Inaktivität | Löschen des Auth-Users im Dashboard — alles hängt per `on delete cascade` daran; `kursanmeldungen.user_id` wird `null` |
| Bilder | bei Widerruf der Einwilligung sofort | Widerruf | Datei entfernen, Deploy |

---

## 8. Informationssicherheit: Website- und Chat-Sicherheitsprüfung

### 8.1 Website-Sicherheitsprüfung (quartalsweise, gemeinsam mit ISMS)

- [ ] `python3 scripts/datenschutz-check.py` grün
- [ ] RLS: jede Tabelle `enable row level security`; keine Policy `using (true)` außer bewusst öffentlichen Daten (`kurse` aktiv, `kommentare`)
- [ ] `security definer`-Funktionen: haben `set search_path`, prüfen `auth.uid()`, ändern nur erlaubte Spalten
- [ ] Admin-Zugänge und Auth-Einstellungen gemäß internem ISMS
- [ ] Supabase Security Advisor im Dashboard: keine offenen Warnungen
- [ ] Keine Secrets im Repo und in der Git-Historie (automatisch + `run_secret_scanning`)
- [ ] Externe Bibliotheken: `js/vendor/` — Version aktuell? Sicherheitsmeldungen zu `supabase-js` prüfen
- [ ] XSS: Nutzereingaben (Kommentare, Anmerkungen, Mail-Inhalte) werden escaped (`escapeHtml`, `textContent`)
- [ ] GitHub: 2FA, Branch-Schutz für den Deploy-Branch, „Enforce HTTPS“ aktiv
- [ ] Veröffentlichte Website enthält keine internen Dateien (`/supabase/…`, `/PROJEKTPLAN.md` → 404)
- [ ] Content-Security-Policy: GitHub Pages kann keine HTTP-Header setzen → CSP als `<meta http-equiv>` prüfen (ISMS-Entscheidung)

### 8.2 Chat-Sicherheitsprüfung

**Ist-Zustand (02.10.2026):** Der „BETAMOVE Assistent“ ist regelbasiert (`js/main.js`, `bmChatReply`), läuft ausschließlich im Browser, sendet und speichert nichts, gibt Eingaben per `textContent` aus (kein XSS). Kennzeichnung „Automatischer Assistent (keine KI)“ ist vorhanden. → **Kein Datenschutzrisiko.**

**Pflicht-Prüfung, sobald der Chat geändert wird** (z. B. KI-Anbindung, Speicherung, Weiterleitung an Mitarbeitende):

- [ ] Change-Gate 6.1 → neue Zeile im VVT, Datenschutzerklärung ergänzen
- [ ] Anbieter mit AVV, Serverstandort EU bevorzugt, **kein Training mit Nutzereingaben** vertraglich ausgeschlossen
- [ ] KI-Kennzeichnung nach Art. 50 KI-Verordnung („Du chattest mit einer KI“)
- [ ] API-Schlüssel nur serverseitig (Edge Function), nie im Frontend
- [ ] Hinweis im Chat: keine Gesundheits- oder Kontodaten eingeben; Eingaben auf personenbezogene Daten filtern
- [ ] Schutz gegen Prompt-Injection/Missbrauch: Systemprompt ohne Geheimnisse, Antwortlänge/Rate-Limit begrenzen
- [ ] Protokolle: nur so lange wie nötig (Vorschlag ≤ 30 Tage), keine IP-Adressen speichern
- [ ] Ausgabe weiterhin per `textContent` bzw. gesäubertes Markdown (kein `innerHTML` mit Modell-Ausgaben)
- [ ] Datenschutz-Folgenabschätzung prüfen (Art. 35), falls Gesundheits-/Verletzungsfragen verarbeitet werden

---

## 9. Befundliste der Erstprüfung (02.10.2026)

### Bereits behoben (in diesem Branch)

| # | Befund | Risiko | Maßnahme |
|---|---|---|---|
| B1 | Google Fonts auf allen 49 Seiten direkt von Google geladen (IP-Übermittlung in die USA ohne Einwilligung) | **hoch** (Abmahnungen, LG München I 3 O 17493/20) | Poppins lokal unter `fonts/` (OFL-Lizenz beigelegt) |
| B2 | Supabase-Bibliothek von jsDelivr-CDN geladen (IP-Übermittlung, keine Integritätsprüfung) | mittel | lokal unter `js/vendor/supabase-js-2.45.4/` |
| B3 | Personenbezogene Metadaten (u. a. GPS) in mehreren Fotos | **hoch** | alle Bilder verlustfrei bereinigt; Fotograf im Impressum genannt |
| B4 | Datenschutzerklärung unvollständig: Hosting/Logfiles, Resend, Lernkonto, Kommentare, Local Storage, Rechtsgrundlagen, Widerspruchs- und Beschwerderecht, vollständige Anschrift fehlten | **hoch** | vollständig neu, abgeglichen mit dem Code |
| B5 | Widerrufsbelehrung ohne Muster-Widerrufsformular, AGB ohne Haftung/Lernkonto/Schlussbestimmungen | mittel | ergänzt (Entwurf, juristische Prüfung nötig) |
| B6 | „Ich akzeptiere die Datenschutzerklärung“ (Datenschutzerklärung ist Information, keine Einwilligung) | niedrig | auf „zur Kenntnis genommen“ geändert |
| B7 | Kommentare öffentlich, ohne Hinweis beim Schreiben | mittel | Hinweis am Kommentarfeld |
| B8 | Kontaktformular ohne Datenschutzhinweis | niedrig | Hinweis ergänzt |
| B9 | Admin-Seiten ohne Links zu Rechtstexten | niedrig | Footer ergänzt |
| B10 | Deploy veröffentlicht das komplette Repo (SQL-Schemas, Edge-Function-Code, Projektplan mit Admin-E-Mail) auf betamove.de | mittel | Deploy-Workflow veröffentlicht nur noch die Website-Dateien |

### Offen — Entscheidung/Aktion durch Verantwortliche oder Programmierer

*Sicherheitsbefunde werden ausschließlich im internen ISMS geführt und sind hier nicht aufgeführt.*

| # | Befund | Priorität | Wer | Vorschlag |
|---|---|---|---|---|
| O1 | **Benachrichtigungs-Mails mit Anmeldedaten (inkl. Telefonnummer) gehen an private Gmail-Adresse** — kein AVV mit Google möglich | **hoch** | Noel + Programmierer | `OWNER_EMAIL` in beiden Edge Functions auf `info@betamove.de` (Zoho, EU-RZ, AVV) umstellen und Functions neu deployen |
| O3 | AVV mit Supabase und Resend abschließen/bestätigen; EU-Region des Supabase-Projekts verifizieren | **hoch** | Noel | Supabase: Organization Settings → Legal/DPA; Resend: DPA akzeptieren |
| O4 | Einwilligungen der abgebildeten Personen (Team-Fotos Anna/Noel, Kursfotos mit erkennbaren Teilnehmenden) und Nutzungsrecht Fotograf Sebastian Ossinger schriftlich vorliegend? | **hoch** | Noel | Einwilligungen einholen/ablegen; sonst Bild tauschen |
| O5 | Rechtstexte juristisch prüfen lassen (Hinweis-Banner bleibt bis dahin) — insb. Widerrufsrecht: Kurse mit festem Termin fallen ggf. unter die Ausnahme § 312g Abs. 2 Nr. 9 BGB | **hoch** | Noel / Rechtsberatung | — |
| O6 | **Widerrufsbutton** (§ 356a BGB, seit 19.06.2026 Pflicht bei online geschlossenen Verträgen): bisher nur Text + E-Mail | **hoch** | Programmierer | Online-Formular „Vertrag widerrufen“ mit Eingangsbestätigung per Mail (Tabelle `widerrufe`, Edge Function) |
| O7 | Kein Self-Service zum Löschen des Kontos / eigener Kommentare | mittel | Programmierer | Button „Konto löschen“ (Edge Function mit service_role) und „Kommentar löschen“ (Policy existiert bereits) |
| O8 | Löschfristen nicht technisch umgesetzt | mittel | Programmierer | `pg_cron`-Job für V2/V3 laut Abschnitt 7 |
| O11 | Impressum: Telefonnummer und ggf. USt-IdNr. (falls vorhanden) ergänzen | niedrig | Noel | — |
| O13 | Git-Historie bereinigen (Bild-Altstände) | mittel | Noel entscheidet | nur nach Absprache, betrifft alle Branches |

---

## 10. Datenpannen und Betroffenenanfragen

**Datenpanne** (z. B. Daten öffentlich lesbar, Key geleakt, falscher Mail-Empfänger):
1. Sofort eindämmen (Key rotieren, Policy schließen, Seite offline).
2. Dokumentieren: was, wann, welche Daten, wie viele Personen.
3. Bewerten mit Datenschutz-Agent + ISMS: Risiko für Betroffene?
4. Meldung an die Sächsische Datenschutz- und Transparenzbeauftragte **innerhalb von 72 Stunden** (Art. 33), wenn ein Risiko nicht ausgeschlossen ist; bei hohem Risiko Betroffene informieren (Art. 34).
5. Ursache beheben, Konzept/Check ergänzen.

**Betroffenenanfrage** (Auskunft, Löschung, Berichtigung …): Eingang auf info@betamove.de → Identität prüfen (Antwort nur an hinterlegte Adresse) → innerhalb **1 Monat** beantworten → im Anfragen-Log (außerhalb des Repos) vermerken.

---

## 11. Schnittstelle zum ISMS

Dieses Konzept ist der **Datenschutz-Teil**; das ISMS verantwortet die übergreifende Informationssicherheit. Gemeinsame Punkte:

| Thema | Datenschutz-Konzept | ISMS |
|---|---|---|
| TOMs (Art. 32) | Mindeststand Abschnitt 4 | Detaillierung, Risikoanalyse, Härtung |
| Zugriffsrechte / RLS | Abgleich mit VVT (wer darf was sehen?) | technische Prüfung der Policies/Funktionen |
| Secrets | automatischer Check | Rotation, Aufbewahrung, Historien-Scan |
| Vorfälle | Meldepflichten Art. 33/34 | Incident-Response |
| Website-/Chat-Prüfung | Abschnitt 8 | gemeinsame quartalsweise Durchführung |

Änderungen am ISMS, die Daten oder Zugriffe betreffen, laufen über das Change-Gate (Abschnitt 6.1).
