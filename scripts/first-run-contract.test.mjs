/**
 * First-run progress strip contracts for #40.
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

describe("First-run progress strip (#40)", () => {
  it("horizontal progress strip lists Sign in → Install App → Testing set → Try capture in the shell", () => {
    assert.ok(
      existsSync(src("firstrun", "FirstRunWorkbench.tsx")),
      "expected React FirstRunWorkbench",
    );
    assert.ok(
      existsSync(src("firstrun", "ProgressStrip.tsx")),
      "expected ProgressStrip",
    );
    const strip = readSrc("firstrun", "ProgressStrip.tsx");
    const steps = readSrc("firstrun", "types.ts");
    assert.match(steps, /Sign in/);
    assert.match(steps, /Install App/);
    assert.match(steps, /Testing set/);
    assert.match(steps, /Try capture/);
    assert.match(strip, /First-run progress|aria-label/);
    const shell = readSrc("shell", "ShellLayout.tsx");
    assert.match(shell, /FirstRunWorkbench/);
    assert.match(shell, /firstRunComplete/);
  });

  it("Sign in offers GitHub OAuth primary and PAT secondary via existing commands", () => {
    const signIn = readSrc("firstrun", "SignInStep.tsx");
    assert.match(signIn, /Sign in with GitHub/);
    assert.match(signIn, /personal access token|PAT/i);
    assert.match(signIn, /sign_in_with_github/);
    assert.match(signIn, /sign_in_with_pat/);
  });

  it("Install App urges selected repos, Continue refreshes, MessageBar for install hints", () => {
    const install = readSrc("firstrun", "InstallAppStep.tsx");
    assert.match(install, /selected repositories/i);
    assert.match(install, /open_app_install/);
    assert.match(install, /continue_install/);
    assert.match(install, /MessageBar/);
    assert.match(install, /Don.?t see an install yet|Add selected repositories/i);
  });

  it("Testing set picks 1–3 App-visible repos with search/chips; MessageBar for All-repositories warning", () => {
    const testing = readSrc("firstrun", "TestingSetStep.tsx");
    assert.match(testing, /app_visible_repos/);
    assert.match(testing, /testing_set/);
    assert.match(testing, /add_testing_set_repo/);
    assert.match(testing, /remove_testing_set_repo/);
    assert.match(testing, /complete_testing_set/);
    assert.match(testing, /up to 3|length >= 3/);
    assert.match(testing, /MessageBar/);
    assert.match(testing, /All repositories/i);
    assert.match(testing, /Search|filter|owner\/name/i);
  });

  it("Try capture opens real Capture popup or Skip; dismiss-without-Save stays on step", () => {
    const tryCapture = readSrc("firstrun", "TryCaptureStep.tsx");
    assert.match(tryCapture, /show_capture/);
    assert.match(tryCapture, /skip_try_capture/);
    assert.match(tryCapture, /Try capture|Skip/);
    assert.match(tryCapture, /Ctrl\+Alt\+Shift\+I/);
  });

  it("status MessageBars wrap instead of widening the step into horizontal scroll", () => {
    // Fluent MessageBars are nowrap until they reflow, and only reflow when the
    // box is narrower than the text — so the grid track must be shrinkable.
    const css = readSrc("firstrun", "firstrun.css");
    assert.match(
      css,
      /\.ib-firstrun-step\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    const shell = readSrc("shell", "shell.css");
    assert.match(shell, /\.ib-message-copy\s*\{[^}]*overflow-wrap:\s*anywhere/);
    for (const step of [
      "SignInStep",
      "InstallAppStep",
      "TestingSetStep",
      "TryCaptureStep",
    ]) {
      const source = readSrc("firstrun", `${step}.tsx`);
      assert.match(
        source,
        /<MessageBarBody className="ib-message-copy"/,
        `${step} must let long status copy wrap`,
      );
    }
  });

  it("progressive chrome: Inbox gated during first-run; Help available; Settings progressive", () => {
    const sidebar = readSrc("shell", "Sidebar.tsx");
    assert.match(sidebar, /firstRunComplete/);
    assert.match(
      sidebar,
      /Available after setup|Setup in progress|Finish setup|gated|disabled/i,
    );
    assert.match(sidebar, /label=["']Help["']/);
    assert.match(sidebar, /label=["']Settings["']/);
    const gating = readSrc("settings", "gating.ts");
    assert.match(gating, /isAccountSettingsEnabled|isTestingSetEditable/);
    assert.match(gating, /firstRunComplete/);
  });

  it("vanilla first-run DOM removed; conflict modal kept for later slice; Tauri command names unchanged", () => {
    const index = readRoot("index.html");
    assert.doesNotMatch(index, /id=["']sign-in-step["']/);
    assert.doesNotMatch(index, /id=["']install-step["']/);
    assert.doesNotMatch(index, /id=["']testing-set-step["']/);
    assert.doesNotMatch(index, /id=["']try-capture-step["']/);
    assert.doesNotMatch(index, /id=["']sign-in-github["']/);
    assert.match(index, /id=["']conflict-modal["']/);
    assert.match(index, /id=["']conflict-keep-mine["']/);
    const mainUi = readSrc("main.ts");
    assert.doesNotMatch(
      mainUi,
      /sign-in-github|complete-testing-set|skip-try-capture/,
      "vanilla first-run handlers removed from main.ts",
    );
    assert.match(mainUi, /conflict-modal/);
  });
});
