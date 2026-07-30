import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Button,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConflictDialog } from "./ConflictDialog";
import { DraftInspector } from "./DraftInspector";
import { InboxList } from "./InboxList";
import { readLastDraftId, writeLastDraftId } from "./lastDraftId";
import {
  SUCCESS_CLEAR_MS,
  clearSuccessOnEdit,
  type StatusState,
} from "./statusModel";
import {
  formatInvokeError,
  parseLabelNames,
  type DraftDto,
  type InboxItemDto,
  type UpdateLinkedOutcomeDto,
} from "./types";
import "./inbox.css";

const NARROW_MQ = "(max-width: 720px)";

type Pane = "sidebar" | "inbox" | "editor";

export function InboxWorkbench() {
  const [items, setItems] = useState<InboxItemDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    readLastDraftId(),
  );
  const [draft, setDraft] = useState<DraftDto | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [status, setStatus] = useState<StatusState>(null);
  const [busy, setBusy] = useState(false);
  const [narrow, setNarrow] = useState(
    () => window.matchMedia(NARROW_MQ).matches,
  );
  const [showEditorPane, setShowEditorPane] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictUrl, setConflictUrl] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const updateButtonRef = useRef<HTMLButtonElement>(null);
  const successTimerRef = useRef<number | null>(null);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current != null) {
      window.clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const showBusy = useCallback(
    (message: string) => {
      clearSuccessTimer();
      setStatus({ kind: "busy", message });
    },
    [clearSuccessTimer],
  );

  const showError = useCallback(
    (message: string) => {
      clearSuccessTimer();
      setStatus({ kind: "error", message });
    },
    [clearSuccessTimer],
  );

  const showSuccess = useCallback(
    (message: string) => {
      clearSuccessTimer();
      setStatus({ kind: "success", message });
      successTimerRef.current = window.setTimeout(() => {
        setStatus((current) =>
          current?.kind === "success" ? null : current,
        );
        successTimerRef.current = null;
      }, SUCCESS_CLEAR_MS);
    },
    [clearSuccessTimer],
  );

  const clearStatus = useCallback(() => {
    clearSuccessTimer();
    setStatus(null);
  }, [clearSuccessTimer]);

  const applyDraft = useCallback((next: DraftDto) => {
    setDraft(next);
    setSelectedId(next.id);
    writeLastDraftId(next.id);
    setTitle(next.title);
    setBody(next.body);
    setLabels(next.label_names.join(", "));
  }, []);

  const loadInbox = useCallback(async () => {
    try {
      const next = await invoke<InboxItemDto[]>("list_inbox");
      setItems(next);
      return next;
    } catch (error) {
      showError(formatInvokeError(error));
      return null;
    }
  }, [showError]);

  const openDraft = useCallback(
    async (id: string, options?: { activateEditor?: boolean }) => {
      try {
        const next = await invoke<DraftDto>("get_draft", { id });
        applyDraft(next);
        if (options?.activateEditor !== false) {
          setShowEditorPane(true);
        }
        clearStatus();
        await loadInbox();
      } catch (error) {
        showError(formatInvokeError(error));
      }
    },
    [applyDraft, clearStatus, loadInbox, showError],
  );

  const restoreSelection = useEffectEvent(async (nextItems: InboxItemDto[]) => {
    const persisted = readLastDraftId();
    const candidate =
      persisted && nextItems.some((item) => item.id === persisted)
        ? persisted
        : selectedId && nextItems.some((item) => item.id === selectedId)
          ? selectedId
          : null;
    if (!candidate) {
      setSelectedId(null);
      setDraft(null);
      writeLastDraftId(null);
      setShowEditorPane(false);
      return;
    }
    if (!draft || draft.id !== candidate) {
      await openDraft(candidate);
    }
  });

  useEffect(() => {
    const media = window.matchMedia(NARROW_MQ);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    void (async () => {
      const next = await loadInbox();
      if (next) await restoreSelection(next);
    })();

    let unlisten: (() => void) | undefined;
    void listen("inbox-changed", () => {
      void (async () => {
        const next = await loadInbox();
        if (next) await restoreSelection(next);
      })();
    }).then((fn) => {
      unlisten = fn;
    });

    const onFocus = () => {
      void loadInbox();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      unlisten?.();
      window.removeEventListener("focus", onFocus);
      clearSuccessTimer();
    };
  }, [clearSuccessTimer, loadInbox]);

  function noteFieldEdit() {
    setStatus((current) => clearSuccessOnEdit(current));
  }

  async function runCapture() {
    setBusy(true);
    showBusy("Opening Capture…");
    try {
      await invoke("show_capture");
      clearStatus();
    } catch (error) {
      showError(formatInvokeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function runSave() {
    if (!selectedId) return;
    setBusy(true);
    showBusy("Saving…");
    try {
      const next = await invoke<DraftDto>("edit_draft", {
        input: {
          id: selectedId,
          title,
          body,
          label_names: parseLabelNames(labels),
        },
      });
      applyDraft(next);
      await loadInbox();
      showSuccess("Saved");
    } catch (error) {
      showError(formatInvokeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function runPublishOrUpdate() {
    if (!selectedId || !draft) return;
    setBusy(true);
    showBusy(draft.linked ? "Updating…" : "Publishing…");
    try {
      await invoke<DraftDto>("edit_draft", {
        input: {
          id: selectedId,
          title,
          body,
          label_names: parseLabelNames(labels),
        },
      });
      if (!draft.linked) {
        const next = await invoke<DraftDto>("publish_draft", {
          id: selectedId,
        });
        applyDraft(next);
        await loadInbox();
        showSuccess("Published");
        return;
      }
      const outcome = await invoke<UpdateLinkedOutcomeDto>(
        "update_linked_draft",
        { id: selectedId },
      );
      if (outcome.kind === "conflict") {
        setConflictUrl(outcome.html_url);
        setConflictOpen(true);
        clearStatus();
        return;
      }
      applyDraft(outcome.draft);
      await loadInbox();
      showSuccess("Updated");
    } catch (error) {
      showError(formatInvokeError(error));
      await loadInbox();
    } finally {
      setBusy(false);
    }
  }

  function restoreFocusToUpdate() {
    window.requestAnimationFrame(() => {
      updateButtonRef.current?.focus();
    });
  }

  async function runKeepMine() {
    if (!selectedId) return;
    setBusy(true);
    showBusy("Keeping local edits…");
    try {
      const next = await invoke<DraftDto>("keep_mine", { id: selectedId });
      setConflictOpen(false);
      applyDraft(next);
      await loadInbox();
      showSuccess("Kept local edits");
      restoreFocusToUpdate();
    } catch (error) {
      showError(formatInvokeError(error));
    } finally {
      setBusy(false);
    }
  }

  async function runUseTheirs() {
    if (!selectedId) return;
    setBusy(true);
    showBusy("Using GitHub version…");
    try {
      const next = await invoke<DraftDto>("use_theirs", { id: selectedId });
      setConflictOpen(false);
      applyDraft(next);
      await loadInbox();
      showSuccess("Used GitHub version");
      restoreFocusToUpdate();
    } catch (error) {
      showError(formatInvokeError(error));
    } finally {
      setBusy(false);
    }
  }

  function focusPane(pane: Pane) {
    if (pane === "sidebar") {
      document
        .querySelector<HTMLElement>('.ib-sidebar [aria-current="page"], .ib-nav-item')
        ?.focus();
      return;
    }
    if (pane === "inbox") {
      listRef.current?.focus();
      return;
    }
    editorRef.current?.focus();
  }

  function cyclePane() {
    const order: Pane[] = ["sidebar", "inbox", "editor"];
    const active = document.activeElement;
    let current: Pane = "sidebar";
    if (listRef.current?.contains(active)) current = "inbox";
    else if (editorRef.current?.contains(active) || editorRef.current === active)
      current = "editor";
    else if (active?.closest(".ib-sidebar")) current = "sidebar";
    const next = order[(order.indexOf(current) + 1) % order.length];
    focusPane(next);
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (items.length === 0) return;
    const index = Math.max(
      0,
      items.findIndex((item) => item.id === selectedId),
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = items[Math.min(items.length - 1, index + 1)];
      // Arrows only move selection; Enter/Space activate the editor pane.
      if (next) void openDraft(next.id, { activateEditor: false });
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = items[Math.max(0, index - 1)];
      if (next) void openDraft(next.id, { activateEditor: false });
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (selectedId) void openDraft(selectedId, { activateEditor: true });
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (conflictOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        cyclePane();
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void runSave();
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        void runPublishOrUpdate();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const stackedEditorVisible = !narrow || showEditorPane;
  const stackedListVisible = !narrow || !showEditorPane;

  return (
    <div className="ib-workbench">
      <div className="ib-workbench-command" role="region" aria-label="Status">
        {status ? (
          <MessageBar
            intent={
              status.kind === "error"
                ? "error"
                : status.kind === "success"
                  ? "success"
                  : "info"
            }
          >
            <MessageBarBody className="ib-message-copy">
              {status.kind === "busy" ? (
                <>
                  <Spinner size="tiny" />{" "}
                  <MessageBarTitle>{status.message}</MessageBarTitle>
                </>
              ) : (
                <MessageBarTitle>{status.message}</MessageBarTitle>
              )}
            </MessageBarBody>
          </MessageBar>
        ) : null}
        {items.length > 0 ? (
          <div className="ib-workbench-capture-row">
            <Button
              appearance="primary"
              disabled={busy}
              onClick={() => void runCapture()}
            >
              Capture
            </Button>
          </div>
        ) : null}
      </div>

      <div
        className={`ib-workbench-panes${narrow ? " narrow" : ""}${
          narrow && showEditorPane ? " show-editor" : ""
        }`}
      >
        {stackedListVisible ? (
          <aside className="ib-workbench-list" aria-label="Inbox">
            <InboxList
              items={items}
              selectedId={selectedId}
              busy={busy}
              listRef={listRef}
              onSelect={(id) => void openDraft(id)}
              onCapture={() => void runCapture()}
              onListKeyDown={onListKeyDown}
            />
          </aside>
        ) : null}

        {stackedEditorVisible ? (
          <DraftInspector
            draft={draft}
            title={title}
            body={body}
            labels={labels}
            busy={busy}
            narrowStacked={narrow}
            editorRef={editorRef}
            updateButtonRef={updateButtonRef}
            onTitleChange={(value) => {
              noteFieldEdit();
              setTitle(value);
            }}
            onBodyChange={(value) => {
              noteFieldEdit();
              setBody(value);
            }}
            onLabelsChange={(value) => {
              noteFieldEdit();
              setLabels(value);
            }}
            onSave={() => void runSave()}
            onPublishOrUpdate={() => void runPublishOrUpdate()}
            onBack={() => setShowEditorPane(false)}
          />
        ) : null}
      </div>

      <ConflictDialog
        open={conflictOpen}
        htmlUrl={conflictUrl}
        busy={busy}
        onKeepMine={() => void runKeepMine()}
        onUseTheirs={() => void runUseTheirs()}
      />
    </div>
  );
}
