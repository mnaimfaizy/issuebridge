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

type InboxItemDto = {
  id: string;
  display_title: string;
  owner: string;
  name: string;
  linked: boolean;
  dirty: boolean;
};

type DraftDto = {
  id: string;
  owner: string;
  name: string;
  title: string;
  body: string;
  label_names: string[];
  linked: boolean;
  dirty: boolean;
  issue_number: number | null;
  html_url: string | null;
};

type UpdateLinkedOutcomeDto =
  | { kind: "updated"; draft: DraftDto }
  | { kind: "conflict"; html_url: string | null; issue_number: number | null };

let visibleRepos: RepoIdDto[] = [];
let selectedRepos: RepoIdDto[] = [];
let selectedDraftId: string | null = null;

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
  for (const id of ["open-capture", "empty-capture"]) {
    document
      .querySelector(`#${id}`)
      ?.addEventListener("click", () => void runOpenCapture());
  }
  document
    .querySelector("#save-draft")
    ?.addEventListener("click", () => void runSaveDraft());
  document
    .querySelector("#publish-draft")
    ?.addEventListener("click", () => void runPublishDraft());
  document
    .querySelector("#update-draft")
    ?.addEventListener("click", () => void runUpdateDraft());
  document
    .querySelector("#conflict-keep-mine")
    ?.addEventListener("click", () => void runKeepMine());
  document
    .querySelector("#conflict-use-theirs")
    ?.addEventListener("click", () => void runUseTheirs());
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

  window.addEventListener("focus", () => {
    void refreshInboxIfReady();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void refreshInboxIfReady();
    }
  });
  void listen("inbox-changed", () => {
    // Save during Try capture completes first-run → refresh step into Inbox.
    void refreshAppState();
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
  const editor = document.querySelector<HTMLElement>("#draft-editor");
  if (!empty || !list) return;

  list.replaceChildren();

  if (items.length === 0) {
    empty.hidden = false;
    if (openCapture) openCapture.hidden = true;
    selectedDraftId = null;
    if (editor) editor.hidden = true;
    return;
  }

  empty.hidden = true;
  if (openCapture) openCapture.hidden = false;

  if (
    selectedDraftId &&
    !items.some((item) => item.id === selectedDraftId)
  ) {
    selectedDraftId = null;
    if (editor) editor.hidden = true;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "inbox-row";
    if (item.id === selectedDraftId) {
      li.classList.add("selected");
    }
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.addEventListener("click", () => void openDraftEditor(item.id));
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void openDraftEditor(item.id);
      }
    });

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

async function openDraftEditor(id: string) {
  try {
    const draft = await invoke<DraftDto>("get_draft", { id });
    selectedDraftId = draft.id;
    fillEditor(draft);
    await loadInbox();
    clearStatus();
  } catch (error) {
    showStatus(String(error));
  }
}

function fillEditor(draft: DraftDto) {
  const editor = document.querySelector<HTMLElement>("#draft-editor");
  const repo = document.querySelector("#editor-repo");
  const cues = document.querySelector("#editor-cues");
  const title = document.querySelector<HTMLInputElement>("#editor-title");
  const body = document.querySelector<HTMLTextAreaElement>("#editor-body");
  const labels = document.querySelector<HTMLInputElement>("#editor-labels");
  const link = document.querySelector<HTMLElement>("#editor-link");
  const publish = document.querySelector<HTMLButtonElement>("#publish-draft");
  const update = document.querySelector<HTMLButtonElement>("#update-draft");
  if (!editor || !title || !body || !labels) return;

  editor.hidden = false;
  if (repo) repo.textContent = `${draft.owner}/${draft.name}`;
  if (cues) {
    const linkCue = draft.linked ? "linked" : "unlinked";
    const dirtyCue = draft.dirty ? "dirty" : "clean";
    cues.textContent = `${linkCue} · ${dirtyCue}`;
  }
  title.value = draft.title;
  body.value = draft.body;
  labels.value = draft.label_names.join(", ");
  if (publish) publish.hidden = draft.linked;
  if (update) update.hidden = !draft.linked;
  if (link) {
    if (draft.html_url && draft.issue_number != null) {
      link.hidden = false;
      link.innerHTML = "";
      const anchor = document.createElement("a");
      anchor.href = draft.html_url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = `GitHub #${draft.issue_number}`;
      link.append(anchor);
    } else {
      link.hidden = true;
      link.textContent = "";
    }
  }
}

