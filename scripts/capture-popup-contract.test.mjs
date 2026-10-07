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

/**
 * The code of a `const <name> = ... => { ... }` binding: its `{ ... }` body,
 * with comments removed. Anchored on the identifier, not on formatting, so it
 * survives reflows.
 *
 * Braces inside strings, template literals and comments are not counted: a
 * stray `}` there would otherwise end the slice early, and every "must not
 * contain" assertion below would then pass on code it no longer sees.
 * Comments are dropped so an assertion binds to code, not to prose about it.
 */
function readBody(source, name) {
  const declared = source.indexOf(`const ${name} = `);
  assert.ok(declared !== -1, `expected a \`const ${name}\` binding`);
  const open = source.indexOf("{", declared);
  assert.ok(open !== -1, `expected a body for \`${name}\``);
  const { end, code } = scanCode(source, open + 1);
  // The binding ends here: `}, [deps])` for a hook callback, `};` otherwise.
  assert.match(
    source.slice(end + 1),
    /^\s*[,;)]/,
    `the body of \`${name}\` was cut short`,
  );
  return `{${code}}`;
}

/** Scan code from `from` up to its unmatched `}`; return that index and the code without comments. */
function scanCode(source, from) {
  let depth = 0;
  let code = "";
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (source.startsWith("//", i)) {
      const eol = source.indexOf("\n", i);
      i = eol === -1 ? source.length : eol;
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      assert.ok(close !== -1, "unterminated block comment");
      i = close + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const after = skipLiteral(source, i);
      code += source.slice(i, after);
      i = after;
    } else {
      if (ch === "{") depth += 1;
      if (ch === "}") {
        if (depth === 0) return { end: i, code };
        depth -= 1;
      }
      code += ch;
      i += 1;
    }
  }
  assert.fail("unbalanced braces");
}

/** The index just past the string or template literal opening at `start`. */
function skipLiteral(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === "\\") {
      i += 1;
    } else if (source[i] === quote) {
      return i + 1;
    } else if (quote === "`" && source.startsWith("${", i)) {
      i = scanCode(source, i + 2).end;
    }
  }
  assert.fail("unterminated literal");
}

