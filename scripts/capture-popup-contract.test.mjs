/**
 * Capture popup contracts for #39 — chrome-free voice-first Fluent surface.
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

describe("Capture popup (#39)", () => {
  it("vanilla Capture DOM is removed; Capture mounts through React + FluentProvider", () => {
    const html = readRoot("capture.html");
    assert.match(html, /id=["']root["']/);
    assert.doesNotMatch(html, /id=["']capture-ptt["']/);
    assert.doesNotMatch(html, /id=["']capture-save["']/);
    assert.doesNotMatch(html, /id=["']capture-title["']/);
    assert.doesNotMatch(html, /capture\.ts/);
    assert.ok(!existsSync(src("capture.ts")), "vanilla capture.ts must be removed");
    assert.ok(
      existsSync(src("capture", "CaptureApp.tsx")),
      "expected CaptureApp",
    );
    assert.ok(
      existsSync(src("capture", "CapturePopup.tsx")),
      "expected CapturePopup",
    );
    const app = readSrc("capture", "CaptureApp.tsx");
    assert.match(app, /FluentProvider/);
    assert.match(app, /webLightTheme|webDarkTheme/);
    assert.match(app, /CapturePopup/);
  });

  it("Capture stays chrome-free of Settings/Help/account shell", () => {
    const html = readRoot("capture.html");
    assert.doesNotMatch(html, /ShellLayout|SettingsPage|HelpPage|Sidebar/);
    const app = readSrc("capture", "CaptureApp.tsx");
    const popup = readSrc("capture", "CapturePopup.tsx");
    for (const source of [app, popup]) {
      assert.doesNotMatch(source, /ShellLayout|SettingsPage|HelpPage|Sidebar/);
      assert.doesNotMatch(source, /Sign out|Sign in|account/i);
    }
  });

  it("voice-first hero shows Hold-to-talk pressed/recording cues with timer and target", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /Hold to talk/);
    assert.match(popup, /Release to stop/);
    assert.match(popup, /Transcribing/);
    assert.match(popup, /timer|seconds|formatMs|0:00/i);
    assert.match(popup, /title|body/);
    assert.match(popup, /MicRegular|mic/i);
    const css = readSrc("capture", "capture.css");
    assert.match(css, /recording|ptt-active|prefers-reduced-motion/);
  });

  it("Testing-set chips, title/body compose, sticky Save Draft / Cancel; no Publish", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /testing_set|testingSet/);
    assert.match(popup, /chip|Testing set/i);
    assert.match(popup, /Untitled/);
    assert.match(popup, /What happened\?/);
    assert.match(popup, /Save Draft/);
    assert.match(popup, /Cancel/);
    assert.match(popup, /save_capture/);
    assert.doesNotMatch(popup, /publish_draft|Publish/);
    const css = readSrc("capture", "capture.css");
    assert.match(css, /sticky/);
  });

  it("Ctrl+S saves; Esc hides; open focuses Title; hide does not focus main", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /keydown|KeyboardEvent/);
    assert.match(popup, /Escape|Esc/);
    assert.match(popup, /ctrlKey|metaKey/);
    assert.match(popup, /toLowerCase\(\)\s*===\s*["']s["']/);
    assert.match(popup, /titleRef\.current\?\.focus|titleRef/);
    assert.match(popup, /\.hide\(/);
    assert.doesNotMatch(
      popup,
      /setFocus\s*\(/,
      "hide must not steal main-window focus",
    );
    assert.match(
      popup,
      /Hide only|do not focus the main window/i,
    );
  });

  it("PTT snapshots last title/body focus and restores after transcription; voice errors inline", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /lastTextFieldRef|pttTargetRef|voiceTarget/);
    assert.match(popup, /ptt-pressed|ptt-released/);
    assert.match(popup, /apply_ptt/);
    assert.match(popup, /permission_denied|no_device|sidecar_failed|empty_transcript/);
    assert.match(popup, /VOICE_MESSAGES|showVoiceKind/);
    assert.match(popup, /Save Draft/);
    const messages = readSrc("capture", "voiceMessages.ts");
    assert.match(
      messages,
      /microphone access|No microphone|Whisper sidecar|Didn.t catch that/i,
    );
  });

  it("theme follows System/Light/Dark via shared preference; geometry contracts in Rust", () => {
    const app = readSrc("capture", "CaptureApp.tsx");
    assert.match(app, /readThemePreference|THEME_STORAGE_KEY|themePreference/);
    assert.match(app, /resolveIsDark/);
    assert.match(app, /prefers-color-scheme|readSystemPrefersDark/);
    const rust = readRoot("src-tauri", "src", "adapters", "capture_window.rs");
    assert.match(rust, /420\.0.*520\.0|inner_size\(420/);
    assert.match(rust, /min_inner_size|360\.0.*420\.0/);
    assert.match(rust, /always_on_top\(true\)/);
    assert.match(rust, /prevent_close|hide\(\)/);
    const geometry = readSrc("capture", "geometry.ts");
    assert.match(geometry, /issuebridge\.captureWindowSize|CAPTURE.*SIZE|writeCapture|readCapture/);
  });

  it("field text clears after successful Save; voice status copy stays text-backed", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /setTitle\(["']["']\)|title.*["']["']/);
    assert.match(popup, /setBody\(["']["']\)|body.*["']["']/);
    assert.match(popup, /Save Draft/);
    assert.doesNotMatch(
      popup,
      /color-only|icon-only without text/i,
    );
  });
});
