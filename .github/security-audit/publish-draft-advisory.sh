#!/usr/bin/env bash
# Publish a security-audit report as a draft repository Security Advisory (private until published).
# Always creates a draft for full audits (including clean runs) so maintainers can see what the
# agent produced. Finding bodies and CLI transcripts must NEVER be printed to public Actions logs.
#
# Usage: publish-draft-advisory.sh <report.md> [cli-log] [session.md]
set -euo pipefail

REPORT="${1:?report file required}"
CLI_LOG="${2:-}"
SESSION="${3:-}"

if [ ! -f "$REPORT" ]; then
  echo "missing report: $REPORT" >&2
  exit 1
fi

OWNER="${GITHUB_REPOSITORY%/*}"
REPO="${GITHUB_REPOSITORY#*/}"
DATE="$(date -u +%Y-%m-%d)"
RUN_URL="${SECURITY_AUDIT_RUN_URL:-}"
MODE="${SECURITY_AUDIT_MODE:-full}"

out() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  fi
}

# Safe metadata only (no finding bodies) — helps debug false cleans in Actions logs.
echo "Report path: $REPORT"
echo "Report bytes: $(wc -c < "$REPORT" | tr -d '[:space:]')"
if grep -E '^\- \*\*(Mode|Scope|Date|Max severity|Finding count):\*\*' "$REPORT" >/dev/null 2>&1; then
  echo "Report metadata:"
  grep -E '^\- \*\*(Mode|Scope|Date|Max severity|Finding count):\*\*' "$REPORT" || true
fi

COUNT="$(grep -cE '^### F[0-9]+ [—-]' "$REPORT" || true)"
COUNT="$(printf '%s' "$COUNT" | tr -d '[:space:]')"
if [ -z "$COUNT" ]; then COUNT=0; fi

HEADER_COUNT="$(grep -Eie '^\- \*\*Finding count:\*\*[[:space:]]*[0-9]+' "$REPORT" | head -n1 | grep -Eo '[0-9]+$' || true)"
HEADER_COUNT="$(printf '%s' "${HEADER_COUNT:-}" | tr -d '[:space:]')"
echo "Parsed F-headings: $COUNT"
if [ -n "${HEADER_COUNT:-}" ]; then
  echo "Header Finding count: $HEADER_COUNT"
fi

FORMAT_MISMATCH=false
if [ "$COUNT" = "0" ] && [ -n "${HEADER_COUNT:-}" ] && [ "$HEADER_COUNT" != "0" ]; then
  FORMAT_MISMATCH=true
  echo "WARNING: header Finding count=$HEADER_COUNT but no '### Fn —' headings matched."
fi

MAX="low"
if [ "$COUNT" != "0" ]; then
  MAX="medium"
  if grep -qiE '\*\*Severity:\*\*[[:space:]]*Critical' "$REPORT"; then
    MAX="critical"
  elif grep -qiE '\*\*Severity:\*\*[[:space:]]*High' "$REPORT"; then
    MAX="high"
  fi
fi

if [ "$COUNT" = "0" ]; then
  SUMMARY="[Security audit] ${DATE} — clean run (0 Medium+ findings)"
else
  SUMMARY="[Security audit] ${DATE} — ${COUNT} finding(s), max=${MAX}"
fi
if [ "$FORMAT_MISMATCH" = "true" ]; then
  SUMMARY="[Security audit] ${DATE} — FORMAT MISMATCH (header=${HEADER_COUNT}, headings=0)"
fi
SUMMARY="$(printf '%s' "$SUMMARY" | head -c 1024)"

{
  cat "$REPORT"
  echo
  echo "---"
  echo
  echo "## Run metadata"
  echo
  echo "- Mode: \`${MODE}\`"
  if [ -n "$RUN_URL" ]; then
    echo "- Actions run: ${RUN_URL}"
  fi
  echo "- Captured at (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ "$FORMAT_MISMATCH" = "true" ]; then
    echo "- Format mismatch: header Finding count=${HEADER_COUNT} but F-headings=${COUNT}"
  fi

  if [ -n "$SESSION" ] && [ -f "$SESSION" ] && [ -s "$SESSION" ]; then
    echo
    echo "---"
    echo
    echo "## Agent session transcript"
    echo
    # Leave room under the 65535 advisory description cap.
    head -c 40000 "$SESSION"
    echo
  elif [ -n "$CLI_LOG" ] && [ -f "$CLI_LOG" ] && [ -s "$CLI_LOG" ]; then
    echo
    echo "---"
    echo
    echo "## Agent CLI log (truncated)"
    echo
    echo '```'
    head -c 35000 "$CLI_LOG"
    echo
    echo '```'
  fi
} > /tmp/security-audit-advisory-body.md

DESCRIPTION="$(head -c 65000 /tmp/security-audit-advisory-body.md)"

PAYLOAD="$(jq -n \
  --arg summary "$SUMMARY" \
  --arg description "$DESCRIPTION" \
  --arg severity "$MAX" \
  '{
    summary: $summary,
    description: $description,
    severity: $severity,
    vulnerabilities: [
      {
        package: { ecosystem: "other", name: "issuebridge" },
        vulnerable_version_range: "*",
        patched_versions: null,
        vulnerable_functions: []
      }
    ]
  }')"

RESP="$(gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  "/repos/${OWNER}/${REPO}/security-advisories" \
  --input - <<<"$PAYLOAD")"

URL="$(jq -r '.html_url // empty' <<<"$RESP")"
GHSA="$(jq -r '.ghsa_id // empty' <<<"$RESP")"
echo "Created draft advisory ${GHSA} (details private to admins/security managers)."
# Do NOT echo the advisory URL — public Actions logs would leak a private handle.
out "advisory_url="
out "ghsa_id=$GHSA"
out "finding_count=$COUNT"
out "max_severity=$MAX"
out "format_mismatch=$FORMAT_MISMATCH"
out "published=true"
