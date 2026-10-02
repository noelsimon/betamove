#!/usr/bin/env bash
# BETAMOVE — statische Sicherheitsprüfung (läuft in .github/workflows/security-scan.yml
# und lokal mit `bash scripts/security-check.sh`).
#
# FEHLER (Exit-Code 1) = muss vor dem Deploy behoben werden.
# WARNUNG             = zu prüfender Punkt.
set -uo pipefail
cd "$(dirname "$0")/.."

errors=0
warnings=0
gh() { [ -n "${GITHUB_ACTIONS:-}" ]; }

fail() { # $1 Datei, $2 Meldung
  errors=$((errors + 1))
  if gh; then echo "::error file=$1::$2"; else echo "FEHLER  $1: $2"; fi
}
warn() {
  warnings=$((warnings + 1))
  if gh; then echo "::warning file=$1::$2"; else echo "WARNUNG $1: $2"; fi
}

tracked_text_files() {
  git ls-files | grep -vE '\.(jpg|jpeg|png|gif|webp|mp4|ico|woff2?|ttf|pdf)$'
}

echo "== 1) Geheimnisse im Repo =="
# Secret Keys von Supabase, service_role-JWTs, Resend-Keys, private Schlüssel.
secret_re='sb_secret_[A-Za-z0-9_-]{10,}|re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
while IFS= read -r f; do
  if grep -qE "$secret_re" -- "$f"; then
    fail "$f" "Möglicher geheimer Schlüssel (Supabase Secret Key / Resend-Key / Private Key) gefunden"
  fi
  # JWTs prüfen: Payload dekodieren und auf role=service_role testen
  for jwt in $(grep -oE 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+' -- "$f" | sort -u); do
    payload=$(echo "$jwt" | cut -d. -f2 | tr '_-' '/+')
    while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="$payload="; done
    if echo "$payload" | base64 -d 2>/dev/null | grep -q '"service_role"'; then
      fail "$f" "service_role-JWT gefunden — hebelt RLS komplett aus, sofort rotieren"
    fi
  done
done < <(tracked_text_files)

echo "== 2) Row-Level-Security auf allen Tabellen =="
for t in $(grep -hoiE 'create table (if not exists )?(public\.)?[a-z_]+' supabase/*.sql | awk '{print $NF}' | sed 's/^public\.//' | sort -u); do
  if ! grep -qiE "alter table (public\.)?$t enable row level security" supabase/*.sql; then
    fail "supabase" "Tabelle '$t' ohne 'enable row level security'"
  fi
done

echo "== 3) security-definer-Funktionen =="
for f in supabase/*.sql; do
  # Jede Funktion als Block (von 'create ... function' bis '\$\$;') prüfen
  awk -v file="$f" '
    BEGIN { IGNORECASE = 1 }
    /create (or replace )?function/ { inblk = 1; blk = ""; name = $0 }
    inblk { blk = blk "\n" tolower($0) }
    inblk && /\$\$;/ {
      if (blk ~ /security definer/ && blk !~ /set search_path/) print "NOPATH\t" name
      inblk = 0
    }
  ' "$f" | while IFS=$'\t' read -r kind name; do
    fail "$f" "security-definer-Funktion ohne 'set search_path': $name"
  done
  if grep -qiE 'grant execute on function .* to anon' "$f"; then
    warn "$f" "Funktion für 'anon' freigegeben — prüfen, ob sie wirklich öffentlich sein darf"
  fi
done

echo "== 4) Policies =="
for f in supabase/*.sql; do
  if grep -qiE 'using \(true\)|with check \(true\)' "$f"; then
    warn "$f" "Policy mit 'true' (für alle offen) — nur für öffentliche Daten zulässig"
  fi
  if grep -qiE "user_metadata" "$f"; then
    fail "$f" "Policy nutzt user_metadata — ist vom Nutzer selbst änderbar, app_metadata verwenden"
  fi
  if grep -qiE "auth\.jwt\(\) ->> 'email' = '" "$f"; then
    warn "$f" "Admin-Rolle über fest eingetragene E-Mail"
  fi
done

echo "== 5) Edge Functions =="
for f in supabase/functions/*/index.ts; do
  [ -e "$f" ] || continue
  if ! grep -qiE 'WEBHOOK_SECRET|x-webhook-secret|timingSafeEqual|auth\.getUser|getClaims' "$f"; then
    warn "$f" "Edge Function prüft den Aufrufer nicht (kein Secret/JWT-Check)"
  fi
  if grep -qE 'Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)' "$f" && ! grep -qiE 'WEBHOOK_SECRET|auth\.getUser|getClaims' "$f"; then
    fail "$f" "Nutzt service_role, ohne den Aufrufer zu prüfen"
  fi
done

echo "== 6) Frontend =="
# Externe Scripts ohne Subresource Integrity
missing_sri=$(grep -lE '<script[^>]+src="https?://' -- *.html kurse/*.html 2>/dev/null | while read -r f; do
  grep -oE '<script[^>]+src="https?://[^>]*>' "$f" | grep -vq 'integrity=' && echo "$f"
done | wc -l)
if [ "$missing_sri" -gt 0 ]; then
  warn "html" "$missing_sri Seite(n) laden externe Scripts ohne integrity-Attribut"
fi
# Secret/Service-Key im Browser-Config
if grep -vE '^\s*//' js/supabase-config.js | grep -qiE 'service_role|sb_secret_|eyJ'; then
  fail "js/supabase-config.js" "Nicht-öffentlicher Key im Frontend"
fi
# Externe Fonts (DSGVO)
if grep -qlE 'fonts\.googleapis\.com' -- *.html 2>/dev/null; then
  warn "html" "Google Fonts werden extern geladen (IP-Übermittlung an Google)"
fi

echo
echo "Ergebnis: $errors Fehler, $warnings Warnung(en)"
[ "$errors" -eq 0 ]
