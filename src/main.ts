import { invoke } from "@tauri-apps/api/core";

type AuthStateDto = "signed_out" | "signed_in";

window.addEventListener("DOMContentLoaded", () => {
  const signInGithub = document.querySelector<HTMLButtonElement>("#sign-in-github");
  const signOut = document.querySelector<HTMLButtonElement>("#sign-out");
  const patForm = document.querySelector<HTMLFormElement>("#pat-form");

  signInGithub?.addEventListener("click", () => {
    void runSignInWithGithub();
  });
  signOut?.addEventListener("click", () => {
    void runSignOut();
  });
  patForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSignInWithPat();
  });

  void refreshAuthState();
});

async function refreshAuthState() {
  const el = document.querySelector("#auth-state");
  if (!el) return;

  try {
    const state = await invoke<AuthStateDto>("auth_state");
    applyAuthUi(state);
    clearStatus();
  } catch (error) {
    el.textContent = "unavailable";
    showStatus(String(error));
  }
}

function applyAuthUi(state: AuthStateDto) {
  const el = document.querySelector("#auth-state");
  const signedOut = document.querySelector<HTMLElement>("#signed-out-actions");
  const signedIn = document.querySelector<HTMLElement>("#signed-in-actions");
  const captureGate = document.querySelector("#capture-gate");
  const inboxGate = document.querySelector("#inbox-gate");
  const captureSection = document.querySelector("#capture-section");
  const inboxSection = document.querySelector("#inbox-section");

  const isSignedIn = state === "signed_in";

  if (el) {
    el.textContent = isSignedIn ? "Signed in" : "Signed out";
  }
  if (signedOut) signedOut.hidden = isSignedIn;
  if (signedIn) signedIn.hidden = !isSignedIn;

  if (captureGate) {
    captureGate.textContent = isSignedIn
      ? "Capture is ready once Drafts land."
      : "Sign in to use Capture.";
  }
  if (inboxGate) {
    inboxGate.textContent = isSignedIn
      ? "Inbox is ready once Drafts land."
      : "Sign in to use the Inbox.";
  }
  captureSection?.classList.toggle("unavailable", !isSignedIn);
  inboxSection?.classList.toggle("unavailable", !isSignedIn);
}

async function runSignInWithGithub() {
  setBusy(true);
  try {
    const state = await invoke<AuthStateDto>("sign_in_with_github");
    applyAuthUi(state);
    clearStatus();
  } catch (error) {
    showStatus(String(error));
    await refreshAuthState();
  } finally {
    setBusy(false);
  }
}

async function runSignInWithPat() {
  const input = document.querySelector<HTMLInputElement>("#pat-input");
  const token = input?.value.trim() ?? "";
  if (!token) {
    showStatus("Enter a personal access token.");
    return;
  }

  setBusy(true);
  try {
    const state = await invoke<AuthStateDto>("sign_in_with_pat", {
      input: { token },
    });
    if (input) input.value = "";
    applyAuthUi(state);
    clearStatus();
  } catch (error) {
    showStatus(String(error));
    await refreshAuthState();
  } finally {
    setBusy(false);
  }
}

async function runSignOut() {
  setBusy(true);
  try {
    const state = await invoke<AuthStateDto>("sign_out");
    applyAuthUi(state);
    clearStatus();
  } catch (error) {
    showStatus(String(error));
    await refreshAuthState();
  } finally {
    setBusy(false);
  }
}

function setBusy(busy: boolean) {
  for (const id of ["sign-in-github", "sign-out"]) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.disabled = busy;
  }
  const patSubmit = document.querySelector<HTMLButtonElement>("#pat-form button");
  if (patSubmit) patSubmit.disabled = busy;
}

function showStatus(message: string) {
  const status = document.querySelector<HTMLElement>("#status");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
}

function clearStatus() {
  const status = document.querySelector<HTMLElement>("#status");
  if (!status) return;
  status.hidden = true;
  status.textContent = "";
}
