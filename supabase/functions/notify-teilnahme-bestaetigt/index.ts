// BETAMOVE — Edge Function: E-Mail bei bestätigter Kursteilnahme
// ============================================================================
// Wofür: Wird von einem Datenbank-Trigger aufgerufen, sobald die Kursleitung
// im Adminbereich (admin-kurse) eine Teilnahme bestätigt
// (kursanmeldungen.teilnahme_bestaetigt wechselt auf true). Verschickt eine
// Mail an die betroffene Person — vorher war das nur im eigenen Konto
// sichtbar, nicht aktiv mitgeteilt.
//
// Einrichtung: siehe supabase/EMAIL-SETUP.md (gilt für alle drei
// notify-*-Functions, nutzt dasselbe WEBHOOK_SECRET).
// ============================================================================

const FROM_EMAIL = "BETAMOVE <info@betamove.de>";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API_URL = "https://api.resend.com/emails";

// Geteiltes Geheimnis mit dem Postgres-Trigger (supabase/manual-triggers.sql)
// — dasselbe wie bei den anderen beiden notify-*-Functions.
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

interface KursanmeldungRecord {
  id?: string;
  vorname: string;
  nachname: string;
  email: string;
  kurs_titel: string;
  kurs_datum?: string | null;
  teilnahme_bestaetigt_at?: string | null;
}

interface DatabaseWebhookPayload {
  type?: string;
  table?: string;
  record?: KursanmeldungRecord;
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

function customerEmailHtml(r: KursanmeldungRecord): string {
  const body = `
    <p style="margin:0 0 14px;font-size:15.5px;color:#3a3a36;">Hallo ${escapeHtml(r.vorname)},</p>
    <p style="margin:0 0 14px;font-size:15.5px;color:#3a3a36;">deine Teilnahme am Kurs <strong>${escapeHtml(r.kurs_titel)}</strong> wurde von uns bestätigt. Das zählt jetzt in deinem Konto zu deinen Qualifikationen.</p>
    <p style="margin:0;font-size:14px;color:#6b6b66;">Du kannst das jederzeit in deinem Konto unter „Mein Lernstand" nachsehen. Fragen? Antworte einfach auf diese E-Mail.</p>`;

  return emailLayout("Deine Teilnahme wurde bestätigt", body);
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
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
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

  // Nur der eigene Postgres-Trigger darf diese Function auslösen.
  if (!WEBHOOK_SECRET || req.headers.get("X-Webhook-Secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    console.error("notify-teilnahme-bestaetigt: Payload konnte nicht als JSON gelesen werden");
    return new Response(JSON.stringify({ ok: false, reason: "invalid_json" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const record = payload.record;
  if (!record || !record.email) {
    console.error("notify-teilnahme-bestaetigt: Payload enthält kein gültiges `record` mit E-Mail-Adresse", payload);
    return new Response(JSON.stringify({ ok: false, reason: "missing_record" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await sendEmail(
    record.email,
    `Deine Teilnahme am Kurs ${record.kurs_titel} wurde bestätigt`,
    customerEmailHtml(record),
  );
  if (!result.ok) {
    console.error("notify-teilnahme-bestaetigt: Mailversand fehlgeschlagen:", result.error);
  }

  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
