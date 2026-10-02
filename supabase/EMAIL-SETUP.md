# E-Mail-Benachrichtigungen einrichten (Resend + Supabase)

Diese Anleitung richtet sich an dich als Betreiberin, nicht an Programmierer*innen — du brauchst
dafür keine Kommandozeile, alles geht über zwei Web-Dashboards (Resend und Supabase). Am Ende
bekommst du bei jeder neuen Kursanmeldung eine E-Mail, die anmeldende Person automatisch eine
Bestätigungsmail, und wenn du eine Teilnahme bestätigst, bekommt die betroffene Person ebenfalls
eine Mail.

Der Code dafür ist bereits fertig (`supabase/functions/notify-kursanmeldung/`,
`supabase/functions/notify-kontaktanfrage/` und `supabase/functions/notify-teilnahme-bestaetigt/`)
— hier geht es nur noch ums Scharfschalten.

## 1. Kostenloses Resend-Konto erstellen

1. Gehe auf [resend.com](https://resend.com) und klicke auf „Sign Up".
2. Registriere dich mit deiner E-Mail-Adresse (oder per Google-Konto).
3. Der kostenlose Tarif reicht für den Start völlig aus (3.000 E-Mails/Monat).

## 2. Eigene Domain bei Resend verifizieren

Damit die Mails glaubwürdig von `info@betamove.de` (oder deiner echten Domain) kommen — statt von
einer generischen Resend-Testadresse — musst du die Domain einmalig verifizieren. Das ist derselbe
Ablauf wie bei der Einrichtung von Zoho Mail, die du schon einmal gemacht hast: du trägst ein paar
DNS-Einträge bei deinem Domain-Registrar (dort, wo du die Domain gekauft hast) ein.

1. Im Resend-Dashboard: **Domains → Add Domain**.
2. Gib deine Domain ein (z. B. `betamove.de`).
3. Resend zeigt dir mehrere DNS-Einträge an (meist TXT- und MX/CNAME-Einträge zur
   Absender-Verifizierung, ähnlich wie bei Zoho).
4. Trage diese Einträge bei deinem Domain-Registrar ein (dort, wo du auch die Zoho-Einträge
   gesetzt hast).
5. Zurück im Resend-Dashboard auf „Verify" klicken. Das kann je nach Anbieter ein paar Minuten bis
   Stunden dauern, bis die DNS-Änderung überall sichtbar ist.

**Falls du das nicht sofort machen willst:** Du kannst zunächst mit der von Resend bereitgestellten
Testadresse `onboarding@resend.dev` starten, um alles andere schon zu testen — Mails kommen dann
aber sichtbar von „resend.dev" statt von deiner eigenen Domain. Trag das in diesem Fall unten in
Schritt 4 als `FROM_EMAIL` ein.

## 3. API-Key erzeugen

1. Im Resend-Dashboard: **API Keys → Create API Key**.
2. Name z. B. „BETAMOVE Website", Berechtigung „Sending access" reicht aus.
3. Der Key wird nur einmal angezeigt — kopiere ihn direkt in die Zwischenablage. Falls du ihn
   verlierst, musst du einen neuen erzeugen.

**Wichtig:** Dieser Key gehört niemals in den Website-Code oder ins GitHub-Repo — er wird gleich
als „Secret" direkt bei Supabase hinterlegt (nur dort sichtbar, nicht im Frontend).

## 4. Die drei E-Mail-Functions bei Supabase einrichten

Der einfachste Weg ohne Kommandozeile ist über das Supabase-Dashboard. (Falls du lieber mit der
Supabase-Kommandozeile arbeitest, findest du die Kurzfassung ganz unten.)

### 4a. Functions anlegen

1. Im Supabase-Dashboard deines Projekts: **Edge Functions → Deploy a new function** (oder
   „Create a new function").
2. Name: `notify-kursanmeldung`.
3. Öffne die Datei `supabase/functions/notify-kursanmeldung/index.ts` aus diesem Repo, kopiere den
   kompletten Inhalt und füge ihn im Dashboard-Editor ein. Speichern/Deploy klicken.
4. Wiederhole das für die zweite Function: Name `notify-kontaktanfrage`, Inhalt aus
   `supabase/functions/notify-kontaktanfrage/index.ts`.
5. Und für die dritte Function: Name `notify-teilnahme-bestaetigt`, Inhalt aus
   `supabase/functions/notify-teilnahme-bestaetigt/index.ts`.

### 4b. API-Key und Webhook-Passwort als Secrets hinterlegen

1. **Project Settings → Edge Functions → Secrets** (manchmal auch unter „Manage secrets" direkt in
   der Functions-Übersicht zu finden).
2. Neues Secret anlegen: Name genau `RESEND_API_KEY`, Wert = der Key aus Schritt 3.
3. Noch ein Secret anlegen: Name genau `WEBHOOK_SECRET`, Wert = ein langes Zufallspasswort deiner
   Wahl (z. B. vom Programmierer erhalten, oder selbst erzeugt). Dieses Passwort stellt sicher,
   dass nur der eigene Datenbank-Trigger (Schritt 5) die Function auslösen kann.
4. **Dasselbe Passwort** zusätzlich einmalig im SQL Editor hinterlegen (sonst schickt der Trigger
   es nicht mit):
   ```sql
   select vault.create_secret('<dasselbe-Zufallspasswort>', 'webhook_secret');
   ```
5. Speichern. Die Secrets gelten automatisch für alle Edge Functions des Projekts, also für alle drei.

### 4c. Absenderadresse prüfen

Am Anfang jeder der drei Dateien steht mindestens:

```ts
const FROM_EMAIL = "BETAMOVE <info@betamove.de>"; // TODO: ggf. anpassen, sobald Domain bei Resend verifiziert ist
```

(`notify-kursanmeldung` und `notify-kontaktanfrage` haben zusätzlich `OWNER_EMAIL` — die Adresse, an
die die Benachrichtigung an dich selbst geht.) Falls deine echte Adresse anders lautet, oder du
(siehe Schritt 2) vorerst mit der Resend-Testadresse arbeitest, passe die betroffenen Zeilen im
Dashboard-Editor an, bevor du erneut „Deploy" klickst.

## 5. Database Webhook einrichten

Das ist der Teil, der die Function tatsächlich auslöst, sobald ein Formular abgeschickt wird.

Bei diesem Projekt liefert das Dashboard-Feature „Database → Webhooks" den Fehler „schema
supabase_functions does not exist" (ein bekannter Bug bei manchen Projekten). Deshalb übernimmt das
stattdessen `supabase/manual-triggers.sql` — einmalig komplett im SQL Editor ausführen, **nachdem**
Schritt 4 (Functions deployt) und 4b (beide Secrets gesetzt, inkl. `webhook_secret` im Vault)
erledigt sind. Das Skript legt per SQL exakt denselben Mechanismus an wie ein Database Webhook
(Insert auf `kursanmeldungen`/`kontaktanfragen` → Edge Function aufrufen), nur ohne den kaputten
UI-Teil.

## 6. Testen

1. Öffne die Live-Website und fülle die Kursanmeldung (`anmeldung.html`) mit einer echten
   E-Mail-Adresse aus, die du selbst kontrollierst (z. B. deine eigene), und schicke sie ab.
2. Prüfe:
   - Kommt eine Mail bei `OWNER_EMAIL` (deiner eigenen Adresse) an, mit allen Anmeldedaten?
   - Kommt eine Bestätigungsmail bei der im Formular angegebenen Adresse an?
3. Falls eine oder beide Mails fehlen: Supabase-Dashboard → **Edge Functions → notify-kursanmeldung
   → Logs**. Dort stehen Fehlermeldungen (z. B. falscher API-Key, Domain noch nicht verifiziert).
   Die Testanmeldung selbst bleibt davon unberührt — sie wurde trotzdem korrekt gespeichert (die
   Function schlägt bei einem Mailfehler nie fehl, sie loggt ihn nur).
4. Wiederhole den Test bei Bedarf für das Kontaktformular (`kontakt.html`).

## Kurzfassung für die Kommandozeile (optional, nur falls du lieber so arbeitest)

Falls du die [Supabase CLI](https://supabase.com/docs/guides/cli) bereits installiert hast:

```bash
supabase login
supabase link --project-ref <dein-projekt-ref>
supabase secrets set RESEND_API_KEY=<dein-resend-api-key>
supabase secrets set WEBHOOK_SECRET=<dasselbe-Zufallspasswort-wie-im-Vault>
supabase functions deploy notify-kursanmeldung
supabase functions deploy notify-kontaktanfrage
supabase functions deploy notify-teilnahme-bestaetigt
```

Den Database Webhook (Schritt 5) musst du trotzdem im Dashboard einrichten — dafür gibt es keinen
CLI-Befehl.
