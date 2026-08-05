import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { AccountAuth } from "../shell/Sidebar";
import { isTestingSetEditable, testingSetHelper } from "./gating";

type RepoIdDto = { owner: string; name: string };

type TestingSetSectionProps = {
  auth: AccountAuth;
  firstRunComplete: boolean;
};

type PendingConfirm =
  | { kind: "max"; value: number }
  | { kind: "add_all" }
  | null;

const RECOMMENDED_MAX = 3;

function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}

function formatInvokeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function crossesRecommended(fromMax: number, toMax: number): boolean {
  return fromMax <= RECOMMENDED_MAX && toMax > RECOMMENDED_MAX;
}

/** Settings → Testing set: edit App-visible repos; max configurable after first-run. */
export function TestingSetSection({
  auth,
  firstRunComplete,
}: TestingSetSectionProps) {
  const editable = isTestingSetEditable(auth, firstRunComplete);
  const helper = testingSetHelper(auth, firstRunComplete);
  const [visibleRepos, setVisibleRepos] = useState<RepoIdDto[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<RepoIdDto[]>([]);
  const [maxSlots, setMaxSlots] = useState(RECOMMENDED_MAX);
  const [maxDraft, setMaxDraft] = useState(String(RECOMMENDED_MAX));
  const [filter, setFilter] = useState("");
  const [allReposWarning, setAllReposWarning] = useState(false);
  const [reconcileNote, setReconcileNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  useEffect(() => {
    if (!editable) {
      setVisibleRepos([]);
      setSelectedRepos([]);
      setMaxSlots(RECOMMENDED_MAX);
      setMaxDraft(String(RECOMMENDED_MAX));
      setAllReposWarning(false);
      setReconcileNote(null);
      setError(null);
      setPendingConfirm(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const changed = await invoke<boolean>(
          "reconcile_testing_set_with_app_visible",
        );
        const [visible, selected, max, warn] = await Promise.all([
          invoke<RepoIdDto[]>("app_visible_repos"),
          invoke<RepoIdDto[]>("testing_set"),
          invoke<number>("testing_set_max"),
          invoke<boolean>("all_repositories_warning"),
        ]);
        if (cancelled) return;
        setVisibleRepos(visible);
        setSelectedRepos(selected);
        setMaxSlots(max);
        setMaxDraft(String(max));
        setAllReposWarning(warn);
        setReconcileNote(
          changed
            ? "App-visible repos changed. Testing set and max were updated to match."
            : null,
        );
        setError(null);
      } catch (err) {
        if (!cancelled) setError(formatInvokeError(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [editable]);

  const ceiling = visibleRepos.length;
  const selectedKeys = new Set(selectedRepos.map(repoKey));
  const filterLower = filter.trim().toLowerCase();
  const candidates = visibleRepos.filter((repo) => {
    const label = `${repo.owner}/${repo.name}`;
    if (selectedKeys.has(repoKey(repo))) return false;
    if (filterLower && !label.toLowerCase().includes(filterLower)) return false;
    return true;
  });

  async function refreshAfterMutation() {
    const [visible, selected, max] = await Promise.all([
      invoke<RepoIdDto[]>("app_visible_repos"),
      invoke<RepoIdDto[]>("testing_set"),
      invoke<number>("testing_set_max"),
    ]);
    setVisibleRepos(visible);
    setSelectedRepos(selected);
    setMaxSlots(max);
    setMaxDraft(String(max));
  }

  async function commitMax(nextMax: number) {
    setBusy(true);
    try {
      const saved = await invoke<number>("set_testing_set_max", {
        max: nextMax,
      });
      setMaxSlots(saved);
      setMaxDraft(String(saved));
      setError(null);
      setPendingConfirm(null);
    } catch (err) {
      setError(formatInvokeError(err));
      setPendingConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  async function commitAddAll() {
    setBusy(true);
    try {
      await invoke<RepoIdDto[]>("add_all_app_visible_to_testing_set");
      await refreshAfterMutation();
      setError(null);
      setPendingConfirm(null);
    } catch (err) {
      setError(formatInvokeError(err));
      setPendingConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  function requestMaxApply() {
    if (!editable || ceiling < 1) return;
    const parsed = Number.parseInt(maxDraft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setError("Enter a whole number for the Testing set max.");
      return;
    }
    const nextMax = Math.min(Math.max(parsed, 1), ceiling);
    setMaxDraft(String(nextMax));
    if (nextMax === maxSlots) {
      setError(null);
      return;
    }
    if (crossesRecommended(maxSlots, nextMax)) {
      setPendingConfirm({ kind: "max", value: nextMax });
      return;
    }
    void commitMax(nextMax);
  }

  function requestAddAll() {
    if (!editable || ceiling < 1) return;
    if (crossesRecommended(maxSlots, ceiling)) {
      setPendingConfirm({ kind: "add_all" });
      return;
    }
    void commitAddAll();
  }

  async function addRepo(repo: RepoIdDto) {
    if (!editable || selectedRepos.length >= maxSlots) {
      if (selectedRepos.length >= maxSlots) {
        setError(`You can pick up to ${maxSlots} repositories.`);
      }
      return;
    }
    setBusy(true);
    try {
      const next = await invoke<RepoIdDto[]>("add_testing_set_repo", { repo });
      setSelectedRepos(next);
      setError(null);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeRepo(repo: RepoIdDto) {
    if (!editable) return;
    setBusy(true);
    try {
      const next = await invoke<RepoIdDto[]>("remove_testing_set_repo", {
        repo,
      });
      setSelectedRepos(next);
      setError(null);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`ib-settings-block${editable ? "" : " ib-settings-block--gated"}`}
      aria-labelledby="testing-set-settings-heading"
      aria-disabled={!editable}
    >
      <Subtitle2 as="h2" id="testing-set-settings-heading">
        Testing set
      </Subtitle2>
      {helper ? (
        <Caption1 className="ib-settings-helper">{helper}</Caption1>
      ) : (
        <Body1>
          Choose App-visible repos for Capture chips. Recommended maximum is{" "}
          {RECOMMENDED_MAX}; you can raise it here if you need more.
        </Body1>
      )}

      {editable ? (
        <MessageBar intent="info">
          <MessageBarBody className="ib-message-copy">
            Max {RECOMMENDED_MAX} is the approved approach. Raising it means
            more context switching while capturing.
          </MessageBarBody>
        </MessageBar>
      ) : null}

      {allReposWarning && editable ? (
        <MessageBar intent="info">
          <MessageBarBody className="ib-message-copy">
            You chose All repositories. That&apos;s allowed — you can narrow
            this to selected repos on GitHub later.
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {reconcileNote && editable ? (
        <MessageBar intent="warning">
          <MessageBarBody className="ib-message-copy">
            {reconcileNote}
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {error && editable ? (
        <MessageBar intent="error">
          <MessageBarBody className="ib-message-copy">{error}</MessageBarBody>
        </MessageBar>
      ) : null}

      {editable ? (
        <div className="ib-testing-max-row">
          <Label weight="semibold" htmlFor="settings-testing-set-max">
            Maximum repositories
          </Label>
          <div className="ib-testing-max-controls">
            <Input
              id="settings-testing-set-max"
              type="number"
              min={1}
              max={Math.max(ceiling, 1)}
              value={maxDraft}
              disabled={busy || ceiling < 1}
              onChange={(_, data) => setMaxDraft(data.value)}
            />
            <Button
              appearance="secondary"
              disabled={busy || ceiling < 1}
              onClick={() => requestMaxApply()}
            >
              Apply max
            </Button>
            <Button
              appearance="secondary"
              disabled={busy || ceiling < 1}
              onClick={() => requestAddAll()}
            >
              Add all App-visible
            </Button>
          </div>
          <Caption1 className="ib-settings-helper">
            Ceiling is {ceiling} App-visible{" "}
            {ceiling === 1 ? "repository" : "repositories"} (currently{" "}
            {selectedRepos.length} in the Testing set).
          </Caption1>
        </div>
      ) : null}

      <Label weight="semibold" htmlFor="settings-repo-filter">
        Search repositories
      </Label>
      <Input
        id="settings-repo-filter"
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="owner/name"
        value={filter}
        disabled={!editable || busy}
        onChange={(_, data) => setFilter(data.value)}
      />
      <ul className="ib-repo-results" aria-label="App-visible repositories">
        {!editable ? (
          <li className="ib-repo-empty">
            Repository search unlocks when ready.
          </li>
        ) : candidates.length === 0 ? (
          <li className="ib-repo-empty">
            {filterLower
              ? "No matching App-visible repositories."
              : "No more App-visible repositories to add."}
          </li>
        ) : (
          candidates.map((repo) => {
            const label = `${repo.owner}/${repo.name}`;
            return (
              <li key={label}>
                <button
                  type="button"
                  className="ib-repo-pick"
                  disabled={busy || selectedRepos.length >= maxSlots}
                  onClick={() => void addRepo(repo)}
                >
                  {label}
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div className="ib-testing-chips" role="group" aria-label="Testing set">
        {editable ? (
          selectedRepos.map((repo) => {
            const label = `${repo.owner}/${repo.name}`;
            return (
              <button
                key={label}
                type="button"
                className="ib-chip"
                title="Remove from Testing set"
                disabled={busy}
                onClick={() => void removeRepo(repo)}
              >
                {label} ×
              </button>
            );
          })
        ) : (
          <Caption1 className="ib-settings-helper">
            Selected repos appear as chips here.
          </Caption1>
        )}
      </div>

      <Dialog
        open={pendingConfirm !== null}
        onOpenChange={(_, data) => {
          if (!data.open && !busy && data.type === "triggerClick")
            setPendingConfirm(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              Raise Testing set above {RECOMMENDED_MAX}?
            </DialogTitle>
            <DialogContent>
              Max {RECOMMENDED_MAX} is the approved approach. Going higher means
              more context switching while capturing. Continue anyway?
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                disabled={busy}
                onClick={() => setPendingConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                disabled={busy}
                onClick={() => {
                  if (pendingConfirm?.kind === "max") {
                    void commitMax(pendingConfirm.value);
                  } else if (pendingConfirm?.kind === "add_all") {
                    void commitAddAll();
                  }
                }}
              >
                Continue
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}
