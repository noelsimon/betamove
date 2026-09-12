# Betamove — Website

Statische Website für Betamove (Kletterkurse & Kletterwissen). Reines HTML/CSS/JS,
kein Build-Schritt, kein Framework — bewusst so gehalten, damit der Inhalt später
leicht in WordPress übernommen werden kann (siehe unten).

## Struktur

```
index.html      Startseite
kurse.html      Kursübersicht mit Preisen
kontakt.html    Kontaktformular / Kursanmeldung
css/style.css   Gesamtes Styling (Design-Tokens oben in der Datei)
js/main.js      Mobiles Menü, Footer-Jahr
.github/workflows/deploy-pages.yml   Deployment nach GitHub Pages
```

## Vor der Veröffentlichung unbedingt anpassen

1. **Formular-Endpunkt in `kontakt.html`**: aktuell `action="https://formspree.io/f/DEINE-FORM-ID"`.
   Kostenloses Konto auf [formspree.io](https://formspree.io) anlegen, eigene Formular-ID
   einsetzen. Ohne echten Endpunkt gehen Anmeldungen verloren.
2. **Kontaktdaten** in Footer (`index.html`, `kurse.html`, `kontakt.html`): Platzhalter-E-Mail
   und -Adresse ersetzen.
3. **Preise, Kursinhalte, Statistiken** (`kurse.html`, `index.html`) sind Platzhalter — bitte
   mit echten Zahlen ersetzen.
4. **Datenschutzerklärung** verlinken/ergänzen (Pflicht bei einem Kontaktformular in Deutschland).

## GitHub Pages aktivieren (einmalig, manuell)

Der Workflow `.github/workflows/deploy-pages.yml` deployt automatisch bei jedem Push auf
`main`. Damit das greift, muss einmalig in den Repo-Einstellungen aktiviert werden:

**Settings → Pages → Source → „GitHub Actions"**

Das kann nur ein Mensch mit Repo-Zugriff anklicken — kein Automatisierungs-Tool kann das
für dich erledigen.

## Wichtig: keine echten Nutzerdaten in diesem Repo speichern

Git-Historie vergisst nichts. Anmeldungen/Kontaktdaten dürfen deshalb nie als Datei ins
Repo committet werden — sie laufen ausschließlich über den externen Formular-Dienst
(Formspree o. Ä.).

## Später: Konten, Quiz, Zertifikate, Kursbuchung

Für Nutzerkonten mit Login, Quiz-Fortschritt, digitalen Zertifikaten und Kursbuchung reicht
eine statische Seite nicht mehr aus — dafür braucht es ein echtes Backend mit Datenbank.
Geplanter Weg: WordPress + LearnDash/LifterLMS (Kurse, Quizze, Zertifikate) + WooCommerce
(Buchung/Zahlung), selbst gehostet z. B. auf einem VPS mit Nginx + PHP-FPM + MariaDB. Die
Inhalte aus diesem Repo (Text, Struktur, Design) lassen sich dann direkt als Vorlage für
die WordPress-Seiten übernehmen.
