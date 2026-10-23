// BETAMOVE — Edge Function: E-Mail-Erinnerungen für fällige Trainerschein-Fortbildungen
// ============================================================================
// Wofür: Wird einmal täglich von einem pg_cron-Job aufgerufen (siehe
// supabase/schema-trainerscheine.sql, Abschnitt 3) — anders als die anderen
// drei notify-*-Functions reagiert diese nicht auf ein einzelnes INSERT/UPDATE,
// sondern prüft bei jedem Aufruf ALLE aktiven Trainerscheine aller Konten
// (deshalb der Service-Role-Key statt eines einzelnen "record"-Payloads).
//
// Für jeden Trainerschein wird der aktuelle Zyklus (letzte Fortbildung, sonst
// Absolvierungsdatum) herangezogen und geprüft, ob eine der gewünschten
// Erinnerungsschwellen (6/3/1 Monate vor Fälligkeit) erreicht ist und noch
// nicht für diesen Zyklus verschickt wurde. Nach Versand wird das jeweilige
// "...am"-Feld gesetzt, damit dieselbe Erinnerung nicht täglich erneut kommt.
//
// Einrichtung: siehe supabase/EMAIL-SETUP.md (nutzt dasselbe WEBHOOK_SECRET
// wie die anderen drei Functions). Zusätzlich benötigt diese Function Zugriff
// auf die Datenbank — dafür werden die von Supabase automatisch bereit-
// gestellten Umgebungsvariablen SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY
// verwendet (kein zusätzliches Secret nötig).
// ============================================================================

const FROM_EMAIL = "BETAMOVE <info@betamove.de>";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_API_URL = "https://api.resend.com/emails";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET");

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

interface Trainerschein {
  id: string;
  user_id: string;
  bezeichnung: string;
  absolvierungsdatum: string;
  rhythmus_jahre: number;
  erinnerung_6_monate: boolean;
  erinnerung_3_monate: boolean;
  erinnerung_1_monat: boolean;
  erinnerung_6_monate_am: string | null;
  erinnerung_3_monate_am: string | null;
  erinnerung_1_monat_am: string | null;
}

interface Schwelle {
  monate: number;
  flag: "erinnerung_6_monate" | "erinnerung_3_monate" | "erinnerung_1_monat";
  gesendetFeld: "erinnerung_6_monate_am" | "erinnerung_3_monate_am" | "erinnerung_1_monat_am";
}

const SCHWELLEN: Schwelle[] = [
  { monate: 6, flag: "erinnerung_6_monate", gesendetFeld: "erinnerung_6_monate_am" },
  { monate: 3, flag: "erinnerung_3_monate", gesendetFeld: "erinnerung_3_monate_am" },
  { monate: 1, flag: "erinnerung_1_monat", gesendetFeld: "erinnerung_1_monat_am" },
];

function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setMonth(r.getMonth() + months);
  return r;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("de-DE");
}

