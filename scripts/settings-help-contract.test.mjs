/**
 * Settings + Help destination contracts for #38.
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

/** Help ships as page + content data + section renderer; assert on all three. */
function readHelp() {
  return [
    readSrc("help", "HelpPage.tsx"),
    readSrc("help", "helpContent.ts"),
    readSrc("help", "HelpSection.tsx"),
  ].join("\n");
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
    assert.match(shell, /destination\s*===\s*["']settings["']/);
    assert.match(shell, /destination\s*===\s*["']help["']/);
    assert.ok(
      existsSync(src("settings", "SettingsPage.tsx")),
      "expected SettingsPage",
    );
    assert.ok(existsSync(src("help", "HelpPage.tsx")), "expected HelpPage");
  });

  it("Appearance theme System/Light/Dark applies immediately and persists", () => {
    const settings = readSrc("settings", "SettingsPage.tsx");
    const appearance = existsSync(src("settings", "AppearanceSection.tsx"))
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

  it("Testing set edits App-visible repos with max control, Add all, search/chips; gated with helper", () => {
    const testing = readSrc("settings", "TestingSetSection.tsx");
    assert.match(testing, /app_visible_repos/);
    assert.match(testing, /testing_set/);
    assert.match(testing, /testing_set_max|set_testing_set_max/);
    assert.match(testing, /add_all_app_visible_to_testing_set/);
    assert.match(testing, /reconcile_testing_set_with_app_visible/);
    assert.match(testing, /add_testing_set_repo/);
    assert.match(testing, /remove_testing_set_repo/);
    assert.match(testing, /Search|filter|owner\/name/i);
    assert.match(testing, /chip|Testing set/i);
    assert.match(testing, /disabled|helper|gated/i);
    assert.match(testing, /Apply max|Add all App-visible|recommended/i);
    assert.match(testing, /Dialog|Continue/);
    assert.match(testing, /settings-repo-filter|Search repositories/);
    assert.match(testing, /settings-testing-set-max/);
    assert.match(testing, /<MessageBarBody className="ib-message-copy"/);
    const shellCss = readSrc("shell", "shell.css");
    for (const block of ["ib-destination", "ib-settings-block"]) {
      assert.match(
        shellCss,
        new RegExp(
          `\\.${block}\\s*\\{[^}]*grid-template-columns:\\s*minmax\\(0,\\s*1fr\\)`,
        ),
        `${block} must let status bars wrap instead of widening the page`,
      );
    }
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

  it("Rewrite models settings expose catalog, disk use, active, download/switch/Remove, Update available, Keep/Switch (#71)", () => {
    const settings = readSrc("settings", "SettingsPage.tsx");
    assert.match(settings, /RewriteModelsSection/);
    assert.ok(
      existsSync(src("settings", "RewriteModelsSection.tsx")),
      "expected RewriteModelsSection",
    );
    const section = readSrc("settings", "RewriteModelsSection.tsx");
    assert.match(section, /Rewrite models/);
    assert.match(section, /get_rewrite_model_status/);
    assert.match(section, /start_rewrite_model_download/);
    assert.match(section, /cancel_rewrite_model_download/);
    assert.match(section, /set_active_rewrite_model/);
    assert.match(section, /remove_rewrite_model/);
    assert.match(section, /respond_rewrite_hardware_prompt/);
    assert.match(section, /rewrite-model-download-progress/);
    assert.match(section, /Download/);
    assert.match(section, /Switch|Use/);
    assert.match(section, /Remove/);
    assert.match(section, /window\.confirm/);
    assert.match(section, /active|Active/);
    assert.match(section, /recommended|Recommended/);
    assert.match(section, /size_bytes|formatBytes|GB|MB/);
    assert.match(section, /Update available/);
    assert.match(section, /update_available/);
    assert.match(section, /Download .*set it as the active|window\.confirm/);
    assert.match(section, /Keep/);
    assert.match(section, /Switch/);
    assert.match(section, /Hardware changed|hardware_switch_prompt/);
    assert.doesNotMatch(
      section,
      /auto.?update|silent.?overwrite/i,
      "no auto-update or silent overwrite of Rewrite models",
    );
    const ports = readFileSync(
      join(root, "src-tauri", "src", "core", "ports", "mod.rs"),
      "utf8",
    );
    assert.match(ports, /update_available/);
    const gating = readSrc("settings", "gating.ts");
    assert.match(
      gating,
      /isRewriteModelsSettingsEnabled|rewriteModelsSettingsHelper/,
    );
    assert.match(
      section,
      /isRewriteModelsSettingsEnabled|rewriteModelsSettingsHelper/,
    );
    assert.match(section, /ib-settings-helper|helper/);
  });

  it("Help includes Shortcuts, How it works, and About with domain language", () => {
    const help = readHelp();
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
    assert.match(help, /assets\/brand\/mark\.png|ib-about-mark/);
    assert.match(help, /package\.json/);
    assert.match(help, /version/i);
    const pkg = JSON.parse(readRoot("package.json"));
    assert.ok(typeof pkg.version === "string" && pkg.version.length > 0);
    assert.match(help, /github\.com\/mnaimfaizy\/issuebridge/);
    assert.doesNotMatch(help, /Replay onboarding|chatbot|docs site/i);
  });

  it("Help covers the shipped surface area, not just shortcuts (#146)", () => {
    const help = readHelp();
    // Rewrite and the local model story.
    assert.match(help, /Rewrite/);
    assert.match(help, /Rewrite style/);
    assert.match(help, /Accept or Discard|Accept\/Discard/i);
    assert.match(help, /too thin/i);
    assert.match(help, /Local Rewrite models|catalog/i);
    assert.match(help, /Update available/);
    assert.match(help, /Keep .*Switch|Hardware changed/);
    assert.match(help, /Remove/);
    assert.match(help, /on this device|stay local|local model/i);
    assert.doesNotMatch(
      help,
      /start_rewrite_model_download|set_active_rewrite_model|remove_rewrite_model/,
      "Help is read-only — model actions stay in Settings",
    );
    // Live "Your machine" block from the existing status command.
    assert.match(help, /Your machine/);
    assert.match(help, /get_rewrite_model_status/);
    assert.match(help, /hardware_tier/);
    assert.match(help, /recommended_reason|recommended_model_id/);
    assert.match(help, /active_model_id/);
    // The rest of the shipped surface.
    assert.match(help, /Voice capture|dictat/i);
    assert.match(help, /Testing set/);
    assert.match(help, /Label catalog/);
    assert.match(help, /Keep mine/);
    assert.match(help, /Use theirs/);
    assert.match(help, /Local link/);
    assert.match(help, /Remote snapshot/);
    assert.match(help, /Dirty/);
    assert.match(help, /Timestamps/);
    assert.match(help, /UTC/);
    assert.match(help, /Appearance/);
    // Troubleshooting mirrors the gating helper reasons.
    assert.match(help, /greyed out|Finish first-run setup/i);
    assert.match(help, /Sign in/);
  });

  it("Help deep-links into Settings instead of duplicating controls (#146)", () => {
    const help = readSrc("help", "helpContent.ts");
    assert.match(help, /rewrite-models-settings-heading/);
    assert.match(help, /capture-settings-heading/);
    assert.match(help, /testing-set-settings-heading/);
    assert.match(help, /timestamp-settings-heading/);
    assert.match(help, /appearance-heading/);
    assert.match(help, /account-heading/);
    const page = readSrc("help", "HelpPage.tsx");
    assert.match(page, /onNavigate/);
    assert.match(page, /scrollIntoView/);
    const shell = readSrc("shell", "ShellLayout.tsx");
    assert.match(shell, /<HelpPage onNavigate=\{onNavigate\}/);
  });

  it("Help and Settings share one Rewrite model status definition (#146)", () => {
    assert.ok(
      existsSync(src("settings", "rewriteModelStatus.ts")),
      "expected shared rewriteModelStatus module",
    );
    const shared = readSrc("settings", "rewriteModelStatus.ts");
    assert.match(shared, /RewriteModelStatusDto/);
    assert.match(shared, /RewriteModelEntryDto/);
    assert.match(shared, /formatBytes/);
    const section = readSrc("settings", "RewriteModelsSection.tsx");
    assert.match(section, /from "\.\/rewriteModelStatus"/);
    assert.doesNotMatch(
      section,
      /type RewriteModelStatusDto = \{/,
      "DTOs live in the shared module, not duplicated per surface",
    );
    const page = readSrc("help", "HelpPage.tsx");
    assert.match(page, /settings\/rewriteModelStatus/);
  });

  it("Timestamp settings expose local/UTC toggle wired to get/save commands (#93)", () => {
    const settings = readSrc("settings", "SettingsPage.tsx");
    assert.match(settings, /TimestampSection/);
    assert.ok(
      existsSync(src("settings", "TimestampSection.tsx")),
      "expected TimestampSection",
    );
    const section = readSrc("settings", "TimestampSection.tsx");
    assert.match(section, /Timestamps|timestamp/i);
    assert.match(section, /get_timestamp_display/);
    assert.match(section, /save_timestamp_display/);
    assert.match(section, /local|Local/);
    assert.match(section, /utc|UTC/);
    assert.match(section, /Radio|radio/i);
    const types = readSrc("inbox", "types.ts");
    assert.match(types, /created_at_millis/);
    const inboxList = readSrc("inbox", "InboxList.tsx");
    assert.match(inboxList, /created_at_millis/);
    assert.match(inboxList, /formatTimestamp/);
    const draftInspector = readSrc("inbox", "DraftInspector.tsx");
    assert.match(draftInspector, /created_at_millis/);
    assert.match(draftInspector, /formatTimestamp/);
    const formatUtil = readSrc("shared", "formatTimestamp.ts");
    assert.match(formatUtil, /TimestampDisplay/);
    assert.match(formatUtil, /local/);
    assert.match(formatUtil, /utc/);
    assert.match(formatUtil, /Intl\.DateTimeFormat/);
  });

  it("progressive gating keeps unavailable entries visible with helpers", () => {
    const gating = readSrc("settings", "gating.ts");
    assert.match(gating, /signed_out|signed_in/);
    assert.match(gating, /firstRun|first_run|ready|install/i);
    assert.match(gating, /testingSetHelper|captureSettingsHelper/);
    assert.match(gating, /rewriteModelsSettingsHelper/);
    const settings = readSrc("settings", "SettingsPage.tsx");
    assert.match(settings, /AppearanceSection/);
    assert.match(settings, /AccountSection/);
    assert.match(settings, /TestingSetSection/);
    assert.match(settings, /CaptureSection/);
    assert.match(settings, /TimestampSection/);
    assert.match(settings, /RewriteModelsSection/);
    const testing = readSrc("settings", "TestingSetSection.tsx");
    const capture = readSrc("settings", "CaptureSection.tsx");
    const rewriteModels = readSrc("settings", "RewriteModelsSection.tsx");
    assert.match(testing, /ib-settings-helper|helper/);
    assert.match(capture, /ib-settings-helper|Coming soon/);
    assert.match(rewriteModels, /ib-settings-helper|helper/);
  });

  it("Capture popup stays chrome-free of Settings/Help/account", () => {
    const captureHtml = readRoot("capture.html");
    assert.doesNotMatch(
      captureHtml,
      /ShellLayout|SettingsPage|HelpPage|Sidebar/,
    );
    assert.ok(
      existsSync(src("capture", "CaptureApp.tsx")),
      "expected Fluent CaptureApp",
    );
    const captureApp = readSrc("capture", "CaptureApp.tsx");
    assert.doesNotMatch(
      captureApp,
      /SettingsPage|HelpPage|ShellLayout|Sidebar/,
    );
  });
});
