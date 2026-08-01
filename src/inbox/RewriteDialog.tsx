import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  ProgressBar,
  Spinner,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { formatInvokeError } from "./types";

export type RewriteStyleDto = {
  id: string;
  name: string;
  instruction: string;
  builtin: boolean;
};

type RewriteModelStatusDto = {
  models: Array<{
    id: string;
    display_name: string;
    size_bytes: number;
    summary: string;
    on_disk: boolean;
    verified: boolean;
    active: boolean;
  }>;
  active_model_id: string | null;
  recommended_model_id: string;
  recommended_reason: string;
  needs_setup: boolean;
};

type DownloadProgressDto = {
  model_id: string;
  received_bytes: number;
  total_bytes: number;
};

type RewritePhase = "setup" | "downloading" | "idle" | "generating" | "proposal";

type RewriteDialogProps = {
  open: boolean;
  sourceTitle: string;
  sourceBody: string;
  onAccept: (title: string, body: string) => void;
  onClose: () => void;
};

/**
 * Variant B Rewrite modal: optional model setup → style chips → Generate →
 * editable proposal → Accept / Discard. Closing mid-generate/download cancels;
 * never silent-overwrites the Draft underneath.
 */
/** Keep in sync with llama Rewrite engine soft timeout (~120s). */
const GENERATE_SOFT_TIMEOUT_MS = 120_000;

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(0)} MB`;
  }
  return `${bytes} B`;
}

export function RewriteDialog({
  open,
  sourceTitle,
  sourceBody,
  onAccept,
  onClose,
}: RewriteDialogProps) {
  const [styles, setStyles] = useState<RewriteStyleDto[]>([]);
  const [styleId, setStyleId] = useState("clear");
  const [phase, setPhase] = useState<RewritePhase>("idle");
  const [proposedTitle, setProposedTitle] = useState("");
  const [proposedBody, setProposedBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyStyles, setBusyStyles] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInstruction, setNewInstruction] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [modelStatus, setModelStatus] = useState<RewriteModelStatusDto | null>(
    null,
  );
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const generateTokenRef = useRef(0);
  const selectedStyle = styles.find((s) => s.id === styleId);
  const recommended = modelStatus?.models.find(
    (m) => m.id === modelStatus.recommended_model_id,
  );

  function stopInFlightGenerate() {
    void invoke("cancel_rewrite").catch(() => {
      // Soft: ignore if sidecar was not running.
    });
  }

  function stopInFlightDownload() {
    void invoke("cancel_rewrite_model_download").catch(() => {
      // Soft: ignore if no download.
    });
  }

  async function loadModelStatus(): Promise<RewriteModelStatusDto | null> {
    try {
      const snap = await invoke<RewriteModelStatusDto>(
        "get_rewrite_model_status",
      );
      setModelStatus(snap);
      return snap;
    } catch (err) {
      setError(formatInvokeError(err));
      return null;
    }
  }

  async function enterIdleWithStyles() {
    setBusyStyles(true);
    try {
      const snap = await invoke<{
        styles: RewriteStyleDto[];
        last_used_id: string;
      }>("list_rewrite_styles");
      setStyles(snap.styles);
      setStyleId(snap.last_used_id);
      setPhase("idle");
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyStyles(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setProposedTitle("");
    setProposedBody("");
    setError(null);
    setShowAdd(false);
    setNewName("");
    setNewInstruction("");
    setReceivedBytes(0);
    setTotalBytes(0);
    setDownloadModelId(null);
    generateTokenRef.current += 1;
    stopInFlightGenerate();
    void (async () => {
      const status = await loadModelStatus();
      if (!status) {
        setPhase("setup");
        return;
      }
      if (status.needs_setup) {
        setPhase("setup");
        return;
      }
      await enterIdleWithStyles();
    })();
  }, [open]);

  useEffect(() => {
    if (!open || phase !== "downloading") return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const progress = await listen<DownloadProgressDto>(
        "rewrite-model-download-progress",
        (event) => {
          setReceivedBytes(event.payload.received_bytes);
          setTotalBytes(event.payload.total_bytes);
          setDownloadModelId(event.payload.model_id);
        },
      );
      const finished = await listen<string>(
        "rewrite-model-download-finished",
        () => {
          void (async () => {
            const status = await loadModelStatus();
            if (status && !status.needs_setup) {
              await enterIdleWithStyles();
            } else {
              setPhase("setup");
              setError("Download finished but the model is not ready.");
            }
          })();
        },
      );
      const cancelled = await listen<string>(
        "rewrite-model-download-cancelled",
        () => {
          setPhase("setup");
          setError("Download cancelled.");
          void loadModelStatus();
        },
      );
      const failed = await listen<string>(
        "rewrite-model-download-failed",
        () => {
          setPhase("setup");
          setError("Download failed. Partial files were removed.");
          void loadModelStatus();
        },
      );
      if (disposed) {
        progress();
        finished();
        cancelled();
        failed();
        return;
      }
      unlisteners.push(progress, finished, cancelled, failed);
    })();
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [open, phase]);

  function requestClose() {
    generateTokenRef.current += 1;
    stopInFlightGenerate();
    if (phase === "downloading") {
      stopInFlightDownload();
    }
    setPhase("idle");
    onClose();
  }

  async function startDownload(modelId: string) {
    setError(null);
    const model = modelStatus?.models.find((m) => m.id === modelId);
    // Already on disk and verified — activate without re-download.
    if (model?.verified) {
      try {
        await invoke("set_active_rewrite_model", {
          input: { model_id: modelId },
        });
        await enterIdleWithStyles();
      } catch (err) {
        setError(formatInvokeError(err));
        setPhase("setup");
      }
      return;
    }
    setDownloadModelId(modelId);
    setReceivedBytes(0);
    setTotalBytes(model?.size_bytes ?? 0);
    setPhase("downloading");
    try {
      await invoke("start_rewrite_model_download", {
        input: { model_id: modelId },
      });
    } catch (err) {
      setError(formatInvokeError(err));
      setPhase("setup");
    }
  }

  async function removeModel(modelId: string) {
    const model = modelStatus?.models.find((m) => m.id === modelId);
    if (!model) return;
    const sizeLabel = formatBytes(model.size_bytes);
    const message = model.active
      ? `Remove active model ${model.display_name} (${sizeLabel})? The next Rewrite will ask you to download again.`
      : `Remove ${model.display_name} (${sizeLabel}) from disk?`;
    if (!window.confirm(message)) return;
    setError(null);
    try {
      await invoke("remove_rewrite_model", { input: { model_id: modelId } });
      const status = await loadModelStatus();
      if (status?.needs_setup) {
        setPhase("setup");
      }
    } catch (err) {
      setError(formatInvokeError(err));
    }
  }

  function cancelDownload() {
    stopInFlightDownload();
    setPhase("setup");
  }

  async function runGenerate() {
    setError(null);
    setPhase("generating");
    const token = ++generateTokenRef.current;
    const timeoutId = window.setTimeout(() => {
      if (token !== generateTokenRef.current) return;
      generateTokenRef.current += 1;
      stopInFlightGenerate();
      setError("Rewrite timed out. Try again.");
      setPhase("idle");
    }, GENERATE_SOFT_TIMEOUT_MS);
    try {
      const proposal = await invoke<{ title: string; body: string }>(
        "generate_rewrite",
        {
          input: {
            title: sourceTitle,
            body: sourceBody,
            style_id: styleId,
          },
        },
      );
      if (token !== generateTokenRef.current) return;
      setProposedTitle(proposal.title);
      setProposedBody(proposal.body);
      setPhase("proposal");
      try {
        await invoke("remember_last_rewrite_style", { style_id: styleId });
      } catch {
        // Soft: proposal still usable if last-used persistence fails.
      }
    } catch (err) {
      if (token !== generateTokenRef.current) return;
      setError(formatInvokeError(err));
      setPhase("idle");
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function cancelGenerate() {
    generateTokenRef.current += 1;
    stopInFlightGenerate();
    setPhase("idle");
  }

  async function addCustomStyle() {
    setError(null);
    setBusyStyles(true);
    try {
      const style = await invoke<RewriteStyleDto>("add_custom_rewrite_style", {
        input: { name: newName, instruction: newInstruction },
      });
      setStyles((current) => [...current, style]);
      setStyleId(style.id);
      setNewName("");
      setNewInstruction("");
      setShowAdd(false);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyStyles(false);
    }
  }

  async function removeCustomStyle(id: string) {
    setError(null);
    setBusyStyles(true);
    try {
      await invoke("remove_custom_rewrite_style", { style_id: id });
      const snap = await invoke<{
        styles: RewriteStyleDto[];
        last_used_id: string;
      }>("list_rewrite_styles");
      setStyles(snap.styles);
      setStyleId(snap.last_used_id);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyStyles(false);
    }
  }

  const progressFraction =
    totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) requestClose();
      }}
    >
      <DialogSurface className="ib-rewrite-dialog">
        <DialogBody>
          <DialogTitle>Rewrite Draft</DialogTitle>
          <DialogContent>
            {phase === "setup" ? (
              <div className="ib-rewrite-setup">
                <Text>
                  Download a local Rewrite model once. Inference stays on this
                  device after the download finishes.
                </Text>
                {recommended ? (
                  <div className="ib-rewrite-setup-card">
                    <Text weight="semibold">{recommended.display_name}</Text>
                    <Text>{formatBytes(recommended.size_bytes)}</Text>
                    <Text>{modelStatus?.recommended_reason}</Text>
                    <Text className="ib-rewrite-setup-summary">
                      {recommended.summary}
                    </Text>
                  </div>
                ) : (
                  <Text>Loading recommended model…</Text>
                )}
                {modelStatus && modelStatus.models.length > 1 ? (
                  <div
                    className="ib-rewrite-style-row"
                    role="group"
                    aria-label="Rewrite model alternatives"
                  >
                    {modelStatus.models.map((model) => (
                      <Button
                        key={model.id}
                        size="small"
                        appearance={
                          model.id === modelStatus.recommended_model_id
                            ? "primary"
                            : "secondary"
                        }
                        disabled={model.id === downloadModelId}
                        onClick={() => void startDownload(model.id)}
                      >
                        {model.display_name}
                        {model.verified
                          ? " (use)"
                          : model.on_disk
                            ? " (on disk)"
                            : ""}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {modelStatus?.models.some((m) => m.on_disk) ? (
                  <div
                    className="ib-rewrite-style-row"
                    role="group"
                    aria-label="Remove downloaded Rewrite models"
                  >
                    {modelStatus.models
                      .filter((m) => m.on_disk)
                      .map((model) => (
                        <Button
                          key={`remove-${model.id}`}
                          size="small"
                          appearance="subtle"
                          onClick={() => void removeModel(model.id)}
                        >
                          Remove {model.display_name}…
                        </Button>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {phase === "downloading" ? (
              <div className="ib-rewrite-download" aria-live="polite">
                <Text>
                  Downloading{" "}
                  {modelStatus?.models.find((m) => m.id === downloadModelId)
                    ?.display_name ??
                    downloadModelId ??
                    "model"}
                  … {formatBytes(receivedBytes)}
                  {totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}
                </Text>
                <ProgressBar value={progressFraction} />
              </div>
            ) : null}

            {phase === "idle" ? (
              <>
                <Text>Pick a Rewrite style, then generate a proposal.</Text>
                <div
                  className="ib-rewrite-style-row"
                  role="group"
                  aria-label="Rewrite styles"
                >
                  {styles.map((style) => (
                    <Button
                      key={style.id}
                      size="small"
                      appearance={
                        styleId === style.id ? "primary" : "secondary"
                      }
                      disabled={busyStyles || phase !== "idle"}
                      onClick={() => setStyleId(style.id)}
                    >
                      {style.name}
                    </Button>
                  ))}
                </div>
                {selectedStyle && !selectedStyle.builtin ? (
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={busyStyles}
                    onClick={() => void removeCustomStyle(selectedStyle.id)}
                  >
                    Remove style
                  </Button>
                ) : null}
                {showAdd ? (
                  <div className="ib-rewrite-add">
                    <Field label="Style name">
                      <Input
                        value={newName}
                        onChange={(_, d) => setNewName(d.value)}
                      />
                    </Field>
                    <Field label="Instruction">
                      <Textarea
                        rows={3}
                        value={newInstruction}
                        onChange={(_, d) => setNewInstruction(d.value)}
                      />
                    </Field>
                    <div className="ib-rewrite-add-actions">
                      <Button
                        size="small"
                        appearance="primary"
                        disabled={busyStyles}
                        onClick={() => void addCustomStyle()}
                      >
                        Add style
                      </Button>
                      <Button
                        size="small"
                        appearance="secondary"
                        onClick={() => setShowAdd(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={busyStyles}
                    onClick={() => setShowAdd(true)}
                  >
                    Add Rewrite style…
                  </Button>
                )}
                <Button
                  size="small"
                  appearance="subtle"
                  disabled={busyStyles}
                  onClick={() => {
                    void loadModelStatus().then(() => setPhase("setup"));
                  }}
                >
                  Change Rewrite model…
                </Button>
              </>
            ) : null}

            {phase === "generating" ? (
              <div className="ib-rewrite-progress" aria-live="polite">
                <Spinner size="tiny" />
                <Text>Rewriting with {selectedStyle?.name ?? "style"}…</Text>
              </div>
            ) : null}

            {phase === "proposal" ? (
              <div className="ib-rewrite-proposal">
                <Field label="Proposed title">
                  <Input
                    value={proposedTitle}
                    onChange={(_, d) => setProposedTitle(d.value)}
                  />
                </Field>
                <Field label="Proposed body">
                  <Textarea
                    rows={10}
                    resize="vertical"
                    value={proposedBody}
                    onChange={(_, d) => setProposedBody(d.value)}
                  />
                </Field>
              </div>
            ) : null}

            {error ? (
              <Text as="p" className="ib-rewrite-error" role="alert">
                {error}
              </Text>
            ) : null}
          </DialogContent>
          <DialogActions>
            {phase === "setup" ? (
              <Button
                appearance="primary"
                disabled={!recommended}
                onClick={() =>
                  recommended && void startDownload(recommended.id)
                }
              >
                Download
              </Button>
            ) : null}
            {phase === "downloading" ? (
              <Button appearance="secondary" onClick={cancelDownload}>
                Cancel
              </Button>
            ) : null}
            {phase === "idle" ? (
              <Button
                appearance="primary"
                disabled={busyStyles || styles.length === 0}
                onClick={() => void runGenerate()}
              >
                Generate
              </Button>
            ) : null}
            {phase === "generating" ? (
              <Button appearance="secondary" onClick={cancelGenerate}>
                Cancel
              </Button>
            ) : null}
            {phase === "proposal" ? (
              <>
                <Button
                  appearance="primary"
                  onClick={() => {
                    onAccept(proposedTitle, proposedBody);
                    requestClose();
                  }}
                >
                  Accept
                </Button>
                <Button appearance="secondary" onClick={requestClose}>
                  Discard
                </Button>
              </>
            ) : null}
            {phase !== "generating" && phase !== "downloading" ? (
              <Button appearance="secondary" onClick={requestClose}>
                Close
              </Button>
            ) : null}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
