/**
 * Inbox + Draft editor contracts for #37 — Fluent command workbench.
 * Asserts observable adapter contracts in source (not Fluent internals).
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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

/**
 * Soft-clear success MessageBar: clear after ~3s or on next edit.
 * @param {"timeout" | "edit"} trigger
 */
function successClears(trigger) {
  /** @type {{ kind: string | null }} */
  const bar = { kind: "success" };
  const onTimeout = () => {
    if (bar.kind === "success") bar.kind = null;
  };
  const onEdit = () => {
    if (bar.kind === "success") bar.kind = null;
  };
  if (trigger === "timeout") onTimeout();
  else onEdit();
  return bar.kind;
}

describe("Inbox workbench (#37)", () => {
  it("vanilla Inbox/editor DOM is removed; workbench lives in React", () => {
    const index = readRoot("index.html");
    assert.doesNotMatch(index, /id=["']inbox-list["']/);
    assert.doesNotMatch(index, /id=["']draft-editor["']/);
    assert.doesNotMatch(index, /id=["']save-draft["']/);
    assert.doesNotMatch(index, /id=["']publish-draft["']/);
    assert.doesNotMatch(index, /id=["']empty-capture["']/);
    assert.ok(
      existsSync(src("inbox", "InboxWorkbench.tsx")),
      "expected React InboxWorkbench",
    );
  });

  it("flat Inbox lists Drafts with title/Untitled, owner/name, Linked/Unlinked + Dirty badges only", () => {
    const list = readSrc("inbox", "InboxList.tsx");
    assert.match(list, /display_title|displayTitle/);
    assert.match(list, /owner/);
    assert.match(list, /Linked|Unlinked/);
    assert.match(list, /[Dd]irty/);
    assert.doesNotMatch(
      list,
      /filter|segment|density|sortBy|tabs/i,
      "no filters, tabs, segments, sorts, or density toggle",
    );
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /list_inbox/);
  });

  it("empty signed-in Inbox shows Capture action and hotkey cue; editor blank until selection", () => {
    const list = readSrc("inbox", "InboxList.tsx");
    assert.match(list, /Capture/);
    assert.match(list, /Ctrl\+Alt\+Shift\+I|hotkey/i);
    const inspector = readSrc("inbox", "DraftInspector.tsx");
    assert.match(inspector, /selected|draft/i);
  });

  it("Draft inspector supports Save, Publish/Update, and View on GitHub when linked", () => {
    const inspector = readSrc("inbox", "DraftInspector.tsx");
    assert.match(inspector, /Save/);
    assert.match(inspector, /Publish/);
    assert.match(inspector, /Update/);
    assert.match(inspector, /View on GitHub/);
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /edit_draft/);
    assert.match(workbench, /publish_draft/);
    assert.match(workbench, /update_linked_draft/);
  });

  it("MessageBar handles busy, error, and success soft-clear (~3s or next edit); no toasts", () => {
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /MessageBar/);
    assert.doesNotMatch(workbench, /toast|snackbar/i);
    const css = readSrc("inbox", "inbox.css");
    assert.match(
      css,
      /\.ib-workbench-command\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
      "status bars must wrap rather than widen the command area",
    );
    assert.match(workbench, /<MessageBarBody className="ib-message-copy"/);
    const status = readSrc("inbox", "statusModel.ts");
    assert.match(status, /3000|SUCCESS_CLEAR/);
    assert.equal(successClears("timeout"), null);
    assert.equal(successClears("edit"), null);
  });

  it("keyboard: F6 pane cycle, Ctrl+S Save, Ctrl+Enter Publish/Update; selected row brand inset", () => {
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /["']F6["']/);
    assert.match(workbench, /ctrlKey/);
    assert.match(workbench, /toLowerCase\(\)\s*===\s*["']s["']/);
    assert.match(workbench, /key\s*===\s*["']Enter["']/);
    const css = readSrc("inbox", "inbox.css");
    assert.match(css, /3px/);
    assert.match(css, /Brand|brand/);
  });

  it("stacks list|editor below ~720px with back affordance; min ~720×480; last Draft id persisted", () => {
    const css = readSrc("inbox", "inbox.css");
    assert.match(css, /720px/);
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /[Bb]ack/);
    const shell = readSrc("shell", "shell.css");
    assert.match(shell, /min-width:\s*720px/);
    assert.match(shell, /min-height:\s*480px/);
    const persist = readSrc("inbox", "lastDraftId.ts");
    assert.match(persist, /localStorage|LAST_DRAFT/);
    assert.doesNotMatch(
      persist,
      /MessageBar|status/,
      "MessageBars must not be persisted",
    );
  });

  it("Tauri Inbox commands remain wired; first-run and conflict are React", () => {
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /list_inbox/);
    assert.match(workbench, /get_draft/);
    assert.match(workbench, /show_capture/);
    assert.match(workbench, /ConflictDialog/);
    assert.ok(
      existsSync(src("firstrun", "FirstRunWorkbench.tsx")),
      "first-run lives in React (#40)",
    );
    const mainUi = readSrc("main.ts");
    assert.doesNotMatch(mainUi, /conflict-modal/);
    assert.doesNotMatch(
      mainUi,
      /function renderInbox|id=["']inbox-list["']|#inbox-list/,
      "vanilla Inbox render path must be gone from main.ts",
    );
  });
});
