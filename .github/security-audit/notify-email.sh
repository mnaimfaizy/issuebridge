#!/usr/bin/env bash
# Optionally email the private audit package to the maintainer.
# Requires:
#   SECURITY_AUDIT_NOTIFY_EMAIL (repo variable) — destination address
#   RESEND_API_KEY (Actions secret) — https://resend.com API key
#   SECURITY_AUDIT_EMAIL_FROM (optional repo variable) — verified From address
#
# Usage: notify-email.sh <report.md> <cli-log> <session.md> <ghsa_id>
set -euo pipefail

REPORT="${1:?}"
CLI_LOG="${2:-}"
SESSION="${3:-}"
GHSA_ID="${4:-}"

TO="${SECURITY_AUDIT_NOTIFY_EMAIL:-}"
KEY="${RESEND_API_KEY:-}"
FROM="${SECURITY_AUDIT_EMAIL_FROM:-onboarding@resend.dev}"

if [ -z "$TO" ] || [ -z "$KEY" ]; then
  echo "Email notify skipped (set SECURITY_AUDIT_NOTIFY_EMAIL + secret RESEND_API_KEY to enable)."
  exit 0
fi

DATE="$(date -u +%Y-%m-%d)"
SUBJECT="[Issuebridge security-audit] ${DATE} ${GHSA_ID:-run}"

BODY_FILE="$(mktemp)"
{
  echo "Issuebridge security-audit completed."
  echo
  echo "Draft advisory id: ${GHSA_ID:-unknown} (Security → Advisories, draft — admins only)."
  if [ -n "${SECURITY_AUDIT_RUN_URL:-}" ]; then
    echo "Actions run: ${SECURITY_AUDIT_RUN_URL}"
  fi
  echo
  echo "Report metadata:"
  grep -E '^\- \*\*(Mode|Scope|Date|Max severity|Finding count):\*\*' "$REPORT" || true
  echo
  echo "Full report and agent transcript are attached (and also in the draft advisory)."
} > "$BODY_FILE"

# Build a small multipart-ish JSON with attachments as base64 (Resend supports attachments).
ATTACH_JSON='[]'
add_attach() {
  local path="$1"
  local name="$2"
  if [ -f "$path" ] && [ -s "$path" ]; then
    local b64
    b64="$(base64 -w0 "$path" 2>/dev/null || base64 "$path" | tr -d '\n')"
    # Cap each attachment ~200KB decoded to keep the API payload reasonable.
    local bytes
    bytes="$(wc -c < "$path" | tr -d '[:space:]')"
    if [ "$bytes" -gt 200000 ]; then
      head -c 200000 "$path" > /tmp/sa-attach-trunc
      b64="$(base64 -w0 /tmp/sa-attach-trunc 2>/dev/null || base64 /tmp/sa-attach-trunc | tr -d '\n')"
      name="${name}.truncated"
    fi
    ATTACH_JSON="$(jq -c --arg n "$name" --arg c "$b64" '. + [{filename:$n, content:$c}]' <<<"$ATTACH_JSON")"
  fi
}

add_attach "$REPORT" "security-audit-report.md"
add_attach "$SESSION" "security-audit-session.md"
add_attach "$CLI_LOG" "security-audit-cli.log"

PAYLOAD="$(jq -n \
  --arg from "$FROM" \
  --arg to "$TO" \
  --arg subject "$SUBJECT" \
  --rawfile text "$BODY_FILE" \
  --argjson attachments "$ATTACH_JSON" \
  '{from:$from, to:[$to], subject:$subject, text:$text, attachments:$attachments}')"

HTTP_CODE="$(curl -sS -o /tmp/resend-out.json -w '%{http_code}' \
  -X POST 'https://api.resend.com/emails' \
  -H "Authorization: Bearer ${KEY}" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD")"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "Email notify sent (HTTP $HTTP_CODE)."
else
  echo "Email notify failed (HTTP $HTTP_CODE). Response redacted from public logs."
  exit 1
fi
