#!/usr/bin/env bash
# Optionally email the private audit package to the maintainer.
# Requires:
#   SECURITY_AUDIT_NOTIFY_EMAIL (repo variable) — destination address
#   RESEND_API_KEY (Actions secret) — https://resend.com API key
#   SECURITY_AUDIT_EMAIL_FROM (optional repo variable) — verified From address
#     Must be an email or "Name <user@domain>". A bare name is invalid and is ignored.
#
# Usage: notify-email.sh <report.md> <cli-log> <session.md> <ghsa_id>
set -euo pipefail

REPORT="${1:?}"
CLI_LOG="${2:-}"
SESSION="${3:-}"
GHSA_ID="${4:-}"

TO="${SECURITY_AUDIT_NOTIFY_EMAIL:-}"
KEY="${RESEND_API_KEY:-}"
FROM="${SECURITY_AUDIT_EMAIL_FROM:-}"
DEFAULT_FROM="Issuebridge Security <onboarding@resend.dev>"

if [ -z "$TO" ] || [ -z "$KEY" ]; then
  echo "Email notify skipped (set SECURITY_AUDIT_NOTIFY_EMAIL + secret RESEND_API_KEY to enable)."
  exit 0
fi

# Resend rejects a bare display name; require an address somewhere in the value.
if [ -z "$FROM" ] || ! printf '%s' "$FROM" | grep -q '@'; then
  if [ -n "$FROM" ]; then
    echo "SECURITY_AUDIT_EMAIL_FROM does not contain an email address — falling back to default sender."
  fi
  FROM="$DEFAULT_FROM"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DATE="$(date -u +%Y-%m-%d)"
SUBJECT="[Issuebridge security-audit] ${DATE} ${GHSA_ID:-run}"

BODY_FILE="$WORK/body.txt"
{
  echo "Issuebridge security-audit completed."
  echo
  echo "Draft advisory id: ${GHSA_ID:-unknown} (Security -> Advisories, draft — admins only)."
  if [ -n "${SECURITY_AUDIT_RUN_URL:-}" ]; then
    echo "Actions run: ${SECURITY_AUDIT_RUN_URL}"
  fi
  echo
  echo "Report metadata:"
  grep -E '^\- \*\*(Mode|Scope|Date|Max severity|Finding count):\*\*' "$REPORT" || true
  echo
  echo "Full report and agent transcript are attached (and also in the draft advisory)."
} > "$BODY_FILE"

# Build attachments as a JSON file. Base64 payloads are far too large for argv,
# so every large value is passed to jq via --rawfile (not --arg).
ATTACH_FILE="$WORK/attachments.json"
echo '[]' > "$ATTACH_FILE"

MAX_BYTES=150000

add_attach() {
  local path="$1"
  local name="$2"
  [ -n "$path" ] || return 0
  [ -f "$path" ] || return 0
  [ -s "$path" ] || return 0

  local src="$path"
  local bytes
  bytes="$(wc -c < "$path" | tr -d '[:space:]')"
  if [ "$bytes" -gt "$MAX_BYTES" ]; then
    src="$WORK/trunc-$name"
    head -c "$MAX_BYTES" "$path" > "$src"
    name="${name}.truncated"
  fi

  base64 -w0 "$src" > "$WORK/b64" 2>/dev/null || base64 "$src" | tr -d '\n' > "$WORK/b64"

  jq --arg n "$name" --rawfile c "$WORK/b64" \
    '. + [{filename:$n, content:$c}]' "$ATTACH_FILE" > "$WORK/attachments.next"
  mv "$WORK/attachments.next" "$ATTACH_FILE"
  echo "Attached: $name ($(wc -c < "$src" | tr -d '[:space:]') bytes)"
}

add_attach "$REPORT" "security-audit-report.md"
add_attach "$SESSION" "security-audit-session.md"
add_attach "$CLI_LOG" "security-audit-cli.log"

PAYLOAD_FILE="$WORK/payload.json"
jq -n \
  --arg from "$FROM" \
  --arg to "$TO" \
  --arg subject "$SUBJECT" \
  --rawfile text "$BODY_FILE" \
  --slurpfile attachments "$ATTACH_FILE" \
  '{from:$from, to:[$to], subject:$subject, text:$text, attachments:$attachments[0]}' \
  > "$PAYLOAD_FILE"

HTTP_CODE="$(curl -sS -o "$WORK/resend-out.json" -w '%{http_code}' \
  -X POST 'https://api.resend.com/emails' \
  -H "Authorization: Bearer ${KEY}" \
  -H 'Content-Type: application/json' \
  --data-binary "@${PAYLOAD_FILE}")"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "Email notify sent (HTTP $HTTP_CODE)."
  exit 0
fi

echo "Email notify failed (HTTP $HTTP_CODE)."
# Surface only Resend's error name/message — never the payload or key.
jq -r '"resend_error: \(.name // "unknown") — \(.message // "no message")"' \
  "$WORK/resend-out.json" 2>/dev/null || echo "resend_error: unparseable response"
exit 1
