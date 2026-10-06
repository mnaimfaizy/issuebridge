/**
 * Repository selection rules for the Capture popup.
 *
 * The Capture window is long-lived (shown/hidden, never recreated), so these
 * rules have to distinguish "a new Capture began" from "the window regained
 * focus". Only a new Capture picks the default repo; a refocus never changes
 * the repo a Draft is being captured for (#197).
 *
 * Capture-local: `repoKey` here compares as typed, unlike the case-folding
 * `repoKey` in `src/firstrun/types.ts`.
 */

export type RepoIdDto = { owner: string; name: string };

export function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`;
}

export function parseRepo(value: string): RepoIdDto | null {
  const parts = value.split("/");
  if (parts.length !== 2) return null;
  const owner = parts[0]?.trim() ?? "";
  const name = parts[1]?.trim() ?? "";
  if (!owner || !name) return null;
  return { owner, name };
}

/**
 * The repo a new Capture starts on: `last_used_repo`, else the first Testing
 * set chip, else none.
 */
export function defaultRepo(
  lastUsed: RepoIdDto | null,
  testingSet: RepoIdDto[],
): RepoIdDto | null {
  return lastUsed ?? testingSet[0] ?? null;
}
