/**
 * Legacy conflict Escape blocking for slice 5.
 * First-run UI lives in React (`firstrun/`); Update conflicts use Inbox ConflictDialog.
 */
export async function bootMainUi() {
  const modal = document.querySelector<HTMLElement>("#conflict-modal");
  if (!modal) {
    console.error("[issuebridge] conflict modal not in DOM yet");
    return;
  }
  if (modal.dataset.ibBound === "1") {
    return;
  }
  modal.dataset.ibBound = "1";

  document.addEventListener(
    "keydown",
    (event) => {
      const conflict = document.querySelector<HTMLElement>("#conflict-modal");
      if (!conflict || conflict.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
}

/** Re-read auth / first-run for shell sync after account actions. */
export async function refreshMainUi() {
  // First-run / Inbox are React; App listens to issuebridge:app-state.
}
