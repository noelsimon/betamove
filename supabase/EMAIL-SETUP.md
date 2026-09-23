# E-Mail-Benachrichtigungen einrichten (Resend + Supabase)

Diese Anleitung richtet sich an dich als Betreiberin, nicht an Programmierer*innen — du brauchst
dafür keine Kommandozeile, alles geht über zwei Web-Dashboards (Resend und Supabase). Am Ende
bekommst du bei jeder neuen Kursanmeldung eine E-Mail, und die anmeldende Person automatisch eine
Bestätigungsmail.

Der Code dafür ist bereits fertig (`supabase/functions/notify-kursanmeldung/` und
`supabase/functions/notify-kontaktanfrage/`) — hier geht es nur noch ums Scharfschalten.

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

## 4. Die beiden E-Mail-Functions bei Supabase einrichten

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

### 4b. API-Key als Secret hinterlegen

1. **Project Settings → Edge Functions → Secrets** (manchmal auch unter „Manage secrets" direkt in
   der Functions-Übersicht zu finden).
2. Neues Secret anlegen: Name genau `RESEND_API_KEY`, Wert = der Key aus Schritt 3.
3. Speichern. Das Secret gilt automatisch für alle Edge Functions des Projekts, also für beide.

### 4c. Absenderadresse prüfen

Am Anfang jeder der beiden Dateien steht:

```ts
const OWNER_EMAIL = "info@betamove.de"; // TODO: ggf. anpassen
const FROM_EMAIL = "BETAMOVE <info@betamove.de>"; // TODO: ggf. anpassen, sobald Domain bei Resend verifiziert ist
```

Falls deine echte Adresse anders lautet, oder du (siehe Schritt 2) vorerst mit der
Resend-Testadresse arbeitest, passe diese beiden Zeilen im Dashboard-Editor an, bevor du erneut
„Deploy" klickst.

## 5. Database Webhook einrichten

Das ist der Teil, der die Function tatsächlich auslöst, sobald ein Formular abgeschickt wird.

**Für die Kursanmeldung:**

1. Supabase-Dashboard → **Database → Webhooks → Create a new hook** (manchmal „New Webhook").
2. Name: z. B. „Kursanmeldung-Mail".
3. Tabelle: `kursanmeldungen`.
4. Events: nur **Insert** anhaken (Update/Delete nicht).
5. Type: **Supabase Edge Function**.
6. Function auswählen: `notify-kursanmeldung`.
7. Speichern.

**Für die Kontaktanfrage (optional, aber empfohlen):**

Gleiches Vorgehen, nur mit Tabelle `kontaktanfragen` und Function `notify-kontaktanfrage`.

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
supabase functions deploy notify-kursanmeldung
supabase functions deploy notify-kontaktanfrage
```

Den Database Webhook (Schritt 5) musst du trotzdem im Dashboard einrichten — dafür gibt es keinen
CLI-Befehl.
