import {
  Body1,
  Button,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { FirstRunStep } from "../settings/gating";
import {
  type AuthStateDto,
  dispatchAppState,
  formatInvokeError,
  type RepoIdDto,
  repoKey,
} from "./types";

type TestingSetStepProps = {
  onAdvanced: (auth: AuthStateDto, step: FirstRunStep) => void;
};

export function TestingSetStep({ onAdvanced }: TestingSetStepProps) {
  const [visibleRepos, setVisibleRepos] = useState<RepoIdDto[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<RepoIdDto[]>([]);
  const [filter, setFilter] = useState("");
  const [allReposWarning, setAllReposWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [visible, selected, warn] = await Promise.all([
          invoke<RepoIdDto[]>("app_visible_repos"),
          invoke<RepoIdDto[]>("testing_set"),
          invoke<boolean>("all_repositories_warning"),
        ]);
        if (cancelled) return;
        setVisibleRepos(visible);
        setSelectedRepos(selected);
        setAllReposWarning(warn);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(formatInvokeError(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedKeys = new Set(selectedRepos.map(repoKey));
  const filterLower = filter.trim().toLowerCase();
  const candidates = visibleRepos.filter((repo) => {
    const label = `${repo.owner}/${repo.name}`;
    if (selectedKeys.has(repoKey(repo))) return false;
    if (filterLower && !label.toLowerCase().includes(filterLower)) return false;
    return true;
  });

  async function addRepo(repo: RepoIdDto) {
    if (selectedRepos.length >= 3) {
      setError("You can pick up to 3 repositories.");
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

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await invoke<FirstRunStep>("complete_testing_set");
      const [auth, step] = await Promise.all([
        invoke<AuthStateDto>("auth_state"),
        invoke<FirstRunStep>("first_run_step"),
      ]);
      dispatchAppState(auth, step);
      onAdvanced(auth, step);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ib-firstrun-step">
      <Subtitle2 as="h1">Testing set</Subtitle2>
      <Body1>
        Pick 1–3 App-visible repos. These become fast chips when you capture.
      </Body1>
      {allReposWarning ? (
        <MessageBar intent="info" aria-live="polite">
          <MessageBarBody className="ib-message-copy">
            You chose All repositories. That&apos;s allowed — you can narrow
            this to selected repos on GitHub later.
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {error ? (
        <MessageBar intent="error" aria-live="polite">
          <MessageBarBody className="ib-message-copy">{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <Label weight="semibold" htmlFor="firstrun-repo-filter">
        Search repositories
      </Label>
      <Input
        id="firstrun-repo-filter"
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="owner/name"
        value={filter}
        disabled={busy}
        onChange={(_, data) => setFilter(data.value)}
      />
      <ul className="ib-repo-results" aria-label="App-visible repositories">
        {candidates.length === 0 ? (
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
                  disabled={busy || selectedRepos.length >= 3}
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
        {selectedRepos.map((repo) => {
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
        })}
      </div>
      <div className="ib-firstrun-actions">
        <Button
          appearance="primary"
          disabled={busy || selectedRepos.length < 1}
          onClick={() => void complete()}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