function readEditorForm(): {
  title: string;
  body: string;
  label_names: string[];
} {
  const title =
    document.querySelector<HTMLInputElement>("#editor-title")?.value ?? "";
  const body =
    document.querySelector<HTMLTextAreaElement>("#editor-body")?.value ?? "";
  const labels = document.querySelector<HTMLInputElement>("#editor-labels");
  const label_names = (labels?.value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { title, body, label_names };
}

async function runSaveDraft() {
  if (!selectedDraftId) return;
  const form = readEditorForm();
  setBusy(true);
  try {
    const draft = await invoke<DraftDto>("edit_draft", {
      input: {
        id: selectedDraftId,
        ...form,
      },
    });
    fillEditor(draft);
    await loadInbox();
    clearStatus();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function runPublishDraft() {
  if (!selectedDraftId) return;
  const form = readEditorForm();
  setBusy(true);
  try {
    await invoke<DraftDto>("edit_draft", {
      input: {
        id: selectedDraftId,
        ...form,
      },
    });
    const draft = await invoke<DraftDto>("publish_draft", {
      id: selectedDraftId,
    });
    fillEditor(draft);
    await loadInbox();
    clearStatus();
  } catch (error) {
    showStatus(String(error));
    await loadInbox();
  } finally {
    setBusy(false);
  }
}

async function runUpdateDraft() {
  if (!selectedDraftId) return;
  const form = readEditorForm();
  setBusy(true);
  try {
    await invoke<DraftDto>("edit_draft", {
      input: {
        id: selectedDraftId,
        ...form,
      },
    });
    const outcome = await invoke<UpdateLinkedOutcomeDto>("update_linked_draft", {
      id: selectedDraftId,
    });
    if (outcome.kind === "conflict") {
      openConflictModal(outcome.html_url);
      return;
    }
    fillEditor(outcome.draft);
    await loadInbox();
    clearStatus();
  } catch (error) {
    showStatus(String(error));
    await loadInbox();
  } finally {
    setBusy(false);
  }
}

function setBackgroundInert(inert: boolean) {
  for (const selector of ["#sign-in", "#install-app", "#testing-set", "#ready", "#status"]) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.inert = inert;
  }
}

function openConflictModal(htmlUrl: string | null) {
  const modal = document.querySelector<HTMLElement>("#conflict-modal");
  const view = document.querySelector<HTMLAnchorElement>("#conflict-view-github");
  if (!modal) return;
  if (view) {
    if (htmlUrl) {
      view.href = htmlUrl;
      view.hidden = false;
    } else {
      view.removeAttribute("href");
      view.hidden = true;
    }
  }
  setBackgroundInert(true);
  modal.hidden = false;
  document
    .querySelector<HTMLButtonElement>("#conflict-keep-mine")
    ?.focus();
}

function closeConflictModal() {
  const modal = document.querySelector<HTMLElement>("#conflict-modal");
  if (modal) modal.hidden = true;
  setBackgroundInert(false);
}

async function runKeepMine() {
  if (!selectedDraftId) return;
  setBusy(true);
  try {
    const draft = await invoke<DraftDto>("keep_mine", { id: selectedDraftId });
    closeConflictModal();
    fillEditor(draft);
    await loadInbox();
    clearStatus();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function runUseTheirs() {
  if (!selectedDraftId) return;
  setBusy(true);
  try {
    const draft = await invoke<DraftDto>("use_theirs", { id: selectedDraftId });
    closeConflictModal();
    fillEditor(draft);
    await loadInbox();
    clearStatus();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
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
    "open-capture",
    "empty-capture",
    "save-draft",
    "publish-draft",
    "update-draft",
    "conflict-keep-mine",
    "conflict-use-theirs",
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
