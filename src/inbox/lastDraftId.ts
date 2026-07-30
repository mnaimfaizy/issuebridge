/** localStorage key for the last selected Inbox Draft id. */
export const LAST_DRAFT_STORAGE_KEY = "issuebridge.lastInboxDraftId";

export function readLastDraftId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_DRAFT_STORAGE_KEY);
    return raw?.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function writeLastDraftId(id: string | null): void {
  try {
    if (!id) {
      localStorage.removeItem(LAST_DRAFT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LAST_DRAFT_STORAGE_KEY, id);
  } catch {
    // Ignore storage failures; selection still works in-memory.
  }
}
