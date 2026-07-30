/**
 * Conflict dialog contracts for #41 — must-choose Fluent alert surface.
 * Asserts observable adapter contracts in source (not Fluent internals).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (...parts) => join(root, "src", ...parts);

function readSrc(...parts) {
  const path = src(...parts);
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

function readRoot(...parts) {
  const path = join(root, ...parts);
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

describe("Conflict dialog (#41)", () => {
  it("vanilla conflict DOM is removed; Fluent ConflictDialog owns the surface", () => {
    const index = readRoot("index.html");
    assert.doesNotMatch(index, /id=["']conflict-modal["']/);
    assert.doesNotMatch(index, /id=["']conflict-keep-mine["']/);
    assert.doesNotMatch(index, /id=["']conflict-use-theirs["']/);
    assert.doesNotMatch(index, /id=["']legacy-workspace-template["']/);
    assert.ok(!existsSync(src("shell", "LegacyWorkspaceHost.tsx")));
    assert.ok(
      existsSync(src("inbox", "ConflictDialog.tsx")),
      "expected Fluent ConflictDialog",
    );
    const styles = readSrc("styles.css");
    assert.doesNotMatch(styles, /\.conflict-modal\b/);
  });

  it("alert dialog: Keep mine and Use theirs only; View on GitHub secondary; locked copy; no Cancel/diff", () => {
    const dialog = readSrc("inbox", "ConflictDialog.tsx");
    assert.match(dialog, /modalType=["']alert["']/);
    assert.match(dialog, /Keep mine/);
    assert.match(dialog, /Use theirs/);
    assert.match(dialog, /View on GitHub/);
    assert.match(
      dialog,
      /This issue changed on GitHub since you last updated it\. Keep your\s+local edits, or use the GitHub version\./,
    );
    assert.doesNotMatch(dialog, />\s*Cancel\s*</);
    assert.doesNotMatch(dialog, /diff|Diff/);
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /ConflictDialog/);
    assert.match(workbench, /keep_mine/);
    assert.match(workbench, /use_theirs/);
    assert.match(workbench, /update_linked_draft/);
  });

  it("Escape and outside-click do not dismiss; Esc blocking lives with the dialog", () => {
    const dialog = readSrc("inbox", "ConflictDialog.tsx");
    assert.match(dialog, /Escape/);
    assert.match(dialog, /onOpenChange/);
    assert.match(dialog, /preventDefault|stopPropagation|!data\.open/);
    const mainUi = readSrc("main.ts");
    assert.doesNotMatch(mainUi, /conflict-modal/);
    assert.doesNotMatch(
      mainUi,
      /bootMainUi/,
      "legacy bootMainUi conflict Esc path must be gone",
    );
  });

  it("focus Keep mine on open; restore focus to Update after resolve", () => {
    const dialog = readSrc("inbox", "ConflictDialog.tsx");
    assert.match(dialog, /autoFocus/);
    assert.match(dialog, /Keep mine/);
    const inspector = readSrc("inbox", "DraftInspector.tsx");
    assert.match(
      inspector,
      /updateButtonRef|publishOrUpdateRef/,
      "Update button must expose a ref for focus restore",
    );
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /updateButtonRef|publishOrUpdateRef/);
    assert.match(
      workbench,
      /runKeepMine[\s\S]*updateButtonRef|runKeepMine[\s\S]*publishOrUpdateRef/,
      "Keep mine must restore focus to Update",
    );
    assert.match(
      workbench,
      /runUseTheirs[\s\S]*updateButtonRef|runUseTheirs[\s\S]*publishOrUpdateRef/,
      "Use theirs must restore focus to Update",
    );
  });
});
