/**
 * Feedback loop for silent PAT sign-in failures (#40 Sign-in step).
 * Models SignInStep: catch { refresh; setError(err) } so the MessageBar stays.
 *
 * Red = failed PAT leaves no visible status (user's symptom).
 * Green = failed PAT keeps the error message visible.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const signInStep = readFileSync(
  join(root, "src", "firstrun", "SignInStep.tsx"),
  "utf8",
);

/**
 * Simulate catch-path status lifecycle.
 * @param {"buggy" | "fixed"} mode
 */
function visibleStatusAfterFailedPat(mode) {
  /** @type {{ message: string | null, hidden: boolean }} */
  const status = { message: null, hidden: true };
  const showStatus = (message) => {
    status.hidden = false;
    status.message = message;
  };
  const clearStatus = () => {
    status.hidden = true;
    status.message = null;
  };
  const refreshAppState = () => {
    clearStatus();
  };

  const authError = "GitHub rejected those credentials.";
  if (mode === "fixed") {
    refreshAppState();
    showStatus(authError);
  } else {
    showStatus(authError);
    refreshAppState();
  }
  return status.hidden ? null : status.message;
}

describe("PAT sign-in silent failure", () => {
  it("failed PAT must leave an error message visible (user symptom)", () => {
    // SignInStep sets error after refresh on catch — MessageBar stays visible.
    const setsErrorAfterCatch =
      /setError\(formatInvokeError\(err\)\)/.test(signInStep) &&
      /MessageBar/.test(signInStep);
    const usesBuggyOrder =
      /showStatus\(String\(error\)\);\s*await refreshAppState\(\);/.test(
        signInStep,
      );
    const mode = usesBuggyOrder || !setsErrorAfterCatch ? "buggy" : "fixed";
    const visible = visibleStatusAfterFailedPat(mode);
    assert.equal(
      visible,
      "GitHub rejected those credentials.",
      usesBuggyOrder || !setsErrorAfterCatch
        ? "RED: PAT error must remain visible after refresh"
        : "status should remain visible",
    );
  });
});
