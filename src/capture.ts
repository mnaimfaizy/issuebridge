import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type RepoIdDto = { owner: string; name: string };

let testingSet: RepoIdDto[] = [];
let visibleRepos: RepoIdDto[] = [];
let selectedRepo: RepoIdDto | null = null;

window.addEventListener("DOMContentLoaded", () => {
  document
    .querySelector("#capture-save")
    ?.addEventListener("click", () => void saveDraft());
  document
    .querySelector("#capture-cancel")
    ?.addEventListener("click", () => void closeCapture());
  document
    .querySelector("#capture-repo")
    ?.addEventListener("input", () => {
      const input = document.querySelector<HTMLInputElement>("#capture-repo");
      const value = input?.value.trim() ?? "";
      const parsed = parseRepo(value);
      if (parsed) selectedRepo = parsed;
      renderTypeahead();
    });

  window.addEventListener("focus", () => {
    void bootstrap();
  });

  void bootstrap();
});

async function bootstrap() {
  try {
    testingSet = await invoke<RepoIdDto[]>("testing_set");
    visibleRepos = await invoke<RepoIdDto[]>("app_visible_repos");
    const last = await invoke<RepoIdDto | null>("last_used_repo");

    selectedRepo = last ?? testingSet[0] ?? null;

    const title = document.querySelector<HTMLInputElement>("#capture-title");
    const body = document.querySelector<HTMLTextAreaElement>("#capture-body");
    if (title) title.value = "";
    if (body) body.value = "";

    syncRepoInput();
    renderChips();
    renderTypeahead();
    clearStatus();
    title?.focus();
  } catch (error) {
    showStatus(String(error));
  }
}

function renderChips() {
  const chips = document.querySelector("#capture-chips");
  if (!chips) return;
  chips.replaceChildren();

  for (const repo of testingSet) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    if (selectedRepo && repoKey(repo) === repoKey(selectedRepo)) {
      chip.classList.add("chip-selected");
    }
    chip.textContent = `${repo.owner}/${repo.name}`;
    chip.addEventListener("click", () => {
      selectedRepo = repo;
      syncRepoInput();
      renderChips();
      renderTypeahead();
    });
    chips.appendChild(chip);
  }
}

function renderTypeahead() {
  const list = document.querySelector<HTMLElement>("#capture-repo-results");
  const filter =
    document.querySelector<HTMLInputElement>("#capture-repo")?.value.trim().toLowerCase() ??
    "";
  if (!list) return;

  list.replaceChildren();

  const beyondSet = visibleRepos.filter(
    (repo) => !testingSet.some((t) => repoKey(t) === repoKey(repo)),
  );

  const matches = beyondSet.filter((repo) => {
    const label = `${repo.owner}/${repo.name}`.toLowerCase();
    return !filter || label.includes(filter);
  });

  if (!filter || matches.length === 0) {
    list.hidden = true;
    return;
  }

  list.hidden = false;
  for (const repo of matches.slice(0, 8)) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "repo-pick";
    button.textContent = `${repo.owner}/${repo.name}`;
    button.addEventListener("click", () => {
      selectedRepo = repo;
      syncRepoInput();
      renderChips();
      list.hidden = true;
    });
    li.appendChild(button);
    list.appendChild(li);
  }
}

async function saveDraft() {
  if (!selectedRepo) {
    showStatus("Pick a repository.");
    return;
  }

  const title =
    document.querySelector<HTMLInputElement>("#capture-title")?.value ?? "";
  const body =
    document.querySelector<HTMLTextAreaElement>("#capture-body")?.value ?? "";

  setBusy(true);
  try {
    await invoke("save_capture", {
      input: {
        owner: selectedRepo.owner,
        name: selectedRepo.name,
        title,
        body,
      },
    });
    clearStatus();
    await closeCapture();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function closeCapture() {
  try {
    await getCurrentWindow().hide();
  } catch {
    // Ignore hide failures in non-Tauri preview.
  }
}

function syncRepoInput() {
  const input = document.querySelector<HTMLInputElement>("#capture-repo");
  if (!input || !selectedRepo) return;
  input.value = `${selectedRepo.owner}/${selectedRepo.name}`;
}

function parseRepo(value: string): RepoIdDto | null {
  const parts = value.split("/");
  if (parts.length !== 2) return null;
  const owner = parts[0]?.trim() ?? "";
  const name = parts[1]?.trim() ?? "";
  if (!owner || !name) return null;
  return { owner, name };
}

function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`;
}

function setBusy(busy: boolean) {
  for (const id of ["capture-save", "capture-cancel"]) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.disabled = busy;
  }
}

function showStatus(message: string) {
  const status = document.querySelector<HTMLElement>("#capture-status");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
}

function clearStatus() {
  const status = document.querySelector<HTMLElement>("#capture-status");
  if (!status) return;
  status.hidden = true;
  status.textContent = "";
}
