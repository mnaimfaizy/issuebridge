/**
 * Session validation contracts for #111.
 * A vaulted token is not proof of a session: launch validates it with GitHub, a rejected
 * token forces Sign out, and the shell hears about it without waiting for window focus.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(...parts) {
  const path = join(root, ...parts);
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

describe("Session validation (#111)", () => {
  it("core validates the vaulted session against GitHub instead of trusting the vault", () => {
    const core = read("src-tauri", "src", "core", "mod.rs");
    assert.match(core, /pub fn validate_session\(&mut self\) -> AuthState/);
    assert.match(
      core,
      /fn force_sign_out_if_credentials_rejected\(&mut self\) -> bool/,
    );
    // Offline must not evict a good session.
    assert.match(
      core,
      /Err\(GitHubError::Unavailable\) => self\.auth_state\(\)/,
    );
  });

  it("label catalog refresh reports an expired session instead of soft-failing", () => {
    const errors = read("src-tauri", "src", "core", "error.rs");
    assert.match(errors, /SessionExpired/);
    const core = read("src-tauri", "src", "core", "mod.rs");
    assert.match(core, /LabelCatalogError::SessionExpired/);
  });

  it("commands expose validate_session and emit auth-changed on a forced Sign out", () => {
    const commands = read("src-tauri", "src", "adapters", "commands.rs");
    assert.match(commands, /pub async fn validate_session/);
    assert.match(commands, /pub fn validate_session_and_emit/);
    assert.match(commands, /emit\("auth-changed"/);
    assert.match(commands, /fn emit_signed_out/);
    assert.match(commands, /LabelCatalogError::SessionExpired => \{/);
  });

  it("launch validates the session off the main thread and registers the command", () => {
    const lib = read("src-tauri", "src", "lib.rs");
    assert.match(lib, /validate_session,/);
    assert.match(
      lib,
      /spawn_blocking\(move \|\| \{[\s\S]*validate_session_and_emit/,
    );
  });

  it("shell validates on mount and routes to Sign in when auth-changed fires", () => {
    const app = read("src", "App.tsx");
    assert.match(app, /invoke<AuthStateDto>\("validate_session"\)/);
    assert.match(app, /listen\("auth-changed"/);
    assert.match(app, /refreshShellAccount\(\)/);
  });

  it("Inbox surfaces a hard label catalog failure instead of retrying quietly", () => {
    const inbox = read("src", "inbox", "InboxWorkbench.tsx");
    assert.match(
      inbox,
      /prefetch_testing_set_label_catalogs"\);\s*\}\s*catch \(error\) \{[\s\S]*showError\(formatInvokeError\(error\)\)/,
    );
  });
});
