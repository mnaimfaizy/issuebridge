/**
 * Feedback loop for silent PAT sign-in failures.
 * Models main.ts: catch { showStatus(err); await refreshAppState(); }
 * where refreshAppState always clearStatus().
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
const mainTs = readFileSync(join(root, "src", "main.ts"), "utf8");

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
    // Production catch order in main.ts today: showStatus then refreshAppState.
    // That must not wipe the message.
    const usesBuggyOrder =
      /showStatus\(String\(error\)\);\s*await refreshAppState\(\);/.test(
        mainTs,
      );
    const mode = usesBuggyOrder ? "buggy" : "fixed";
    const visible = visibleStatusAfterFailedPat(mode);
    assert.equal(
      visible,
      "GitHub rejected those credentials.",
      usesBuggyOrder
        ? "RED: main.ts showStatus-then-refreshAppState clears the error (silent failure)"
        : "status should remain visible",
    );
  });
});
