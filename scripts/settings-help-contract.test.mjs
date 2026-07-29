/**
 * Settings + Help destination contracts for #38.
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

describe("Settings + Help destinations (#38)", () => {
  it("Settings and Help are full-page destinations that replace workspace panes", () => {
    const shell = readSrc("shell", "ShellLayout.tsx");
    assert.match(shell, /SettingsPage/);
    assert.match(shell, /HelpPage/);
    assert.match(
      shell,
      /destination\s*===\s*["']settings["']/,
    );
    assert.match(shell, /destination\s*===\s*["']help["']/);
    assert.ok(
      existsSync(src("settings", "SettingsPage.tsx")),
      "expected SettingsPage",
    );
    assert.ok(existsSync(src("help", "HelpPage.tsx")), "expected HelpPage");
  });

  it("Appearance theme System/Light/Dark applies immediately and persists", () => {
    const settings = readSrc("settings", "SettingsPage.tsx");
    const appearance =
      existsSync(src("settings", "AppearanceSection.tsx"))
        ? readSrc("settings", "AppearanceSection.tsx")
        : settings;
    assert.match(appearance, /System/);
    assert.match(appearance, /Light/);
    assert.match(appearance, /Dark/);
    assert.match(appearance, /RadioGroup|onThemePreferenceChange/);
    const theme = readSrc("theme", "preference.ts");
    assert.match(theme, /writeThemePreference|issuebridge\.themePreference/);
  });

  it("Account shows status, Sign out, Manage on GitHub, and Sign-in when signed out", () => {
    const account = readSrc("settings", "AccountSection.tsx");
    assert.match(account, /Sign out/);
    assert.match(account, /Sign in/);
    assert.match(account, /Manage on GitHub/);
    assert.match(account, /Signed in|signed_in|auth/);
    assert.match(account, /open_app_install/);
    assert.match(account, /firstRunComplete|isAccountSettingsEnabled/);
  });

  it("Testing set edits ≤3 App-visible repos with search/chips; gated with helper", () => {
    const testing = readSrc("settings", "TestingSetSection.tsx");
    assert.match(testing, /app_visible_repos/);
    assert.match(testing, /testing_set/);
    assert.match(testing, /add_testing_set_repo/);
    assert.match(testing, /remove_testing_set_repo/);
    assert.match(testing, /Search|filter|owner\/name/i);
    assert.match(testing, /chip|Testing set/i);
    assert.match(testing, /disabled|helper|gated/i);
    assert.match(testing, /up to 3|length >= 3/);
    assert.match(testing, /settings-repo-filter|Search repositories/);
    const gating = readSrc("settings", "gating.ts");
    assert.match(gating, /isTestingSetEditable|testingSet/);
    assert.match(gating, /firstRunComplete/);
  });

  it("Capture settings show read-only PTT hotkey and Coming soon rebind", () => {
    const capture = readSrc("settings", "CaptureSection.tsx");
    assert.match(capture, /ptt_hotkey/);
    assert.match(capture, /Coming soon/);
    assert.match(capture, /disabled|read-?only|readOnly/i);
    assert.doesNotMatch(
      capture,
      /rebind_hotkey|register_hotkey|set_ptt/,
      "no hotkey rebinding implementation",
    );
  });

  it("Help includes Shortcuts, How it works, and About with domain language", () => {
    const help = readSrc("help", "HelpPage.tsx");
    assert.match(help, /Shortcuts/);
    assert.match(help, /How it works/);
    assert.match(help, /About/);
    assert.match(help, /Ctrl\+Alt\+Shift\+I/);
    assert.match(help, /PTT|ptt|hold/i);
    assert.match(help, /Settings.*Capture|Capture settings/i);
    assert.match(help, /Capture/);
    assert.match(help, /Draft/);
    assert.match(help, /Inbox/);
    assert.match(help, /Publish/);
    assert.match(help, /Issuebridge/);
    assert.match(help, /package\.json/);
    assert.match(help, /version/i);
    const pkg = JSON.parse(readRoot("package.json"));
    assert.ok(typeof pkg.version === "string" && pkg.version.length > 0);
    assert.match(help, /github\.com\/mnaimfaizy\/issuebridge/);
    assert.doesNotMatch(help, /Replay onboarding|chatbot|docs site/i);
  });

  it("progressive gating keeps unavailable entries visible with helpers", () => {
    const gating = readSrc("settings", "gating.ts");
    assert.match(gating, /signed_out|signed_in/);
    assert.match(gating, /firstRun|first_run|ready|install/i);
    assert.match(gating, /testingSetHelper|captureSettingsHelper/);
    const settings = readSrc("settings", "SettingsPage.tsx");
    assert.match(settings, /AppearanceSection/);
    assert.match(settings, /AccountSection/);
    assert.match(settings, /TestingSetSection/);
    assert.match(settings, /CaptureSection/);
    const testing = readSrc("settings", "TestingSetSection.tsx");
    const capture = readSrc("settings", "CaptureSection.tsx");
    assert.match(testing, /ib-settings-helper|helper/);
    assert.match(capture, /ib-settings-helper|Coming soon/);
  });

  it("Capture popup stays chrome-free of Settings/Help/account", () => {
    const captureHtml = readRoot("capture.html");
    assert.doesNotMatch(captureHtml, /id=["']root["']/);
    assert.doesNotMatch(captureHtml, /ShellLayout|SettingsPage|HelpPage/);
    const captureTs = readSrc("capture.ts");
    assert.doesNotMatch(captureTs, /SettingsPage|HelpPage|ShellLayout/);
  });
});
