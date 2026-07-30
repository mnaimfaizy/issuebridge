/**
 * Shell chrome contracts for #36 — React + Fluent bootstrap.
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

describe("shell chrome (#36)", () => {
  it("main window mounts through React with FluentProvider and stock themes", () => {
    const app = readSrc("App.tsx");
    assert.match(app, /FluentProvider/);
    assert.match(app, /webLightTheme/);
    assert.match(app, /webDarkTheme/);
    const index = readFileSync(join(root, "index.html"), "utf8");
    assert.match(index, /id=["']root["']/);
    assert.match(index, /src\/main\.tsx/);
    assert.doesNotMatch(
      index,
      /class=["']shell["']/,
      "vanilla centered .shell chrome must be removed from index.html",
    );
  });

  it("theme preference defaults to System and follows prefers-color-scheme", () => {
    const theme = readSrc("theme", "preference.ts");
    assert.match(theme, /["']system["']/);
    assert.match(theme, /["']light["']/);
    assert.match(theme, /["']dark["']/);
    assert.match(theme, /issuebridge\.themePreference/);
    assert.match(theme, /prefers-color-scheme/);
    const app = readSrc("App.tsx");
    assert.match(
      app,
      /matchMedia\(\s*['"]\(prefers-color-scheme:\s*dark\)['"]\s*\)/,
    );
  });

  it("compact sidebar lists Inbox top and Help → Settings → account bottom", () => {
    const sidebar = readSrc("shell", "Sidebar.tsx");
    const inbox = sidebar.indexOf('label="Inbox"');
    const help = sidebar.indexOf('label="Help"');
    const settings = sidebar.indexOf('label="Settings"');
    const account = Math.max(
      sidebar.indexOf(">Sign out<"),
      sidebar.indexOf(">Sign in<"),
      sidebar.indexOf(">Signed in<"),
    );
    assert.ok(inbox >= 0, "sidebar must include Inbox");
    assert.ok(help >= 0, "sidebar must include Help");
    assert.ok(settings >= 0, "sidebar must include Settings");
    assert.ok(account >= 0, "sidebar must include account cue");
    assert.ok(inbox < help, "Inbox must appear before Help");
    assert.ok(help < settings, "Help must appear before Settings");
    assert.ok(settings < account, "Settings must appear before account");
    assert.match(
      sidebar,
      /firstRunComplete/,
      "Sign in must be gated until after first-run",
    );
  });

  it("destination routing can replace workspace with Settings or Help", () => {
    const destinations = readSrc("shell", "destinations.ts");
    assert.match(destinations, /inbox/);
    assert.match(destinations, /settings/);
    assert.match(destinations, /help/);
    const shell = readSrc("shell", "ShellLayout.tsx");
    assert.match(shell, /settings/);
    assert.match(shell, /help/);
    assert.match(shell, /inbox/);
  });

  it("vanilla conflict host removed; first-run and ConflictDialog are React", () => {
    assert.ok(!existsSync(src("shell", "LegacyWorkspaceHost.tsx")));
    const shell = readSrc("shell", "ShellLayout.tsx");
    assert.doesNotMatch(shell, /LegacyWorkspaceHost/);
    const mainUi = readSrc("main.ts");
    assert.doesNotMatch(mainUi, /conflict-modal|bootMainUi/);
    assert.doesNotMatch(
      mainUi,
      /list_inbox/,
      "Inbox list moved to React workbench (#37)",
    );
    assert.ok(
      existsSync(src("firstrun", "FirstRunWorkbench.tsx")),
      "first-run moved to React (#40)",
    );
    assert.ok(
      existsSync(src("inbox", "ConflictDialog.tsx")),
      "conflict moved to Fluent ConflictDialog (#41)",
    );
    const index = readFileSync(join(root, "index.html"), "utf8");
    assert.doesNotMatch(index, /id=["']conflict-modal["']/);
  });
});
