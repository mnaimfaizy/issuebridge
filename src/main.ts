import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type AuthStateDto = "signed_out" | "signed_in";
type FirstRunStepDto = "sign_in" | "install_app" | "testing_set" | "ready";

type InstallContinueOutcomeDto =
  | { kind: "no_install" }
  | { kind: "zero_repos" }
  | { kind: "ready"; all_repositories_warning: boolean };

type RepoIdDto = { owner: string; name: string };

type InboxItemDto = {
  id: string;
  display_title: string;
  owner: string;
  name: string;
  linked: boolean;
  dirty: boolean;
};

let visibleRepos: RepoIdDto[] = [];
let selectedRepos: RepoIdDto[] = [];

window.addEventListener("DOMContentLoaded", () => {
  document
    .querySelector("#sign-in-github")
    ?.addEventListener("click", () => void runSignInWithGithub());
  document
    .querySelector("#pat-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      void runSignInWithPat();
    });
  for (const id of ["sign-out", "sign-out-install", "sign-out-testing"]) {
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
    .querySelector("#repo-filter")
    ?.addEventListener("input", () => renderRepoResults());
  for (const id of ["open-capture", "empty-capture"]) {
    document
      .querySelector(`#${id}`)
      ?.addEventListener("click", () => void runOpenCapture());
  }

  window.addEventListener("focus", () => {
    void refreshInboxIfReady();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshInboxIfReady();
    }
  });
  void listen("inbox-changed", () => {
    void refreshInboxIfReady();
  });

  void refreshAppState();
});

async function refreshInboxIfReady() {
  try {
    const step = await invoke<FirstRunStepDto>("first_run_step");
    if (step === "ready") {
      await loadInbox();
    }
  } catch {
    // Ignore refresh races while signed out / mid-transition.
  }
}

async function refreshAppState() {
  try {
    const [auth, step] = await Promise.all([
      invoke<AuthStateDto>("auth_state"),
      invoke<FirstRunStepDto>("first_run_step"),
    ]);
    applyStepUi(auth, step);
    clearStatus();
  } catch (error) {
    const el = document.querySelector("#auth-state");
    if (el) el.textContent = "unavailable";
    showStatus(String(error));
  }
}

async function applyStepUi(auth: AuthStateDto, step: FirstRunStepDto) {
  const signIn = document.querySelector<HTMLElement>("#sign-in-step");
  const install = document.querySelector<HTMLElement>("#install-step");
  const testing = document.querySelector<HTMLElement>("#testing-set-step");
  const ready = document.querySelector<HTMLElement>("#ready-home");
  const signedOut = document.querySelector<HTMLElement>("#signed-out-actions");
  const authEl = document.querySelector("#auth-state");

  if (signIn) signIn.hidden = step !== "sign_in";
  if (install) install.hidden = step !== "install_app";
  if (testing) testing.hidden = step !== "testing_set";
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
  if (step === "ready") {
    await loadInbox();
  }
}

async function loadInbox() {
  try {
    const items = await invoke<InboxItemDto[]>("list_inbox");
    renderInbox(items);
  } catch (error) {
    showStatus(String(error));
  }
}

function renderInbox(items: InboxItemDto[]) {
  const empty = document.querySelector<HTMLElement>("#inbox-empty");
  const list = document.querySelector("#inbox-list");
  const openCapture = document.querySelector<HTMLElement>("#open-capture");
  if (!empty || !list) return;

  list.replaceChildren();

  if (items.length === 0) {
    empty.hidden = false;
    if (openCapture) openCapture.hidden = true;
    return;
  }

  empty.hidden = true;
  if (openCapture) openCapture.hidden = false;

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "inbox-row";

    const title = document.createElement("div");
    title.className = "inbox-row-title";
    title.textContent = item.display_title;

    const meta = document.createElement("div");
    meta.className = "inbox-row-meta";
    const linkCue = item.linked ? "linked" : "unlinked";
    const dirtyCue = item.dirty ? "dirty" : "clean";
    meta.textContent = `${item.owner}/${item.name} · ${linkCue} · ${dirtyCue}`;

    li.appendChild(title);
    li.appendChild(meta);
    list.appendChild(li);
  }
}

async function runOpenCapture() {
  try {
    await invoke("show_capture");
    clearStatus();
  } catch (error) {
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
    showStatus(String(error));
    await refreshAppState();
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
    await invoke<AuthStateDto>("sign_in_with_pat", {
      input: { token },
    });
    if (input) input.value = "";
    await refreshAppState();
  } catch (error) {
    showStatus(String(error));
    await refreshAppState();
  } finally {
    setBusy(false);
  }
}

async function runSignOut() {
  setBusy(true);
  try {
    await invoke<AuthStateDto>("sign_out");
    await refreshAppState();
  } catch (error) {
    showStatus(String(error));
    await refreshAppState();
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
    showStatus(String(error));
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
    "open-install",
    "continue-install",
    "complete-testing-set",
    "open-capture",
    "empty-capture",
  ];
  for (const id of ids) {
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
