// BETAMOVE — Edge Function: E-Mail-Benachrichtigung bei neuer Kursanmeldung
// ============================================================================
// Wofür: Wird von einem Supabase Database Webhook aufgerufen, sobald eine neue
// Zeile in der Tabelle `kursanmeldungen` eingefügt wird (Event: INSERT).
// Verschickt zwei E-Mails über die Resend-API:
//   1. eine Benachrichtigung an die Betreiberin (OWNER_EMAIL unten)
//   2. eine Bestätigungsmail an die anmeldende Person (Feld `email` der Zeile)
//
// Einrichtung: siehe supabase/EMAIL-SETUP.md (Schritt-für-Schritt-Anleitung,
// auch ohne Kommandozeile machbar).
//
// Läuft als Supabase Edge Function (Deno + TypeScript). Der Resend-API-Key
// wird NICHT hier eingetragen, sondern als Secret über
// `supabase secrets set RESEND_API_KEY=...` oder das Supabase-Dashboard
// hinterlegt und hier ausschließlich über Deno.env.get() gelesen.
// ============================================================================

// ---------------------------------------------------------------------------
// TODO / anzupassende Platzhalter
// ---------------------------------------------------------------------------

// Feste Adresse der Betreiberin, an die jede neue Kursanmeldung gemeldet wird.
const OWNER_EMAIL = "info@betamove.de"; // TODO: ggf. anpassen

// Absenderadresse für beide Mails. Muss zu einer bei Resend verifizierten
// Domain gehören (siehe supabase/EMAIL-SETUP.md, Schritt 2). Bis die eigene
// Domain verifiziert ist, kann ersatzweise die von Resend bereitgestellte
// Testadresse "onboarding@resend.dev" verwendet werden (kommt dann aber
// sichtbar von "resend.dev", nicht von der eigenen Domain).
// Übergangsweise Resend-Testadresse, bis die eigene Domain bei Resend
// verifiziert ist (Domain-Umzug von Jimdo läuft noch). Sobald verifiziert:
// zurück auf "BETAMOVE <info@betamove.de>" ändern.
const FROM_EMAIL = "BETAMOVE <onboarding@resend.dev>"; // TODO: zurück auf eigene Domain, sobald bei Resend verifiziert

// ---------------------------------------------------------------------------

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API_URL = "https://api.resend.com/emails";

interface KursanmeldungRecord {
  id?: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon?: string | null;
  kurs_id: string;
  kurs_titel: string;
  level: string;
  leihmaterial?: string[] | null;
  rabatt_typ?: string | null;
  anmerkungen?: string | null;
  agb_akzeptiert?: boolean;
  created_at?: string;
}

interface DatabaseWebhookPayload {
  type?: string;
  table?: string;
  record?: KursanmeldungRecord;
  schema?: string;
  old_record?: unknown;
}

// Kleine Hilfsfunktion: HTML-Sonderzeichen escapen, damit z. B. Anmerkungen
// mit "<" oder "&" die E-Mail nicht kaputt machen.
function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    });
  } catch {
    return iso;
  }
}

function formatLeihmaterial(items?: string[] | null): string {
  if (!items || items.length === 0) return "kein Leihmaterial gewünscht";
  return items.join(", ");
}

function formatRabatt(rabattTyp?: string | null): string {
  return rabattTyp === "student"
    ? "Studierenden-/Azubi-Rabatt (Nachweis wird vor Ort geprüft)"
    : "kein Rabatt";
}

