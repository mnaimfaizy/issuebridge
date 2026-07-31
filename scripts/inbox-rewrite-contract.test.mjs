/**
 * Inbox Rewrite modal contracts for #67 — Variant B stubbed inference.
 * Asserts observable adapter contracts in source (not Fluent internals).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (...parts) => join(root, "src", ...parts);
const tauri = (...parts) => join(root, "src-tauri", "src", ...parts);

function readSrc(...parts) {
  const path = src(...parts);
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

function readTauri(...parts) {
  const path = tauri(...parts);
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

describe("Inbox Rewrite modal (#67)", () => {
  it("Rewrite… is an Inbox Draft action only (not Capture)", () => {
    const inspector = readSrc("inbox", "DraftInspector.tsx");
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(inspector, /Rewrite…/);
    assert.match(workbench, /RewriteDialog/);
    assert.match(workbench, /onRewrite/);
    assert.ok(existsSync(src("inbox", "RewriteDialog.tsx")));

    const captureDir = src("capture");
    assert.ok(existsSync(captureDir), "expected capture UI");
    for (const name of ["CapturePopup.tsx", "CaptureApp.tsx", "capture.css"]) {
      const path = join(captureDir, name);
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      assert.doesNotMatch(text, /Rewrite/);
    }
  });

  it("disables Rewrite when Draft is too thin and shows a short hint", () => {
    const eligibility = readSrc("inbox", "rewriteEligibility.ts");
    assert.match(eligibility, /trim\(\)\.length < 8/);
    assert.match(eligibility, /trim\(\)\.length < 40/);
    assert.match(eligibility, /REWRITE_TOO_THIN_HINT/);
    const inspector = readSrc("inbox", "DraftInspector.tsx");
    assert.match(inspector, /rewriteDisabled/);
    assert.match(inspector, /rewriteHint/);
    assert.match(inspector, /title=\{rewriteHint/);
    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /isTooThinForRewrite/);
    assert.match(workbench, /REWRITE_TOO_THIN_HINT/);
  });

  it("modal flow: style chips → Generate → editable proposal → Accept / Discard", () => {
    const dialog = readSrc("inbox", "RewriteDialog.tsx");
    assert.match(dialog, /Rewrite Draft/);
    assert.match(dialog, /Generate/);
    assert.match(dialog, /Accept/);
    assert.match(dialog, /Discard/);
    assert.match(dialog, /Rewriting with/);
    assert.match(dialog, /Proposed title/);
    assert.match(dialog, /Proposed body/);
    assert.match(dialog, /generate_rewrite/);
    assert.match(dialog, /remember_last_rewrite_style/);
    assert.match(dialog, /list_rewrite_styles/);
    assert.match(dialog, /Add Rewrite style/);
    assert.match(dialog, /Remove style/);
    assert.match(dialog, /Clear|styleId/);
  });

  it("never silent-overwrites; closing mid-generate cancels; Accept writes working fields only", () => {
    const dialog = readSrc("inbox", "RewriteDialog.tsx");
    assert.match(dialog, /generateTokenRef/);
    assert.match(dialog, /requestClose/);
    assert.match(dialog, /cancelGenerate/);
    assert.match(dialog, /onAccept/);
    assert.doesNotMatch(dialog, /edit_draft/);
    assert.doesNotMatch(dialog, /publish_draft/);

    const workbench = readSrc("inbox", "InboxWorkbench.tsx");
    assert.match(workbench, /RewriteDialog/);
    assert.match(workbench, /onAccept=\{/);
    assert.match(workbench, /setTitle\(nextTitle\)/);
    assert.match(workbench, /setBody\(nextBody\)/);
    const rewriteSlice = workbench.slice(workbench.indexOf("<RewriteDialog"));
    assert.doesNotMatch(rewriteSlice, /edit_draft/);
    assert.doesNotMatch(rewriteSlice, /publish_draft/);
  });

  it("core Rewrite engine port and stub exist; styles + last-used live in settings", () => {
    const ports = readTauri("core", "ports", "mod.rs");
    assert.match(ports, /trait RewriteEngine/);
    assert.match(ports, /struct StubRewriteEngine/);
    assert.match(ports, /custom_rewrite_styles/);
    assert.match(ports, /last_used_rewrite_style_id/);

    const core = readTauri("core", "mod.rs");
    assert.match(core, /fn generate_rewrite/);
    assert.match(core, /fn remember_last_rewrite_style/);
    assert.match(core, /fn list_rewrite_styles/);
    assert.match(core, /fn add_custom_rewrite_style/);
    assert.match(core, /fn remove_custom_rewrite_style/);
    assert.match(core, /Box<dyn RewriteEngine>/);

    const commands = readTauri("adapters", "commands.rs");
    assert.match(commands, /generate_rewrite/);
    assert.match(commands, /list_rewrite_styles/);
    assert.match(commands, /add_custom_rewrite_style/);
    assert.match(commands, /remove_custom_rewrite_style/);

    const lib = readTauri("lib.rs");
    assert.match(lib, /generate_rewrite/);
    assert.match(lib, /list_rewrite_styles/);
  });

  it("CONTEXT.md defines Rewrite and Rewrite style", () => {
    const context = readFileSync(join(root, "CONTEXT.md"), "utf8");
    assert.match(context, /\*\*Rewrite\*\*:/);
    assert.match(context, /\*\*Rewrite style\*\*:/);
  });
});
