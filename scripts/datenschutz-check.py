#!/usr/bin/env python3
"""Automatischer Datenschutz- und Sicherheits-Check für die BETAMOVE-Website.

Läuft lokal (python3 scripts/datenschutz-check.py) und bei jedem Push per
GitHub Action (.github/workflows/datenschutz-check.yml). Teil des Konzepts in
docs/datenschutz/DATENSCHUTZ-KONZEPT.md (Abschnitt 6, "Automatische Prüfungen").

Prüft:
  1. Bilder: keine Metadaten (GPS, Kamera, Namen, Canva-IDs) in JPEG/PNG
  2. Keine Einbindung externer Ressourcen (Schriften, Skripte, Styles, iframes)
     außer der freigegebenen Liste — jeder neue Dienst muss erst in die
     Datenschutzerklärung und das Verarbeitungsverzeichnis
  3. Kein Tracking/Analytics/Social-Plugins
  4. Rechtstexte vorhanden und auf jeder Seite verlinkt
  5. Datenschutzerklärung nennt alle eingesetzten Dienste und ist nicht älter
     als 12 Monate
  6. Keine Geheimnisse im Repo (service_role-Key, Resend-/Stripe-/GitHub-Keys)

Exit-Code 0 = alles ok, 1 = mindestens ein Fehler. Warnungen brechen nicht ab.
"""
import datetime
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

# Freigegebene externe Hosts, zu denen der Browser beim Seitenaufruf
# selbstständig Verbindungen aufbauen darf. Jeder Eintrag MUSS in
# datenschutz.html beschrieben sein (siehe REQUIRED_IN_POLICY).
ALLOWED_RESOURCE_HOSTS = {
    "nzmszupobienfwjaqcmw.supabase.co",  # Supabase (Auftragsverarbeiter)
}
# Begriffe, die in der Datenschutzerklärung vorkommen müssen, weil der
# jeweilige Dienst im Code verwendet wird (Muster im Code -> Begriff)
REQUIRED_IN_POLICY = {
    r"supabase": "Supabase",
    r"api\.resend\.com": "Resend",
    r"localStorage": "Local Storage",
}
LEGAL_PAGES = ["impressum", "datenschutz", "agb", "widerruf"]
TRACKING = re.compile(
    r"googletagmanager|google-analytics|gtag\(|fbq\(|connect\.facebook|hotjar|matomo|"
    r"plausible\.io|clarity\.ms|youtube\.com/embed|maps\.google|google\.com/maps/embed|"
    r"recaptcha|doubleclick|tiktok|linkedin\.com/insight",
    re.I)
