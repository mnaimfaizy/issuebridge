/** Eligibility for Inbox Rewrite — mirrors core `is_too_thin_for_rewrite` for sync button disable. */
export function isTooThinForRewrite(title: string, body: string): boolean {
  return title.trim().length < 8 && body.trim().length < 40;
}

export const REWRITE_TOO_THIN_HINT =
  "Rewrite disabled — add a longer title or body.";
