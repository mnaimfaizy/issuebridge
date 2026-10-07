/**
 * Capture popup contracts for #39 — chrome-free voice-first Fluent surface.
 * Asserts observable adapter contracts in source (not Fluent internals).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CAPTURE_DEFAULT_SIZE,
  CAPTURE_MIN_SIZE,
  CAPTURE_SIZE_STORAGE_KEY,
  clampCaptureWindowSize,
  isStorableCaptureSize,
  isValidCaptureSize,
  readCaptureWindowSize,
} from "../src/capture/geometry.ts";

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

/** Every TypeScript source file under `dir`, recursively. */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
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
  const open = findBodyBrace(source, declared, name);
  const { end, code } = scanCode(source, open + 1);
  // The binding ends here: `}, [deps])` for a hook callback, `};` otherwise.
  assert.match(
    source.slice(end + 1),
    /^\s*[,;)]/,
    `the body of \`${name}\` was cut short`,
  );
  return `{${code}}`;
}

/**
 * The `{` opening the body of the binding declared at `from`.
 *
 * Not simply the first `{` after the name: in TypeScript that is often a type
 * annotation — `async (opts: { force: boolean }) => {` — and slicing that
 * would return a body holding no code at all, so every "must not contain"
 * assertion below would pass by default. A body brace follows `=>` or the
 * closing `)` of a parameter list.
 */
function findBodyBrace(source, from, name) {
  for (let i = from; i < source.length; i += 1) {
    if (source[i] !== "{") continue;
    const before = source.slice(from, i).trimEnd();
    if (before.endsWith("=>") || before.endsWith(")")) return i;
  }
  assert.fail(`expected a function body for \`${name}\``);
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
    } else if (ch === "/" && opensRegex(code)) {
      const after = skipRegex(source, i);
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

/**
 * Whether the `/` following `code` opens a regex literal rather than dividing.
 * Decided from the preceding code: after a value — identifier, `)`, `]`, digit
 * — a `/` divides; after an operator, a keyword or nothing it opens a pattern.
 * A quote or bracket inside an unrecognised regex would otherwise be read as a
 * string opener and swallow the rest of the body.
 */
function opensRegex(code) {
  const before = code.trimEnd();
  if (before === "") return true;
  if (!/[\w$)\]]$/.test(before)) return true;
  return /\b(return|typeof|case|in|of|new|delete|void|await|yield|do|else)$/.test(
    before,
  );
}

/** The index just past the regex literal opening at `start`, flags included. */
function skipRegex(source, start) {
  let inClass = false;
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\\") {
      i += 1;
    } else if (ch === "[") {
      inClass = true;
    } else if (ch === "]") {
      inClass = false;
    } else if (ch === "\n") {
      break;
    } else if (ch === "/" && !inClass) {
      let after = i + 1;
      while (after < source.length && /[a-z]/.test(source[after])) after += 1;
      return after;
    }
  }
  assert.fail("unterminated regex literal");
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

/**
 * `readCaptureWindowSize()` with `raw` as the whole of storage. The module reads
 * the browser's `localStorage`, which Node has no ambient equivalent of, so one
 * stands in for the call and is taken away again afterwards.
 */
function readStoredSize(raw) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => (key === CAPTURE_SIZE_STORAGE_KEY ? raw : null),
  };
  try {
    return readCaptureWindowSize();
  } finally {
    globalThis.localStorage = previous;
  }
}

/**
 * The size left stored after a restore of `stored` on a `area`/`frame` display,
 * with `events` delivered in order as `{ size, duringRestore }` `Resized`
 * payloads. Mirrors what CaptureApp does per event — clamp once, then judge each
 * resize against the gate and the size the restore asked for — so an ordering
 * can be asserted without a window to resize. That the app wires the two up this
 * way is asserted separately, from source.
 */
