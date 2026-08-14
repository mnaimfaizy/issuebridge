/**
 * Session validation contracts for #111.
 * A vaulted access token is only a session while GitHub still accepts it:
 * validate on launch, force Sign out on 401, and tell the shell about it.
 * Asserts observable adapter/source contracts (not Fluent internals).
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
  it("core validates the vaulted session against GitHub instead of trusting presence", () => {
    const core = read("src-tauri", "src", "core", "mod.rs");
    assert.match(core, /pub fn validate_session\(&mut self\) -> AuthState/);
    assert.match(core, /fn credentials_rejected\(&mut self\) -> bool/);
    // Rejected credentials clear the vault; offline keeps the session.
    assert.match(
      core,
      /Err\(GitHubError::Unavailable\) => self\.auth_state\(\)/,
    );
  });

  it("label catalog refresh signs out on a rejected token instead of soft-failing", () => {
    const core = read("src-tauri", "src", "core", "mod.rs");
    const errors = read("src-tauri", "src", "core", "error.rs");
    assert.match(errors, /SessionExpired/);
    assert.match(
      core,
      /Err\(GitHubError::InvalidCredentials\) if self\.credentials_rejected\(\) =>\s*\{?\s*Err\(LabelCatalogError::SessionExpired\)/,
    );
  });

  it("Publish, Update and Install Continue re-check credentials before mapping the error", () => {
    const core = read("src-tauri", "src", "core", "mod.rs");
    assert.match(core, /fn publish_error_for\(&mut self, err: GitHubError\)/);
    assert.match(core, /fn update_error_for\(&mut self, err: GitHubError\)/);
    // continue_install keeps the identity-only PAT message when the token is still valid.
    assert.match(core, /InstallError::TokenLacksInstallAccess/);
    assert.match(core, /if self\.credentials_rejected\(\)/);
  });

  it("launch validates the session off the main thread and exposes a validate_session command", () => {
    const lib = read("src-tauri", "src", "lib.rs");
    const commands = read("src-tauri", "src", "adapters", "commands.rs");
    assert.match(lib, /validate_session_on_launch\(app\.handle\(\)\)/);
    assert.match(lib, /validate_session,/);
    assert.match(
      commands,
      /pub fn validate_session_on_launch\(app: &AppHandle\)/,
    );
    assert.match(commands, /spawn_blocking/);
    assert.match(commands, /pub async fn validate_session\(/);
  });

  it("a forced Sign out outranks vault presence even if clearing the vault fails", () => {
    const core = read("src-tauri", "src", "core", "mod.rs");
    // Regression guard: sign_out used to `?` on the vault clear and return before
    // dropping the session, so a locked keychain left auth_state reporting SignedIn
    // while validate_session reported SignedOut — the exact #111 symptom.
    assert.match(
      core,
      /let cleared = self\.token_store\.clear\(\);\s*\n\s*self\.session = SessionDecision::SignedOut;/,
    );
    // auth_state consults the process decision before falling back to the vault.
    assert.match(core, /SessionDecision::SignedOut => AuthState::SignedOut/);
  });

  it("launch validation calls GitHub outside the core lock", () => {
    const commands = read("src-tauri", "src", "adapters", "commands.rs");
    const core = read("src-tauri", "src", "core", "mod.rs");
    // Holding the mutex across the request would stall the shell's first auth_state /
    // list_inbox call for the whole HTTP timeout on a slow launch.
    assert.match(core, /pub fn probe_session\(&mut self\) -> SessionProbe/);
    assert.match(core, /pub fn apply_session_validation\(/);
    assert.match(commands, /SessionProbe::Token\(token\) => token/);
    assert.match(commands, /HttpGitHub::default\(\)\.validate_pat\(&token\)/);
    assert.match(commands, /apply_session_validation\(&token, result\)/);
  });

  it("forced Sign out reaches the shell through an auth-changed event", () => {
    const commands = read("src-tauri", "src", "adapters", "commands.rs");
    const app = read("src", "App.tsx");
    assert.match(commands, /app\.emit\("auth-changed"/);
    assert.match(
      commands,
      /fn emit_if_signed_out\(app: &AppHandle, auth: AuthState\)/,
    );
    assert.match(app, /listen\("auth-changed"/);
    assert.match(app, /refreshShellAccount\(\)/);
    // listen() resolves async: without a cancelled guard, an unmount before it settles
    // leaks a second permanent listener (StrictMode remounts hit this every time).
    assert.match(app, /let cancelled = false;/);
    assert.match(app, /if \(cancelled\) \{\s*\n\s*fn\(\);/);
  });

  it("expired sessions surface a Sign-in-again message instead of a silent retry", () => {
    const commands = read("src-tauri", "src", "adapters", "commands.rs");
    const inbox = read("src", "inbox", "InboxWorkbench.tsx");
    assert.match(
      commands,
      /LabelCatalogError::SessionExpired =>[\s\S]{0,120}Sign in with GitHub again/,
    );
    assert.doesNotMatch(
      inbox,
      /catch \{\s*\/\/ Soft: Inbox still works without Testing set prefetch\./,
    );
    assert.match(inbox, /prefetch_testing_set_label_catalogs/);
  });

  it("ui contracts npm script runs this file", () => {
    const pkg = JSON.parse(read("package.json"));
    assert.match(
      pkg.scripts["test:ui-contracts"],
      /scripts\/session-validation-contract\.test\.mjs/,
    );
  });
});