// Gemeinsamer, schlichter E-Mail-Rahmen im Ton der Website (freundlich, klar,
// wenig Schnickschnack).
function emailLayout(title: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f3f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#1c1c1a;padding:24px 28px;">
              <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;">BETAMOVE</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${title}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f4f3f0;font-size:12.5px;color:#6b6b66;">
              Diese E-Mail wurde automatisch von der BETAMOVE-Website versendet.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

function ownerEmailHtml(r: KursanmeldungRecord): string {
  const rows: Array<[string, string]> = [
    ["Name", `${escapeHtml(r.vorname)} ${escapeHtml(r.nachname)}`],
    ["E-Mail", escapeHtml(r.email)],
    ["Telefon", escapeHtml(r.telefon) || "—"],
    ["Kurs", `${escapeHtml(r.kurs_titel)} (${escapeHtml(r.kurs_id)})`],
    ["Level", escapeHtml(r.level)],
    ["Leihmaterial", escapeHtml(formatLeihmaterial(r.leihmaterial))],
    ["Rabatt", escapeHtml(formatRabatt(r.rabatt_typ))],
    ["Anmerkungen", r.anmerkungen ? escapeHtml(r.anmerkungen) : "—"],
    ["AGB akzeptiert", r.agb_akzeptiert ? "Ja" : "Nein"],
    ["Eingegangen am", formatDate(r.created_at)],
  ];

  const tableRows = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#6b6b66;white-space:nowrap;vertical-align:top;">${label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#1c1c1a;">${value}</td>
        </tr>`,
    )
    .join("");

  const body = `
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a36;">Neue Kursanmeldung über die Website — hier alle Angaben im Überblick:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#faf9f7;border-radius:8px;overflow:hidden;">
      ${tableRows}
    </table>
    <p style="margin:20px 0 0;font-size:13.5px;color:#6b6b66;">Alle Anmeldungen findest du außerdem jederzeit im Supabase-Dashboard (Tabelle „kursanmeldungen").</p>`;

  return emailLayout("Neue Kursanmeldung", body);
}

function customerEmailHtml(r: KursanmeldungRecord): string {
  const body = `
    <p style="margin:0 0 14px;font-size:15.5px;color:#3a3a36;">Danke, ${escapeHtml(r.vorname)}! Wir haben deine Anmeldung für <strong>${escapeHtml(r.kurs_titel)}</strong> erhalten und melden uns innerhalb von 48 Stunden per E-Mail mit der Bestätigung und allen Details.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#faf9f7;border-radius:8px;overflow:hidden;margin:18px 0;">
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#6b6b66;white-space:nowrap;vertical-align:top;">Kurs</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#1c1c1a;">${escapeHtml(r.kurs_titel)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#6b6b66;white-space:nowrap;vertical-align:top;">Level</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#1c1c1a;">${escapeHtml(r.level)}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:14px;color:#6b6b66;white-space:nowrap;vertical-align:top;">Leihmaterial</td>
        <td style="padding:8px 12px;font-size:14px;color:#1c1c1a;">${escapeHtml(formatLeihmaterial(r.leihmaterial))}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:14px;color:#6b6b66;">Das ist eine automatische Bestätigung, dass deine Anmeldung bei uns angekommen ist — die Anmeldung selbst ist damit noch nicht verbindlich bestätigt. Fragen in der Zwischenzeit? Antworte einfach auf diese E-Mail oder schreib uns über das Kontaktformular auf der Website.</p>`;

  return emailLayout("Deine Anmeldung ist bei uns angekommen", body);
}

async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY ist nicht als Secret gesetzt" };
  }
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Resend antwortete mit Status ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Netzwerkfehler beim Resend-Aufruf: ${err instanceof Error ? err.message : String(err)}` };
  }
}

Deno.serve(async (req: Request) => {
  // Nur POST wird erwartet (Supabase Database Webhooks senden POST).
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    // Kaputtes JSON -> nichts, das wir sinnvoll verarbeiten können. Trotzdem
    // 200, damit Supabase den Webhook nicht endlos wiederholt.
    console.error("notify-kursanmeldung: Payload konnte nicht als JSON gelesen werden");
    return new Response(JSON.stringify({ ok: false, reason: "invalid_json" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = payload.record;
  if (!record || !record.email) {
    console.error("notify-kursanmeldung: Payload enthält kein gültiges `record` mit E-Mail-Adresse", payload);
    return new Response(JSON.stringify({ ok: false, reason: "missing_record" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // WICHTIG: Ein Fehler beim Mailversand darf den Datenbank-Insert niemals
  // rückgängig machen oder blockieren — der Webhook läuft grundsätzlich erst
  // NACH dem bereits erfolgreichen Insert. Deshalb wird hier in jedem Fall
  // (auch bei Fehlern) mit Status 200 geantwortet, Fehler werden nur geloggt.
  const results: Record<string, { ok: boolean; error?: string }> = {};

  results.owner = await sendEmail(
    OWNER_EMAIL,
    `Neue Kursanmeldung: ${record.vorname} ${record.nachname} — ${record.kurs_titel}`,
    ownerEmailHtml(record),
  );
  if (!results.owner.ok) {
    console.error("notify-kursanmeldung: Benachrichtigung an Betreiberin fehlgeschlagen:", results.owner.error);
  }

  results.customer = await sendEmail(
    record.email,
    `Deine Anmeldung für ${record.kurs_titel} ist eingegangen`,
    customerEmailHtml(record),
  );
  if (!results.customer.ok) {
    console.error("notify-kursanmeldung: Bestätigungsmail an anmeldende Person fehlgeschlagen:", results.customer.error);
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