describe("Capture popup (#39)", () => {
  it("vanilla Capture DOM is removed; Capture mounts through React + FluentProvider", () => {
    const html = readRoot("capture.html");
    assert.match(html, /id=["']root["']/);
    assert.doesNotMatch(html, /id=["']capture-ptt["']/);
    assert.doesNotMatch(html, /id=["']capture-save["']/);
    assert.doesNotMatch(html, /id=["']capture-title["']/);
    assert.doesNotMatch(html, /capture\.ts/);
    assert.ok(
      !existsSync(src("capture.ts")),
      "vanilla capture.ts must be removed",
    );
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
    assert.match(popup, /Hide only|do not focus the main window/i);
  });

  it("PTT snapshots last title/body focus and restores after transcription; voice errors inline", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /lastTextFieldRef|pttTargetRef|voiceTarget/);
    assert.match(popup, /ptt-pressed|ptt-released/);
    assert.match(popup, /apply_ptt/);
    assert.match(
      popup,
      /permission_denied|no_device|sidecar_failed|empty_transcript/,
    );
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
    assert.match(
      geometry,
      /issuebridge\.captureWindowSize|CAPTURE.*SIZE|writeCapture|readCapture/,
    );
  });

  it("readBody ignores braces in strings, templates and comments", () => {
    const source = [
      "const sample = () => {",
      '  const a = "}";',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      "  const b = `${a}}`;",
      "  // a stray } in a comment",
      "  /* and { here */",
      "  return a + b;",
      "};",
    ].join("\n");
    const body = readBody(source, "sample");
    assert.match(body, /return a \+ b;/);
    assert.ok(!body.includes("stray"), "comments are dropped from the slice");
  });

  it("regaining focus refreshes repos but keeps the picked repo, caret and voice state (#197)", () => {
    const selection = readSrc("capture", "repoSelection.ts");
    assert.match(selection, /export function defaultRepo/);
    assert.match(selection, /export function repoKey/);
    assert.match(selection, /export function parseRepo/);
    assert.match(selection, /lastUsed\s*\?\?\s*testingSet\[0\]\s*\?\?\s*null/);

    const popup = readSrc("capture", "CapturePopup.tsx");

    // Goal 4: the window-level focus listener stays registered.
    assert.match(popup, /addEventListener\(\s*["']focus["']/);

    // A new Capture is started by the explicit gate, checked before the
    // mid-hold guard so a transcript still in flight cannot swallow it.
    const onFocus = readBody(popup, "onFocus");
    const gateAt = onFocus.search(/if \(resetFieldsOnShowRef\.current\)/);
    const holdAt = onFocus.search(
      /if \(recordingRef\.current \|\| pttBusyRef\.current\) return/,
    );
    assert.ok(
      gateAt !== -1,
      "a new Capture must be gated on resetFieldsOnShowRef",
    );
    assert.ok(
      holdAt !== -1,
      "a refocus mid-hold must bail out before refreshing",
    );
    assert.ok(gateAt < holdAt, "the new-Capture gate must be checked first");
    assert.match(onFocus, /startCapture\(\)/);
    assert.match(onFocus, /refresh\(\)/);

    // The refresh path reloads lists only: it never changes the target repo
    // or anything being composed.
    const refresh = readBody(popup, "refresh");
    assert.match(refresh, /testing_set/);
    assert.match(refresh, /app_visible_repos/);
    assert.match(refresh, /ptt_hotkey/);
    for (const forbidden of [
      "setSelectedRepo",
      "setRepoFilter",
      "setTitle",
      "setBody",
      "setVoiceUi",
      "clearVoiceStatus",
      "titleRef",
      "focusField",
    ]) {
      assert.ok(
        !refresh.includes(forbidden),
        `refresh must not call ${forbidden} — that belongs to a new Capture`,
      );
    }

    // A new Capture still opens clean (goal 5), and lowers its gate before
    // the reload awaits, so a second focus event cannot start another.
    const startCapture = readBody(popup, "startCapture");
    const lowerAt = startCapture.indexOf(
      "resetFieldsOnShowRef.current = false",
    );
    const awaitAt = startCapture.indexOf("await refresh()");
    assert.ok(lowerAt !== -1 && awaitAt !== -1);
    assert.ok(lowerAt < awaitAt, "the gate must be lowered before awaiting");
    assert.match(startCapture, /setTitle\(["']["']\)/);
    assert.match(startCapture, /setBody\(["']["']\)/);
    assert.match(startCapture, /setVoiceUi\(["']idle["']\)/);
    assert.match(startCapture, /titleRef\.current\?\.focus\(\)/);
    assert.match(startCapture, /defaultRepo\(/);
    assert.match(startCapture, /setSelectedRepo\(next\)/);
    assert.match(startCapture, /setRepoFilter\(/);

    // Caret is only stolen by a new Capture, never by a plain refocus.
    assert.equal(
      popup.split("titleRef.current?.focus()").length - 1,
      1,
      "titleRef.current?.focus() belongs to startCapture only",
    );

    // Repo selection otherwise changes only through explicit user handlers.
    const handlers = ["selectRepo", "onRepoFilterChange"];
    for (const name of handlers) {
      assert.match(popup, new RegExp(`function ${name}\\(`));
    }
    for (const setter of ["setSelectedRepo(", "setRepoFilter("]) {
      assert.equal(
        popup.split(setter).length - 1,
        handlers.length + 1,
        `${setter} belongs to startCapture plus the two user handlers`,
      );
    }
  });

  it("a transcript from an ended Capture never lands in the next one (#197)", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");

    // Ending a Capture advances its id alongside raising the gate.
    const hideCapture = readBody(popup, "hideCapture");
    assert.match(hideCapture, /captureIdRef\.current \+= 1/);
    assert.match(hideCapture, /resetFieldsOnShowRef\.current = true/);
    // The orphaned transcript must not leave the next Capture's PTT wedged.
    assert.match(hideCapture, /pttBusyRef\.current = false/);

    const stopPtt = readBody(popup, "stopPtt");
    // Busy from release, not from transcription: no refocus window between.
    const busyAt = stopPtt.indexOf("pttBusyRef.current = true");
    const teardownAt = stopPtt.indexOf("await teardownAudio()");
    assert.ok(busyAt !== -1 && teardownAt !== -1);
    assert.ok(busyAt < teardownAt, "pttBusyRef must be set before teardown");
    assert.match(stopPtt, /finally\s*\{\s*pttBusyRef\.current = false/);

    // The transcript is applied only if its Capture is still the current one.
    const appliedAt = stopPtt.indexOf("setTitle(result.text)");
    const checkAt = stopPtt.lastIndexOf(
      "if (!isCurrentCapture()) return",
      appliedAt,
    );
    const invokeAt = stopPtt.indexOf('"apply_ptt"');
    assert.ok(appliedAt !== -1 && invokeAt !== -1);
    assert.ok(
      checkAt > invokeAt,
      "the Capture must be re-checked after apply_ptt resolves",
    );
  });

  it("field text clears after successful Save; voice status copy stays text-backed", () => {
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /setTitle\(["']["']\)|title.*["']["']/);
    assert.match(popup, /setBody\(["']["']\)|body.*["']["']/);
    assert.match(popup, /Save Draft/);
    assert.doesNotMatch(popup, /color-only|icon-only without text/i);
  });
});
