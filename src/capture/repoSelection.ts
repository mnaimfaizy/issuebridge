/**
 * Repository selection rules for the Capture popup.
 *
 * The Capture window is long-lived (shown/hidden, never recreated), so these
 * rules have to distinguish "a fresh Capture session started" from "the window
 * regained focus". Keeping them here makes the invariant one named thing.
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
 * The repo a Capture session targets.
 *
 * An existing pick always wins: a window refocus must never silently retarget
 * the Draft the user is composing (#197). Only an empty selection falls back to
 * the default — `last_used_repo`, else the first Testing-set chip.
 */
export function resolveSelectedRepo(
  current: RepoIdDto | null,
  lastUsed: RepoIdDto | null,
  testingSet: RepoIdDto[],
): RepoIdDto | null {
  if (current) return current;
  return lastUsed ?? testingSet[0] ?? null;
}
