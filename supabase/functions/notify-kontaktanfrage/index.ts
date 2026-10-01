// BETAMOVE — Edge Function: E-Mail-Benachrichtigung bei neuer Kontaktanfrage
// ============================================================================
// Wofür: Wird von einem Supabase Database Webhook aufgerufen, sobald eine neue
// Zeile in der Tabelle `kontaktanfragen` eingefügt wird (Event: INSERT).
// Verschickt zwei E-Mails über die Resend-API:
//   1. eine Benachrichtigung an die Betreiberin (OWNER_EMAIL unten)
//   2. eine Bestätigungsmail an die absendende Person (Feld `email` der Zeile)
//
// Einrichtung: siehe supabase/EMAIL-SETUP.md (gilt für beide Functions).
// ============================================================================

// ---------------------------------------------------------------------------
// TODO / anzupassende Platzhalter
// ---------------------------------------------------------------------------

// Feste Adresse der Betreiberin, an die jede neue Kontaktanfrage gemeldet wird.
// Übergangsweise die private Gmail-Adresse, bis info@betamove.de über die
// eigene Domain eingerichtet ist. TODO: zurück auf info@betamove.de, sobald
// die Domain umgezogen und Zoho Mail dafür eingerichtet ist.
const OWNER_EMAIL = "noel.uhlrich@gmail.com";

// Absenderadresse. Muss zu einer bei Resend verifizierten Domain gehören
// (siehe supabase/EMAIL-SETUP.md, Schritt 2).
const FROM_EMAIL = "BETAMOVE <info@betamove.de>";

// ---------------------------------------------------------------------------

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API_URL = "https://api.resend.com/emails";

interface KontaktanfrageRecord {
  id?: string;
  name: string;
  email: string;
  betreff?: string | null;
  nachricht: string;
  created_at?: string;
}

interface DatabaseWebhookPayload {
  type?: string;
  table?: string;
  record?: KontaktanfrageRecord;
  schema?: string;
  old_record?: unknown;
}

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

function ownerEmailHtml(r: KontaktanfrageRecord): string {
  const rows: Array<[string, string]> = [
    ["Name", escapeHtml(r.name)],
    ["E-Mail", escapeHtml(r.email)],
    ["Betreff", r.betreff ? escapeHtml(r.betreff) : "—"],
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
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#faf9f7;border-radius:8px;overflow:hidden;">
      ${tableRows}
    </table>
    <p style="margin:20px 0 0;font-size:15px;color:#3a3a36;white-space:pre-wrap;">${escapeHtml(r.nachricht)}</p>
    <p style="margin:20px 0 0;font-size:13.5px;color:#6b6b66;">Alle Anfragen findest du außerdem jederzeit im Supabase-Dashboard (Tabelle „kontaktanfragen").</p>`;

  return emailLayout("Neue Kontaktanfrage", body);
}

function customerEmailHtml(r: KontaktanfrageRecord): string {
  const body = `
    <p style="margin:0 0 14px;font-size:15.5px;color:#3a3a36;">Danke, ${escapeHtml(r.name)}! Wir haben deine Nachricht erhalten und melden uns so schnell wie möglich bei dir zurück.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#faf9f7;border-radius:8px;overflow:hidden;margin:18px 0;">
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#6b6b66;white-space:nowrap;vertical-align:top;">Betreff</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eceae5;font-size:14px;color:#1c1c1a;">${r.betreff ? escapeHtml(r.betreff) : "—"}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-size:14px;color:#6b6b66;white-space:nowrap;vertical-align:top;">Deine Nachricht</td>
        <td style="padding:8px 12px;font-size:14px;color:#1c1c1a;white-space:pre-wrap;">${escapeHtml(r.nachricht)}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:14px;color:#6b6b66;">Das ist eine automatische Bestätigung, dass deine Nachricht bei uns angekommen ist. Fragen in der Zwischenzeit? Antworte einfach auf diese E-Mail.</p>`;

  return emailLayout("Deine Nachricht ist bei uns angekommen", body);
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
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    console.error("notify-kontaktanfrage: Payload konnte nicht als JSON gelesen werden");
    return new Response(JSON.stringify({ ok: false, reason: "invalid_json" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = payload.record;
  if (!record || !record.email) {
    console.error("notify-kontaktanfrage: Payload enthält kein gültiges `record` mit E-Mail-Adresse", payload);
    return new Response(JSON.stringify({ ok: false, reason: "missing_record" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Wie bei notify-kursanmeldung: ein Mailfehler darf den bereits erfolgten
  // Insert nicht blockieren, deshalb immer Status 200, Fehler nur geloggt.
  const results: Record<string, { ok: boolean; error?: string }> = {};

  results.owner = await sendEmail(
    OWNER_EMAIL,
    `Neue Kontaktanfrage: ${record.betreff || record.name}`,
    ownerEmailHtml(record),
  );
  if (!results.owner.ok) {
    console.error("notify-kontaktanfrage: Benachrichtigung an Betreiberin fehlgeschlagen:", results.owner.error);
  }

  results.customer = await sendEmail(
    record.email,
    "Deine Nachricht ist bei uns angekommen",
    customerEmailHtml(record),
  );
  if (!results.customer.ok) {
    console.error("notify-kontaktanfrage: Bestätigungsmail an absendende Person fehlgeschlagen:", results.customer.error);
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