SECRETS = [
    (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl"), "Supabase service_role-Key (JWT)"),
    (re.compile(r"sb_secret_[A-Za-z0-9_-]{10,}"), "Supabase Secret-Key"),
    (re.compile(r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}"), "Resend-API-Key"),
    (re.compile(r"\bsk_(live|test)_[A-Za-z0-9]{10,}"), "Stripe-Secret-Key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), "GitHub-Token"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "Privater Schlüssel"),
]
SKIP_DIRS = {".git", "node_modules", "vendor", "fonts"}

errors, warnings = [], []


def files(exts):
    for d, dirs, fs in os.walk("."):
        dirs[:] = [x for x in dirs if x not in SKIP_DIRS]
        for f in fs:
            if f.lower().endswith(exts):
                yield os.path.join(d, f)[2:]


# ---------------------------------------------------------------- 1. Bilder
def jpeg_meta(data):
    found, i = [], 2
    while i + 4 <= len(data) and data[i] == 0xFF:
        m = data[i + 1]
        if m == 0xDA:
            break
        if m == 0xFF:
            i += 1
            continue
        length = struct.unpack(">H", data[i + 2:i + 4])[0]
        seg = data[i + 4:i + 2 + length]
        if m == 0xE1 and seg.startswith(b"Exif"):
            found.append("EXIF" + (" mit GPS" if b"\x88\x25" in seg or b"\x25\x88" in seg else ""))
        elif m == 0xE1:
            found.append("XMP")
        elif m == 0xED:
            found.append("IPTC")
        elif m == 0xFE:
            found.append("Kommentar")
        i += 2 + length
    return found


def png_meta(data):
    found, i = [], 8
    while i + 8 <= len(data):
        length = struct.unpack(">I", data[i:i + 4])[0]
        t = data[i + 4:i + 8]
        if t in (b"tEXt", b"zTXt", b"iTXt", b"eXIf"):
            found.append(t.decode())
        if t == b"IEND":
            break
        i += 12 + length
    return found


for p in files((".jpg", ".jpeg", ".png")):
    data = open(p, "rb").read()
    meta = jpeg_meta(data) if p.lower().endswith((".jpg", ".jpeg")) else png_meta(data)
    if meta:
        errors.append(f"Bild mit Metadaten: {p} ({', '.join(sorted(set(meta)))}) "
                      f"-> python3 scripts/bild-metadaten-entfernen.py {p}")

# ------------------------------------------------ 2./3. Externe Ressourcen
RES_PATTERNS = [
    re.compile(r"<(?:script|img|iframe|video|audio|source|embed)\b[^>]*\bsrc=[\"'](https?:)?//([^/\"']+)", re.I),
    re.compile(r"<link\b(?=[^>]*\brel=[\"'](?:stylesheet|preconnect|preload|dns-prefetch|icon|modulepreload)[\"'])[^>]*\bhref=[\"'](https?:)?//([^/\"']+)", re.I),
    re.compile(r"@import\s+(?:url\()?[\"']?(https?:)?//([^/\"')]+)", re.I),
    re.compile(r"url\([\"']?(https?:)?//([^/\"')]+)", re.I),
]
web_files = list(files((".html", ".css", ".js")))
code_text = {}
for p in web_files:
    t = open(p, encoding="utf-8", errors="replace").read()
    code_text[p] = t
    for pat in RES_PATTERNS:
        for m in pat.finditer(t):
            host = m.group(2).lower()
            if host not in ALLOWED_RESOURCE_HOSTS:
                errors.append(f"Externe Ressource in {p}: {host} — lokal einbinden oder erst "
                              f"Datenschutzerklärung + Verarbeitungsverzeichnis ergänzen und Host freigeben")
    if TRACKING.search(t):
        errors.append(f"Tracking/Analytics/Embed gefunden in {p}: {TRACKING.search(t).group(0)}")

# ------------------------------------------------------- 4. Rechtstexte
for page in LEGAL_PAGES:
    if not os.path.exists(page + ".html"):
        errors.append(f"Rechtstext fehlt: {page}.html")
for p in (x for x in web_files if x.endswith(".html")):
    t = code_text[p]
    if "<footer" not in t:
        continue
    for page in LEGAL_PAGES:
        if not re.search(r'href="/?%s(\.html)?"' % page, t):
            errors.append(f"{p}: Footer verlinkt {page} nicht")

# ---------------------------------------------- 5. Datenschutzerklärung
ds = open("datenschutz.html", encoding="utf-8").read() if os.path.exists("datenschutz.html") else ""
all_code = "\n".join(code_text.values()) + "".join(
    open(p, encoding="utf-8").read() for p in files((".ts",)))
for pat, word in REQUIRED_IN_POLICY.items():
    if re.search(pat, all_code) and word.lower() not in ds.lower():
        errors.append(f"Datenschutzerklärung erwähnt '{word}' nicht, obwohl der Dienst im Code verwendet wird")
m = re.search(r"Stand:\s*(\d{2})\.(\d{2})\.(\d{4})", ds)
if not m:
    errors.append("Datenschutzerklärung hat kein 'Stand: TT.MM.JJJJ'")
else:
    stand = datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    age = (datetime.date.today() - stand).days
    if age > 365:
        errors.append(f"Datenschutzerklärung ist {age} Tage alt — jährliche Prüfung fällig (Konzept Abschnitt 5)")
    elif age > 300:
        warnings.append(f"Datenschutzerklärung ist {age} Tage alt — jährliche Prüfung bald fällig")

# ------------------------------------------------------------ 6. Secrets
for p in files((".html", ".js", ".ts", ".sql", ".md", ".json", ".yml", ".yaml", ".env", ".txt", ".toml")):
    if p.startswith("scripts/datenschutz-check"):
        continue
    t = open(p, encoding="utf-8", errors="replace").read()
    for pat, name in SECRETS:
        if pat.search(t):
            errors.append(f"Mögliches Geheimnis in {p}: {name} — sofort rotieren und aus dem Repo entfernen")
for p in files((".env",)):
    errors.append(f".env-Datei im Repo: {p}")

# ------------------------------------------------------------- Ausgabe
for w in warnings:
    print("WARNUNG:", w)
for e in errors:
    print("FEHLER: ", e)
print(f"\nDatenschutz-Check: {len(errors)} Fehler, {len(warnings)} Warnungen")
sys.exit(1 if errors else 0)