function replayResizes(stored, area, frame, events) {
  const restoreSize = clampCaptureWindowSize(stored, area, frame);
  let kept = stored;
  for (const { size, duringRestore } of events) {
    if (isStorableCaptureSize(size, { duringRestore, restoreSize })) {
      kept = size;
    }
  }
  return kept;
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
    assert.match(rust, /\.inner_size\(/);
    assert.match(rust, /\.min_inner_size\(/);
    assert.match(rust, /always_on_top\(true\)/);
    assert.match(rust, /prevent_close|hide\(\)/);
    const geometry = readSrc("capture", "geometry.ts");
    assert.match(
      geometry,
      /issuebridge\.captureWindowSize|CAPTURE.*SIZE|writeCapture|readCapture/,
    );
  });

  it("Rust owns the Capture size and geometry.ts mirrors it (#205)", () => {
    const rust = readRoot("src-tauri", "src", "adapters", "capture_window.rs");
    const geometry = readSrc("capture", "geometry.ts");
    // Parsed from both sources rather than spelled out here, so the two cannot
    // drift apart and this test cannot become the stale third copy.
    const builder = (call) => {
      const match = rust.match(
        new RegExp(`\\.${call}\\((\\d+(?:\\.\\d+)?),\\s*(\\d+(?:\\.\\d+)?)\\)`),
      );
      assert.ok(match, `expected a \`.${call}(w, h)\` call`);
      return { width: Number(match[1]), height: Number(match[2]) };
    };
    const constant = (name) => {
      const match = geometry.match(
        new RegExp(
          `${name}[^=]*=\\s*{\\s*width:\\s*(\\d+),\\s*height:\\s*(\\d+),?\\s*}`,
        ),
      );
      assert.ok(match, `expected a \`${name}\` constant`);
      return { width: Number(match[1]), height: Number(match[2]) };
    };

    const defaultSize = builder("inner_size");
    const minSize = builder("min_inner_size");
    assert.deepEqual(constant("CAPTURE_DEFAULT_SIZE"), defaultSize);
    assert.deepEqual(constant("CAPTURE_MIN_SIZE"), minSize);

    // The default must hold the whole surface — hero, chips, repo field, Title,
    // Body and the actions — which 420x520 did not; see #205.
    assert.ok(
      defaultSize.width >= 440 && defaultSize.height >= 620,
      `Capture must open large enough for its content, got ${defaultSize.width}x${defaultSize.height}`,
    );
    assert.ok(
      minSize.width <= defaultSize.width &&
        minSize.height <= defaultSize.height,
      "the minimum must not exceed the default",
    );

    // A stored size is trimmed to this display before it is applied.
    const app = readSrc("capture", "CaptureApp.tsx");
    assert.match(app, /clampCaptureWindowSize\(/);
    assert.match(app, /currentMonitor\(/);
    assert.match(app, /workArea/);
    assert.match(geometry, /export function clampCaptureWindowSize/);

    // setSize is only reachable with an explicit grant, scoped to Capture so
    // the main window's ACL stays unchanged.
    const capability = JSON.parse(
      readRoot("src-tauri", "capabilities", "capture.json"),
    );
    assert.deepEqual(capability.windows, ["capture"]);
    assert.ok(
      capability.permissions.includes("core:window:allow-set-size"),
      "the Capture capability must grant core:window:allow-set-size",
    );
    const defaults = JSON.parse(
      readRoot("src-tauri", "capabilities", "default.json"),
    );
    assert.ok(
      !defaults.permissions.some((entry) => entry.endsWith(":allow-set-size")),
      "allow-set-size must not be granted to the main window",
    );
    // That scan sees single grants only: `permissions` also holds permission
    // *sets*, which nothing expands until the Rust build resolves the ACL, so a
    // set pulling set-size in would slip past it. Every set the main window is
    // given is therefore named here — another one fails this until someone has
    // checked what it expands to.
    const vettedSets = [
      "core:default",
      "opener:default",
      "global-shortcut:default",
    ];
    for (const permission of defaults.permissions) {
      assert.ok(
        /:(allow|deny)-/.test(permission) || vettedSets.includes(permission),
        `\`${permission}\` is an unvetted permission set: check what it grants the main window before adding it to default.json`,
      );
    }
    // What a vetted set expands to can change under a Tauri upgrade, and the
    // resolved ACL is build output that is not in the repo, so the rest of the
    // guard is behavioural: Capture is the only surface that resizes a window,
    // so a widened grant elsewhere would still resize nothing.
    const resizes = sourceFiles(src()).filter((file) =>
      /\.setSize\(/.test(readFileSync(file, "utf8")),
    );
    assert.deepEqual(
      resizes,
      [src("capture", "CaptureApp.tsx")],
      "only Capture may call setSize",
    );
  });

  it("the display clamp trims a stored Capture size to what fits (#205)", () => {
    const stored = { width: 900, height: 1000 };

    // Nothing usable to fit against: the minimum is all that applies, and the
    // stored size is left alone.
    for (const area of [
      undefined,
      null,
      { width: Number.NaN, height: 680 },
      { width: 1280, height: Number.POSITIVE_INFINITY },
      { width: 0, height: 680 },
      { width: 1280, height: -680 },
    ]) {
      assert.deepEqual(clampCaptureWindowSize(stored, area), stored);
      assert.deepEqual(
        clampCaptureWindowSize({ width: 10, height: 10 }, area),
        CAPTURE_MIN_SIZE,
      );
    }
    // Fractions become whole pixels rather than reaching the window.
    assert.deepEqual(clampCaptureWindowSize({ width: 599.4, height: 640.6 }), {
      width: 599,
      height: 641,
    });

    // A size stored on a bigger monitor is trimmed to this one. The clamped
    // value is an inner size while a work area is outer space, so the frame the
    // title bar and borders add comes off first — leaving it in puts the
    // actions back under the taskbar, by exactly the height of the title bar.
    const area = { width: 1280, height: 680 };
    const frame = { width: 16, height: 31 };
    assert.deepEqual(clampCaptureWindowSize(stored, area), {
      width: 900,
      height: 680,
    });
    assert.deepEqual(clampCaptureWindowSize(stored, area, frame), {
      width: 900,
      height: 649,
    });
    // A size that already fits is untouched.
    const fits = { width: 460, height: 640 };
    assert.deepEqual(clampCaptureWindowSize(fits, area, frame), fits);
    // A frame that is negative, or larger than the display itself, is ignored
    // rather than trusted.
    assert.deepEqual(
      clampCaptureWindowSize(stored, area, { width: -20, height: 10000 }),
      { width: 900, height: 680 },
    );

    // A work area genuinely smaller than the minimum — a small display at a
    // high scale factor — is trimmed only as far as the minimum. `min_inner_size`
    // is enforced by Windows on the `SetWindowPos` behind `setSize`, so a smaller
    // result could not reach the window: it would be raised back to the minimum
    // and the resize that came back would look like one the user had made.
    assert.deepEqual(
      clampCaptureWindowSize(stored, { width: 911, height: 480 }, frame),
      { width: 895, height: CAPTURE_MIN_SIZE.height },
    );
  });

  it("only the user's own resize reaches the stored Capture size (#205)", () => {
    // Provenance decides, not the numbers. While the restore owns the size
    // nothing is stored, whatever that size happens to be: a snap or a DPI
    // change can repeat a size the restore already used, so a guard that only
    // matched sizes would let those through.
    for (const size of [
      { width: 900, height: 1000 },
      { width: 715, height: 560 },
      CAPTURE_MIN_SIZE,
      CAPTURE_DEFAULT_SIZE,
    ]) {
      assert.equal(
        isStorableCaptureSize(size, { duringRestore: true }),
        false,
        `${size.width}x${size.height} must not be stored while the restore owns the size`,
      );
      assert.equal(
        isStorableCaptureSize(size, { duringRestore: false }),
        true,
        `${size.width}x${size.height} is the user's resize and must be stored`,
      );
    }

    // The restore's own `Resized` makes its own trip back to the webview and
    // can land after `setSize` has resolved — a cold start, a webview still
    // booting, a loaded machine — by which point the gate is down. The size the
    // restore asked for is what still identifies it, with no clock involved.
    const asked = { width: 1200, height: 707 };
    const afterRestore = { duringRestore: false, restoreSize: asked };
    assert.equal(isStorableCaptureSize(asked, afterRestore), false);
    // A physical payload divided by a non-integer scale factor comes back a
    // fraction off the size the window took; that is still the restore's.
    assert.equal(
      isStorableCaptureSize({ width: 1200, height: 706.667 }, afterRestore),
      false,
    );
    // Any other size, with the gate down, is the user's.
    assert.equal(
      isStorableCaptureSize({ width: 1000, height: 800 }, afterRestore),
      true,
    );

    // Windows reports {0, 0} on minimise, and writeCaptureWindowSize floors
    // that to the minimum — so storing it replaces the size the user chose,
    // for good if Capture is minimised when the app quits.
    for (const size of [
      { width: 0, height: 0 },
      { width: 0, height: 640 },
      { width: 460, height: 0 },
      { width: -460, height: -640 },
      { width: Number.NaN, height: 640 },
    ]) {
      assert.equal(
        isStorableCaptureSize(size, { duringRestore: false }),
        false,
      );
      // That half is payload validation, and answers on its own.
      assert.equal(isValidCaptureSize(size), false);
    }
    assert.equal(isValidCaptureSize(CAPTURE_DEFAULT_SIZE), true);

    // Maximising is the mirror of minimising: a window-state transition, not a
    // size anyone picked. Windows reports the whole work area for it, and
    // Capture is always_on_top with nothing to un-maximise it on open, so
    // storing it reopens the popup over the application under test.
    const maximised = { width: 1920, height: 1017 };
    assert.equal(
      isStorableCaptureSize(maximised, {
        duringRestore: false,
        maximized: true,
      }),
      false,
    );
    // The same extent dragged to by hand is the user's, and is stored.
    assert.equal(
      isStorableCaptureSize(maximised, {
        duringRestore: false,
        maximized: false,
      }),
      true,
    );

    // #205's own regression, replayed in the order the window delivers the
    // events: a 1200x900 stored on a bigger monitor, trimmed to 1200x707 by a
    // 1366x738 laptop work area, and the restore's own resize coming back after
    // the gate is down. The trim must not become the stored size — the next open
    // would trim it again, so the user's 900 would never come back.
    const laptop = { width: 1366, height: 738 };
    const frame = { width: 16, height: 31 };
    const opened = { size: CAPTURE_DEFAULT_SIZE, duringRestore: true };
    const late = { size: { width: 1200, height: 707 }, duringRestore: false };
    assert.deepEqual(
      replayResizes({ width: 1200, height: 900 }, laptop, frame, [
        opened,
        late,
      ]),
      { width: 1200, height: 900 },
    );
    // A drag afterwards is the user's, and does land.
    const dragged = {
      size: { width: 1000, height: 720 },
      duringRestore: false,
    };
    assert.deepEqual(
      replayResizes({ width: 1200, height: 900 }, laptop, frame, [
        opened,
        late,
        dragged,
      ]),
      dragged.size,
    );

    const app = readSrc("capture", "CaptureApp.tsx");
    // The resize handler stores nothing the guard rejects...
    assert.match(app, /isStorableCaptureSize\(size, {/);
    assert.match(app, /duringRestore,\s*restoreSize: requested,\s*maximized,/);
    // ...including a maximise, which it asks the window about rather than
    // guessing from the numbers.
    assert.match(app, /await win\.isMaximized\(\)/);
    // ...and reads both as of the event, not after the awaited scale factor, so
    // a restore settling mid-handler cannot let its own resize through.
    assert.match(
      app,
      /const duringRestore = restoring;\s*const requested = restoreSize;[\s\S]*?await win\.scaleFactor\(\)/,
    );
    // The gate is armed before the restore's first await, not once its
    // `setSize` is issued: the window is interactive the whole way through, so
    // the earlier round-trips are inside the restore too.
    const armed = app.indexOf("let restoring = true");
    const firstAwait = app.indexOf("await currentMonitor(");
    assert.ok(armed !== -1, "expected a restore gate in CaptureApp");
    assert.ok(
      firstAwait !== -1 && armed < firstAwait,
      "the restore gate must be armed before the restore's first await",
    );
    // The size the restore asks for is recorded before the call, and the gate
    // is released when the call settles. Nothing waits out a wall-clock guess:
    // a `Resized` arriving later than any timer would still be recognised.
    const recorded = app.indexOf("restoreSize = size;");
    const issued = app.indexOf("await win.setSize(");
    assert.ok(recorded !== -1 && issued !== -1);
    assert.ok(
      recorded < issued,
      "the restore must record the size it asks for before asking",
    );
    assert.match(app, /finally {[\s\S]*?restoring = false;/);
    assert.doesNotMatch(
      app,
      /setTimeout\(\s*\(\)\s*=>\s*{\s*restoring = false;/,
    );
  });

  it("the display clamp never asks for a size the window may not take (#205)", () => {
    // `min_inner_size` is a floor Windows enforces, so a clamp result below it
    // never reaches the window: it is raised back, and the resize that comes
    // back then reads as one the user made. A case pinning a sub-minimum size
    // would pass against the pure function and certify a branch the running
    // app does not have, so the floor is asserted over the whole input space
    // rather than one example at a time.
    const areas = [
      undefined,
      null,
      { width: 1, height: 1 },
      { width: 320, height: 240 },
      { width: 911, height: 480 },
      { width: 1280, height: 680 },
      { width: 3840, height: 2000 },
    ];
    const frames = [
      undefined,
      { width: 16, height: 31 },
      { width: 2, height: 4000 },
    ];
    const wants = [
      { width: 0, height: 0 },
      { width: 10, height: 10 },
      { width: 460, height: 640 },
      { width: 900, height: 1000 },
      { width: 9000, height: 9000 },
    ];
    for (const area of areas) {
      for (const frame of frames) {
        for (const want of wants) {
          const got = clampCaptureWindowSize(want, area, frame);
          assert.ok(
            got.width >= CAPTURE_MIN_SIZE.width &&
              got.height >= CAPTURE_MIN_SIZE.height,
            `clamping ${want.width}x${want.height} to area ${JSON.stringify(area)} frame ${JSON.stringify(frame)} gave ${got.width}x${got.height}, under the ${CAPTURE_MIN_SIZE.width}x${CAPTURE_MIN_SIZE.height} floor the window enforces`,
          );
        }
      }
    }
  });

  it("a Capture size stored before #205 does not survive the upgrade (#205)", () => {
    // Restoring a stored size never worked before #205, so an existing install
    // holds the old 420x520 default: the window it happened to get, not a size
    // anyone chose. Honouring it would reopen Capture smaller than the default
    // this fix declares necessary, leaving the reporters of #205 without it.
    assert.deepEqual(
      readStoredSize('{"width":420,"height":520}'),
      CAPTURE_DEFAULT_SIZE,
    );
    assert.deepEqual(
      readStoredSize('{"width":380,"height":460}'),
      CAPTURE_DEFAULT_SIZE,
    );
    // A size the user grew past that default is still theirs to keep.
    assert.deepEqual(readStoredSize('{"width":900,"height":1000}'), {
      width: 900,
      height: 1000,
    });
    // Each dimension is judged on its own. A resize was stored before #205 even
    // though it was never applied, so a user who widened the cramped popup to
    // stop the chips clipping — and left the height at the old default — has
    // chosen the width and not the height. Taking the pair as one would keep
    // that 520 and reopen Capture shorter than #205 declares necessary.
    assert.deepEqual(readStoredSize('{"width":600,"height":520}'), {
      width: 600,
      height: CAPTURE_DEFAULT_SIZE.height,
    });
    assert.deepEqual(readStoredSize('{"width":420,"height":900}'), {
      width: CAPTURE_DEFAULT_SIZE.width,
      height: 900,
    });
    // Nothing stored, or nonsense stored, opens at the default.
    assert.deepEqual(readStoredSize(null), CAPTURE_DEFAULT_SIZE);
    assert.deepEqual(readStoredSize("{"), CAPTURE_DEFAULT_SIZE);
    assert.deepEqual(
      readStoredSize('{"width":"wide","height":640}'),
      CAPTURE_DEFAULT_SIZE,
    );
  });

  it("the compose region scrolls, not the Capture shell (#205)", () => {
    const css = readSrc("capture", "capture.css");
    const rule = (selector) => {
      const at = css.indexOf(`${selector} {`);
      assert.ok(at !== -1, `expected a \`${selector}\` rule`);
      const end = css.indexOf("}", at);
      assert.ok(end !== -1, `unterminated \`${selector}\` rule`);
      return css.slice(at, end);
    };

    // The shell is clamped to the window and never scrolls: scrolling it used
    // to carry the hero and the repo controls out of view.
    const shell = rule(".ib-capture");
    assert.match(shell, /overflow:\s*hidden/);
    assert.doesNotMatch(shell, /max-height:\s*100vh/);
    assert.doesNotMatch(shell, /overflow:\s*auto/);
    // Only the compose row may shrink, so hero and actions always stay visible.
    assert.match(shell, /grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);

    const compose = rule(".ib-capture-compose");
    assert.match(compose, /overflow:\s*auto/);
    assert.match(compose, /min-height:\s*0/);
    assert.match(compose, /scrollbar-gutter:\s*stable/);

    // Body takes the leftover height instead of a fixed floor at every size,
    // and must win on specificity rather than on source order: a bare
    // `.ib-capture-body` rule only ties with `.ib-capture-compose > *` above,
    // so swapping the two would silently stop Body from flexing.
    assert.match(rule(".ib-capture-compose > *"), /flex:\s*0 0 auto/);
    const bodyFlex = css.match(/\n([^{}\n]*\.ib-capture-body)\s*\{([^}]*)\}/);
    assert.ok(bodyFlex, "expected a rule for `.ib-capture-body`");
    assert.match(bodyFlex[2], /flex:\s*1 1 auto/);
    assert.match(
      bodyFlex[1].trim(),
      /^\.ib-capture-compose\s*>\s*\.ib-capture-body$/,
      `the Body flex rule must outrank \`.ib-capture-compose > *\`, got \`${bodyFlex[1].trim()}\``,
    );
    const popup = readSrc("capture", "CapturePopup.tsx");
    assert.match(popup, /className="ib-capture-body"/);
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

  it("readBody slices the body, not a type annotation, and skips regexes", () => {
    const source = [
      "const sample = useCallback(async (opts: { force: boolean }) => {",
      "  const label = String(opts.force).replace(/['{]/g, '');",
      "  return label;",
      "}, []);",
    ].join("\n");
    const body = readBody(source, "sample");
    assert.match(body, /return label;/);
    assert.ok(
      !body.includes("force: boolean"),
      "a parameter type annotation is not the body",
    );
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

    // A pick made while that reload is in flight is the user's, not the
    // previous Capture's, so the default must not land on top of it.
    assert.match(startCapture, /repoPickedRef\.current = false/);
    assert.match(startCapture, /if \(repoPickedRef\.current\) return/);

    // Having no repo at all is a dead end — Save Draft refuses and only a new
    // Capture applies the default — so a reload may fill a null selection.
    // That is the one repo change a refocus is allowed to make.
    const adopt = readBody(popup, "adoptDefaultRepo");
    assert.match(adopt, /if \(selectedRepoRef\.current\) return/);
    assert.match(adopt, /defaultRepo\(/);
    assert.match(onFocus, /adoptDefaultRepo\(/);

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
        handlers.length + 2,
        `${setter} belongs to startCapture and adoptDefaultRepo plus the two user handlers`,
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

    // Closing the window with X ends the Capture too: Rust prevents the close,
    // hides, and says so, because the webview cannot see that hide.
    const rust = readRoot("src-tauri", "src", "adapters", "capture_window.rs");
    assert.match(rust, /emit\(["']capture-hidden["']/);
    assert.match(popup, /listen\(["']capture-hidden["']/);

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
