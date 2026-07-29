import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type AuthStateDto = "signed_out" | "signed_in";
type FirstRunStepDto =
  | "sign_in"
  | "install_app"
  | "testing_set"
  | "try_capture"
  | "ready";

type InstallContinueOutcomeDto =
  | { kind: "no_install" }
  | { kind: "zero_repos" }
  | { kind: "ready"; all_repositories_warning: boolean };

type RepoIdDto = { owner: string; name: string };

let visibleRepos: RepoIdDto[] = [];
let selectedRepos: RepoIdDto[] = [];

/** Bind vanilla first-run / conflict UI after the shell mounts it. */
export async function bootMainUi() {
  const bindAnchor = document.querySelector<HTMLElement>("#sign-in-github");
  if (!bindAnchor) {
    console.error("[issuebridge] legacy workspace not in DOM yet");
    return;
  }
  if (bindAnchor.dataset.ibBound === "1") {
    await refreshAppState();
    return;
  }
  bindAnchor.dataset.ibBound = "1";

  document
    .querySelector("#sign-in-github")
    ?.addEventListener("click", () => void runSignInWithGithub());
  document
    .querySelector("#pat-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      void runSignInWithPat();
    });
  for (const id of [
    "sign-out",
    "sign-out-install",
    "sign-out-testing",
    "sign-out-try-capture",
  ]) {
    document
      .querySelector(`#${id}`)
      ?.addEventListener("click", () => void runSignOut());
  }
  document
    .querySelector("#open-install")
    ?.addEventListener("click", () => void runOpenInstall());
  document
    .querySelector("#continue-install")
    ?.addEventListener("click", () => void runContinueInstall());
  document
    .querySelector("#complete-testing-set")
    ?.addEventListener("click", () => void runCompleteTestingSet());
  document
    .querySelector("#try-capture")
    ?.addEventListener("click", () => void runOpenCapture());
  document
    .querySelector("#skip-try-capture")
    ?.addEventListener("click", () => void runSkipTryCapture());
  document
    .querySelector("#repo-filter")
    ?.addEventListener("input", () => renderRepoResults());
  // Vanilla #conflict-modal remains for slice 5; Update conflicts are handled
  // by the React Inbox workbench ConflictDialog (#37).
  document.addEventListener(
    "keydown",
    (event) => {
      const modal = document.querySelector<HTMLElement>("#conflict-modal");
      if (!modal || modal.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  void listen("inbox-changed", () => {
    // Save during Try capture completes first-run → refresh step into Inbox.
    void refreshAppState();
  });

  await refreshAppState();
}

/** Re-read auth / first-run and refresh vanilla surfaces (shell account sync). */
export async function refreshMainUi() {
  await refreshAppState();
}

async function refreshAppState() {
  try {
    const auth = await invoke<AuthStateDto>("auth_state");
    const step = await invoke<FirstRunStepDto>("first_run_step");
    console.info("[issuebridge] refreshAppState", { auth, step });
    await applyStepUi(auth, step);
    clearStatus();
    window.dispatchEvent(
      new CustomEvent("issuebridge:app-state", { detail: { auth, step } }),
    );
  } catch (error) {
    console.error("[issuebridge] refreshAppState failed", error);
    const el = document.querySelector("#auth-state");
    if (el) el.textContent = "unavailable";
    showStatus(formatInvokeError(error));
  }
}

async function runSignInWithPat() {
  const input = document.querySelector<HTMLInputElement>("#pat-input");
  const token = input?.value.trim() ?? "";
  if (!token) {
    showStatus("Enter a personal access token.");
    return;
  }

  console.info("[issuebridge] PAT sign-in: start", { tokenLength: token.length });
  showStatus("Signing in…");
  setBusy(true);
  try {
    const auth = await withTimeout(
      invoke<AuthStateDto>("sign_in_with_pat", {
        input: { token },
      }),
      20_000,
      "Sign-in timed out after 20s (check the terminal for [issuebridge] logs).",
    );
    console.info("[issuebridge] PAT sign-in: ok", auth);
    if (input) input.value = "";
    const step = await invoke<FirstRunStepDto>("first_run_step");
    console.info("[issuebridge] first_run_step after PAT", step);
    await applyStepUi(auth, step);
    if (auth !== "signed_in" || step === "sign_in") {
      showStatus(
        "Credentials were accepted, but the app stayed on Sign in. Check the terminal for [issuebridge] keyring logs.",
      );
    } else {
      clearStatus();
    }
  } catch (error) {
    console.error("[issuebridge] PAT sign-in: failed", error);
    await refreshAppState();
    showStatus(formatInvokeError(error));
  } finally {
    setBusy(false);
  }
}

async function applyStepUi(auth: AuthStateDto, step: FirstRunStepDto) {
  const signIn = document.querySelector<HTMLElement>("#sign-in-step");
  const install = document.querySelector<HTMLElement>("#install-step");
  const testing = document.querySelector<HTMLElement>("#testing-set-step");
  const tryCapture = document.querySelector<HTMLElement>("#try-capture-step");
  const ready = document.querySelector<HTMLElement>("#ready-home");
  const signedOut = document.querySelector<HTMLElement>("#signed-out-actions");
  const authEl = document.querySelector("#auth-state");

  if (signIn) signIn.hidden = step !== "sign_in";
  if (install) install.hidden = step !== "install_app";
  if (testing) testing.hidden = step !== "testing_set";
  if (tryCapture) tryCapture.hidden = step !== "try_capture";
  if (ready) ready.hidden = step !== "ready";

  if (authEl) {
    authEl.textContent = auth === "signed_in" ? "Signed in" : "Signed out";
  }
  if (signedOut) signedOut.hidden = auth === "signed_in";

  if (step === "testing_set") {
    await loadTestingSetData();
  }
  if (step === "install_app") {
    clearInstallMessages();
  }
}

async function runOpenCapture() {
  try {
    console.info("[issuebridge] opening Capture window…");
    await invoke("show_capture");
    clearStatus();
  } catch (error) {
    console.error("[issuebridge] show_capture failed", error);
    showStatus(String(error));
  }
}

async function loadTestingSetData() {
  try {
    visibleRepos = await invoke<RepoIdDto[]>("app_visible_repos");
    selectedRepos = await invoke<RepoIdDto[]>("testing_set");
    const warn = await invoke<boolean>("all_repositories_warning");
    const warning = document.querySelector<HTMLElement>("#testing-warning");
    if (warning) {
      if (warn) {
        warning.hidden = false;
        warning.textContent =
          "You chose All repositories. That’s allowed — you can narrow this to selected repos on GitHub later.";
      } else {
        warning.hidden = true;
        warning.textContent = "";
      }
    }
    renderRepoResults();
    renderChips();
  } catch (error) {
    showStatus(String(error));
  }
}

function renderRepoResults() {
  const list = document.querySelector("#repo-results");
  const filter =
    document.querySelector<HTMLInputElement>("#repo-filter")?.value.trim().toLowerCase() ??
    "";
  if (!list) return;

  list.replaceChildren();
  const selectedKeys = new Set(selectedRepos.map(repoKey));

  for (const repo of visibleRepos) {
    const label = `${repo.owner}/${repo.name}`;
    if (filter && !label.toLowerCase().includes(filter)) continue;
    if (selectedKeys.has(repoKey(repo))) continue;

    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "repo-pick";
    button.textContent = label;
    button.addEventListener("click", () => void addRepo(repo));
    li.appendChild(button);
    list.appendChild(li);
  }

  if (!list.childElementCount) {
    const li = document.createElement("li");
    li.className = "empty-hint";
    li.textContent = filter
      ? "No matching App-visible repositories."
      : "No more App-visible repositories to add.";
    list.appendChild(li);
  }
}

function renderChips() {
  const chips = document.querySelector("#testing-chips");
  if (!chips) return;
  chips.replaceChildren();

  for (const repo of selectedRepos) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = `${repo.owner}/${repo.name} ×`;
    chip.title = "Remove from Testing set";
    chip.addEventListener("click", () => void removeRepo(repo));
    chips.appendChild(chip);
  }
}

async function addRepo(repo: RepoIdDto) {
  setBusy(true);
  try {
    selectedRepos = await invoke<RepoIdDto[]>("add_testing_set_repo", { repo });
    clearStatus();
    renderRepoResults();
    renderChips();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function removeRepo(repo: RepoIdDto) {
  setBusy(true);
  try {
    selectedRepos = await invoke<RepoIdDto[]>("remove_testing_set_repo", {
      repo,
    });
    clearStatus();
    renderRepoResults();
    renderChips();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function runSignInWithGithub() {
  setBusy(true);
  try {
    await invoke<AuthStateDto>("sign_in_with_github");
    await refreshAppState();
  } catch (error) {
    // Refresh first (clears status), then show the error so it is not wiped.
    await refreshAppState();
    showStatus(formatInvokeError(error));
  } finally {
    setBusy(false);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function runSignOut() {
  setBusy(true);
  try {
    await invoke<AuthStateDto>("sign_out");
    await refreshAppState();
  } catch (error) {
    await refreshAppState();
    showStatus(formatInvokeError(error));
  } finally {
    setBusy(false);
  }
}

async function runOpenInstall() {
  setBusy(true);
  try {
    await invoke("open_app_install");
    clearStatus();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function runContinueInstall() {
  setBusy(true);
  try {
    const outcome = await invoke<InstallContinueOutcomeDto>("continue_install");
    const hint = document.querySelector<HTMLElement>("#install-hint");

    if (outcome.kind === "no_install") {
      if (hint) {
        hint.hidden = false;
        hint.textContent =
          "Don’t see an install yet. Install the App on selected repositories, then Continue.";
      }
      return;
    }
    if (outcome.kind === "zero_repos") {
      if (hint) {
        hint.hidden = false;
        hint.textContent =
          "Add selected repositories on GitHub, then Continue.";
      }
      return;
    }

    // Soft All-repositories warning is shown on the Testing set step.
    await refreshAppState();
  } catch (error) {
    showStatus(formatInvokeError(error));
  } finally {
    setBusy(false);
  }
}

async function runCompleteTestingSet() {
  setBusy(true);
  try {
    await invoke<FirstRunStepDto>("complete_testing_set");
    await refreshAppState();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function runSkipTryCapture() {
  setBusy(true);
  try {
    await invoke<FirstRunStepDto>("skip_try_capture");
    await refreshAppState();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

function clearInstallMessages() {
  const hint = document.querySelector<HTMLElement>("#install-hint");
  const warning = document.querySelector<HTMLElement>("#install-warning");
  if (hint) {
    hint.hidden = true;
    hint.textContent = "";
  }
  if (warning) {
    warning.hidden = true;
    warning.textContent = "";
  }
}

function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`;
}

function setBusy(busy: boolean) {
  const ids = [
    "sign-in-github",
    "sign-out",
    "sign-out-install",
    "sign-out-testing",
    "sign-out-try-capture",
    "open-install",
    "continue-install",
    "complete-testing-set",
    "try-capture",
    "skip-try-capture",
  ];
  for (const id of ids) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.disabled = busy;
  }
  const patSubmit = document.querySelector<HTMLButtonElement>("#pat-form button");
  if (patSubmit) patSubmit.disabled = busy;
}

function formatInvokeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function showStatus(message: string) {
  for (const id of ["status", "auth-status"]) {
    const status = document.querySelector<HTMLElement>(`#${id}`);
    if (!status) continue;
    status.hidden = false;
    status.textContent = message;
  }
}

function clearStatus() {
  for (const id of ["status", "auth-status"]) {
    const status = document.querySelector<HTMLElement>(`#${id}`);
    if (!status) continue;
    status.hidden = true;
    status.textContent = "";
  }
}
