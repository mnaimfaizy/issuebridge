#!/usr/bin/env bash
# Publish a security-audit report as a draft repository Security Advisory (private until published).
# Usage: publish-draft-advisory.sh <report.md>
set -euo pipefail

REPORT="${1:?report file required}"
if [ ! -f "$REPORT" ]; then
  echo "missing report: $REPORT" >&2
  exit 1
fi

OWNER="${GITHUB_REPOSITORY%/*}"
REPO="${GITHUB_REPOSITORY#*/}"
DATE="$(date -u +%Y-%m-%d)"

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

# Accept em-dash or ASCII hyphen in finding headings.
COUNT="$(grep -cE '^### F[0-9]+ [—-]' "$REPORT" || true)"
COUNT="$(printf '%s' "$COUNT" | tr -d '[:space:]')"
if [ -z "$COUNT" ]; then COUNT=0; fi

# Secondary signal from the report header if headings were malformed.
HEADER_COUNT="$(grep -Eie '^\- \*\*Finding count:\*\*[[:space:]]*[0-9]+' "$REPORT" | head -n1 | grep -Eo '[0-9]+$' || true)"
HEADER_COUNT="$(printf '%s' "${HEADER_COUNT:-}" | tr -d '[:space:]')"
echo "Parsed F-headings: $COUNT"
if [ -n "${HEADER_COUNT:-}" ]; then
  echo "Header Finding count: $HEADER_COUNT"
fi

if [ "$COUNT" = "0" ]; then
  if [ -n "${HEADER_COUNT:-}" ] && [ "$HEADER_COUNT" != "0" ]; then
    echo "WARNING: header Finding count=$HEADER_COUNT but no '### Fn —' headings matched — treating as format failure (no advisory)."
    out "advisory_url="
    out "finding_count=0"
    out "max_severity=format_mismatch"
    out "format_mismatch=true"
    exit 0
  fi
  echo "No Medium+ findings — skipping advisory."
  out "advisory_url="
  out "finding_count=0"
  out "max_severity=none"
  out "format_mismatch=false"
  exit 0
fi

MAX="medium"
if grep -qiE '\*\*Severity:\*\*[[:space:]]*Critical' "$REPORT"; then
  MAX="critical"
elif grep -qiE '\*\*Severity:\*\*[[:space:]]*High' "$REPORT"; then
  MAX="high"
fi

SUMMARY="[Security audit] ${DATE} — ${COUNT} finding(s), max=${MAX}"
SUMMARY="$(printf '%s' "$SUMMARY" | head -c 1024)"

DESCRIPTION="$(cat "$REPORT")"
DESCRIPTION="$(printf '%s' "$DESCRIPTION" | head -c 65000)"

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
echo "Created draft advisory ${GHSA}: ${URL}"
out "advisory_url=$URL"
out "ghsa_id=$GHSA"
out "finding_count=$COUNT"
out "max_severity=$MAX"
out "format_mismatch=false"
