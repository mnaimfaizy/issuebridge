import { useEffect, useState } from "react";
import {
  Body1,
  Caption1,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import type { AccountAuth } from "../shell/Sidebar";
import {
  isTestingSetEditable,
  testingSetHelper,
} from "./gating";

type RepoIdDto = { owner: string; name: string };

type TestingSetSectionProps = {
  auth: AccountAuth;
  firstRunComplete: boolean;
};

function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}

function formatInvokeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Settings → Testing set: edit ≤3 App-visible repos (same rules as first-run). */
export function TestingSetSection({
  auth,
  firstRunComplete,
}: TestingSetSectionProps) {
  const editable = isTestingSetEditable(auth, firstRunComplete);
  const helper = testingSetHelper(auth, firstRunComplete);
  const [visibleRepos, setVisibleRepos] = useState<RepoIdDto[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<RepoIdDto[]>([]);
  const [filter, setFilter] = useState("");
  const [allReposWarning, setAllReposWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editable) {
      setVisibleRepos([]);
      setSelectedRepos([]);
      setAllReposWarning(false);
      setError(null);
      return;
    }
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
  }, [editable]);

  const selectedKeys = new Set(selectedRepos.map(repoKey));
  const filterLower = filter.trim().toLowerCase();
  const candidates = visibleRepos.filter((repo) => {
    const label = `${repo.owner}/${repo.name}`;
    if (selectedKeys.has(repoKey(repo))) return false;
    if (filterLower && !label.toLowerCase().includes(filterLower)) return false;
    return true;
  });

  async function addRepo(repo: RepoIdDto) {
    if (!editable || selectedRepos.length >= 3) {
      if (selectedRepos.length >= 3) {
        setError("You can pick up to 3 repositories.");
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
          Pick up to 3 App-visible repos. These become fast chips in the Capture
          popup.
        </Body1>
      )}

      {allReposWarning && editable ? (
        <MessageBar intent="info">
          <MessageBarBody>
            You chose All repositories. That&apos;s allowed — you can narrow
            this to selected repos on GitHub later.
          </MessageBarBody>
        </MessageBar>
      ) : null}
      {error && editable ? (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
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
          <li className="ib-repo-empty">Repository search unlocks when ready.</li>
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
      <div className="ib-testing-chips" aria-label="Testing set">
        {editable
          ? selectedRepos.map((repo) => {
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
          : (
            <Caption1 className="ib-settings-helper">
              Selected repos appear as chips here.
            </Caption1>
          )}
      </div>
    </section>
  );
}