async function restFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY ?? "",
      Authorization: `Bearer ${SERVICE_ROLE_KEY ?? ""}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
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

function erinnerungEmailHtml(vorname: string, bezeichnung: string, naechsteFaelligkeit: string, tageUebrig: number): string {
  const frist = tageUebrig < 0
    ? `ist seit ${Math.abs(tageUebrig)} Tagen überfällig (fällig war der ${fmtDate(naechsteFaelligkeit)}).`
    : `ist in ${tageUebrig} Tagen fällig (${fmtDate(naechsteFaelligkeit)}).`;
  const body = `
    <p style="margin:0 0 14px;font-size:15.5px;color:#3a3a36;">Hallo ${escapeHtml(vorname)},</p>
    <p style="margin:0 0 14px;font-size:15.5px;color:#3a3a36;">deine Fortbildung für <strong>${escapeHtml(bezeichnung)}</strong> ${frist}</p>
    <p style="margin:0;font-size:14px;color:#6b6b66;">Sobald du die Fortbildung gemacht hast, trag sie in deinem Konto unter „Trainerscheine" ein — die Frist läuft dann automatisch neu.</p>`;
  return emailLayout("Fortbildung steht an", body);
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
  if (!WEBHOOK_SECRET || req.headers.get("X-Webhook-Secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("notify-trainerschein-erinnerung: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY fehlen");
    return new Response(JSON.stringify({ ok: false, reason: "missing_env" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const scheineRes = await restFetch(
    "trainerscheine?select=id,user_id,bezeichnung,absolvierungsdatum,rhythmus_jahre,erinnerung_6_monate,erinnerung_3_monate,erinnerung_1_monat,erinnerung_6_monate_am,erinnerung_3_monate_am,erinnerung_1_monat_am&aktiv=eq.true",
  );
  if (!scheineRes.ok) {
    const text = await scheineRes.text();
    console.error("notify-trainerschein-erinnerung: Laden der Trainerscheine fehlgeschlagen:", text);
    return new Response(JSON.stringify({ ok: false, reason: "load_failed" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  const scheine: Trainerschein[] = await scheineRes.json();
  if (!scheine.length) {
    return new Response(JSON.stringify({ ok: true, geprueft: 0, versendet: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const scheinIds = scheine.map((s) => s.id);
  const fortbRes = await restFetch(
    `trainerschein_fortbildungen?select=trainerschein_id,datum&trainerschein_id=in.(${scheinIds.join(",")})&order=datum.desc`,
  );
  const letzteFortbildungByschein: Record<string, string> = {};
  if (fortbRes.ok) {
    const rows: { trainerschein_id: string; datum: string }[] = await fortbRes.json();
    for (const r of rows) {
      if (!letzteFortbildungByschein[r.trainerschein_id]) letzteFortbildungByschein[r.trainerschein_id] = r.datum;
    }
  }

  const userIds = Array.from(new Set(scheine.map((s) => s.user_id)));
  const profilRes = await restFetch(`profiles?select=id,vorname,email&id=in.(${userIds.join(",")})`);
  const profilById: Record<string, { vorname: string; email: string }> = {};
  if (profilRes.ok) {
    const rows: { id: string; vorname: string; email: string }[] = await profilRes.json();
    for (const r of rows) profilById[r.id] = { vorname: r.vorname, email: r.email };
  }

  const today = new Date(todayIso() + "T00:00:00");
  let versendet = 0;

  for (const schein of scheine) {
    const zyklusStartIso = letzteFortbildungByschein[schein.id] && letzteFortbildungByschein[schein.id] > schein.absolvierungsdatum
      ? letzteFortbildungByschein[schein.id]
      : schein.absolvierungsdatum;
    const zyklusStart = new Date(zyklusStartIso + "T00:00:00");
    const naechsteFaelligkeit = addMonths(zyklusStart, schein.rhythmus_jahre * 12);
    const tageUebrig = Math.round((naechsteFaelligkeit.getTime() - today.getTime()) / 86400000);

    const faelligeSchwellen = SCHWELLEN.filter((s) => {
      if (!schein[s.flag]) return false;
      if (schein[s.gesendetFeld]) return false;
      const schwellenDatum = addMonths(naechsteFaelligkeit, -s.monate);
      return today.getTime() >= schwellenDatum.getTime();
    });
    if (!faelligeSchwellen.length) continue;

    const profil = profilById[schein.user_id];
    if (!profil || !profil.email) continue;

    const result = await sendEmail(
      profil.email,
      `Fortbildung steht an: ${schein.bezeichnung}`,
      erinnerungEmailHtml(profil.vorname, schein.bezeichnung, naechsteFaelligkeit.toISOString().slice(0, 10), tageUebrig),
    );
    if (!result.ok) {
      console.error(`notify-trainerschein-erinnerung: Mailversand fehlgeschlagen für ${schein.id}:`, result.error);
      continue;
    }

    const patchBody: Record<string, string> = {};
    for (const s of faelligeSchwellen) patchBody[s.gesendetFeld] = todayIso();
    await restFetch(`trainerscheine?id=eq.${schein.id}`, { method: "PATCH", body: JSON.stringify(patchBody) });
    versendet++;
  }

  return new Response(JSON.stringify({ ok: true, geprueft: scheine.length, versendet }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
