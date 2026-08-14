import {
  Body1,
  Button,
  Caption1,
  ProgressBar,
  Spinner,
  Subtitle2,
  Text,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { formatInvokeError } from "../inbox/types";
import type { AccountAuth } from "../shell/Sidebar";
import {
  isRewriteModelsSettingsEnabled,
  rewriteModelsSettingsHelper,
} from "./gating";
import { formatBytes, type RewriteModelStatusDto } from "./rewriteModelStatus";

type DownloadProgressDto = {
  model_id: string;
  received_bytes: number;
  total_bytes: number;
};

type RewriteModelsSectionProps = {
  auth: AccountAuth;
  firstRunComplete: boolean;
};

/** Settings → Rewrite models: catalog, disk use, active, download/switch/Remove, Keep/Switch. */
export function RewriteModelsSection({
  auth,
  firstRunComplete,
}: RewriteModelsSectionProps) {
  const enabled = isRewriteModelsSettingsEnabled(auth, firstRunComplete);
  const helper = rewriteModelsSettingsHelper(auth, firstRunComplete);
  const [status, setStatus] = useState<RewriteModelStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hardwarePromptBusy, setHardwarePromptBusy] = useState(false);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  async function loadStatus(): Promise<RewriteModelStatusDto | null> {
    try {
      const snap = await invoke<RewriteModelStatusDto>(
        "get_rewrite_model_status",
      );
      setStatus(snap);
      setError(null);
      return snap;
    } catch (err) {
      setError(formatInvokeError(err));
      setStatus(null);
      return null;
    }
  }

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setError(null);
      setBusyId(null);
      setDownloadModelId(null);
      setReceivedBytes(0);
      setTotalBytes(0);
      setHardwarePromptBusy(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadStatus().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !downloadModelId) return;
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
          setDownloadModelId(null);
          setBusyId(null);
          void loadStatus();
        },
      );
      const cancelled = await listen<string>(
        "rewrite-model-download-cancelled",
        () => {
          setDownloadModelId(null);
          setBusyId(null);
          setError("Download cancelled.");
          void loadStatus();
        },
      );
      const failed = await listen<string>(
        "rewrite-model-download-failed",
        () => {
          setDownloadModelId(null);
          setBusyId(null);
          setError("Download failed. Partial files were removed.");
          void loadStatus();
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
  }, [enabled, downloadModelId]);

  async function respondHardwarePrompt(switchToRecommended: boolean) {
    setHardwarePromptBusy(true);
    setError(null);
    try {
      const snap = await invoke<RewriteModelStatusDto>(
        "respond_rewrite_hardware_prompt",
        { input: { switch: switchToRecommended } },
      );
      setStatus(snap);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setHardwarePromptBusy(false);
    }
  }

  async function downloadModel(modelId: string, kind: "download" | "update") {
    const model = status?.models.find((m) => m.id === modelId);
    if (!model || !status) return;
    const sizeLabel = formatBytes(model.size_bytes);
    const reason =
      modelId === status.recommended_model_id
        ? status.recommended_reason
        : model.summary;
    const confirmMessage =
      kind === "update"
        ? `Download an updated ${model.display_name} (${sizeLabel})? This replaces the file on disk and sets it as the active Rewrite model. ${reason}`
        : `Download ${model.display_name} (${sizeLabel}) and set it as the active Rewrite model? ${reason}`;
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    setBusyId(modelId);
    setDownloadModelId(modelId);
    setReceivedBytes(0);
    setTotalBytes(model.size_bytes);
    try {
      await invoke("start_rewrite_model_download", {
        input: { model_id: modelId },
      });
      // Already verified on disk — command sets active without download events.
      if (model.verified) {
        setDownloadModelId(null);
        setBusyId(null);
        await loadStatus();
      }
    } catch (err) {
      setDownloadModelId(null);
      setBusyId(null);
      setError(formatInvokeError(err));
    }
  }

  async function activateModel(modelId: string) {
    setError(null);
    setBusyId(modelId);
    try {
      await invoke("set_active_rewrite_model", {
        input: { model_id: modelId },
      });
      await loadStatus();
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function removeModel(modelId: string) {
    const model = status?.models.find((m) => m.id === modelId);
    if (!model) return;
    const sizeLabel = formatBytes(model.size_bytes);
    const message = model.active
      ? `Remove active model ${model.display_name} (${sizeLabel})? The next Rewrite will ask you to download again.`
      : `Remove ${model.display_name} (${sizeLabel}) from disk?`;
    if (!window.confirm(message)) return;
    setError(null);
    setBusyId(modelId);
    try {
      await invoke("remove_rewrite_model", { input: { model_id: modelId } });
      await loadStatus();
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyId(null);
    }
  }

  function cancelDownload() {
    void invoke("cancel_rewrite_model_download").catch(() => {
      // Soft: ignore if no download.
    });
  }

  const hardwarePrompt = status?.hardware_switch_prompt ?? null;
  const recommendedName =
    status?.models.find((m) => m.id === status.recommended_model_id)
      ?.display_name ?? status?.recommended_model_id;
  const progressFraction =
    totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : undefined;
  const downloading = downloadModelId !== null;

  return (
    <section
      className={`ib-settings-block${enabled ? "" : " ib-settings-block--gated"}`}
      aria-labelledby="rewrite-models-settings-heading"
      aria-disabled={!enabled}
    >
      <Subtitle2 as="h2" id="rewrite-models-settings-heading">
        Rewrite models
      </Subtitle2>
      {helper ? (
        <Caption1 className="ib-settings-helper">{helper}</Caption1>
      ) : null}
      {enabled ? (
        <Body1>
          Download local Rewrite models on demand. Inference stays on this
          device. Models are not updated automatically.
        </Body1>
      ) : null}

      {enabled && loading && !status ? (
        <div className="ib-settings-actions">
          <Spinner size="tiny" />
          <Caption1>Loading catalog…</Caption1>
        </div>
      ) : null}

      {enabled && hardwarePrompt ? (
        <div
          className="ib-rewrite-hardware-prompt"
          role="status"
          aria-live="polite"
        >
          <Text weight="semibold">Hardware changed</Text>
          <Text>
            Recommended model is now{" "}
            {status?.models.find(
              (m) => m.id === hardwarePrompt.recommended_model_id,
            )?.display_name ?? hardwarePrompt.recommended_model_id}
            . {hardwarePrompt.reason} Keep your current model or switch (no
            automatic download).
          </Text>
          <div className="ib-settings-actions">
            <Button
              size="small"
              appearance="secondary"
              disabled={hardwarePromptBusy || downloading}
              onClick={() => void respondHardwarePrompt(false)}
            >
              Keep
            </Button>
            <Button
              size="small"
              appearance="primary"
              disabled={hardwarePromptBusy || downloading}
              onClick={() => void respondHardwarePrompt(true)}
            >
              Switch
            </Button>
          </div>
        </div>
      ) : null}

      {enabled && status ? (
        <>
          <Caption1>
            Active:{" "}
            {status.active_model_id
              ? (status.models.find((m) => m.id === status.active_model_id)
                  ?.display_name ?? status.active_model_id)
              : "none"}
            . Recommended: {recommendedName}. {status.recommended_reason}
          </Caption1>
          <ul
            className="ib-rewrite-model-list"
            aria-label="Rewrite model catalog"
          >
            {status.models.map((model) => {
              const rowBusy =
                busyId === model.id || downloadModelId === model.id;
              return (
                <li key={model.id} className="ib-rewrite-model-row">
                  <div className="ib-rewrite-model-meta">
                    <Text weight="semibold">
                      {model.display_name}
                      {model.active ? " (active)" : ""}
                      {model.id === status.recommended_model_id
                        ? " (recommended)"
                        : ""}
                    </Text>
                    <Caption1>
                      {formatBytes(model.size_bytes)}
                      {model.verified
                        ? " · on disk"
                        : model.on_disk
                          ? " · on disk (not verified)"
                          : " · not downloaded"}
                      {model.update_available ? " · Update available" : ""}
                    </Caption1>
                    <Caption1 className="ib-settings-helper">
                      {model.summary}
                    </Caption1>
                  </div>
                  <div className="ib-settings-actions">
                    {model.update_available ? (
                      <Button
                        size="small"
                        appearance="primary"
                        disabled={downloading || rowBusy}
                        onClick={() => void downloadModel(model.id, "update")}
                      >
                        Update available
                      </Button>
                    ) : null}
                    {!model.verified && !model.update_available ? (
                      <Button
                        size="small"
                        appearance="primary"
                        disabled={downloading || rowBusy}
                        onClick={() => void downloadModel(model.id, "download")}
                      >
                        Download
                      </Button>
                    ) : null}
                    {model.verified && !model.active ? (
                      <Button
                        size="small"
                        appearance="secondary"
                        disabled={downloading || rowBusy}
                        onClick={() => void activateModel(model.id)}
                      >
                        Use
                      </Button>
                    ) : null}
                    {model.on_disk ? (
                      <Button
                        size="small"
                        appearance="subtle"
                        disabled={downloading || rowBusy}
                        onClick={() => void removeModel(model.id)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {enabled && downloading ? (
        <div className="ib-rewrite-download" aria-live="polite">
          <Text>
            Downloading{" "}
            {status?.models.find((m) => m.id === downloadModelId)
              ?.display_name ??
              downloadModelId ??
              "model"}
            … {formatBytes(receivedBytes)}
            {totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}
          </Text>
          <ProgressBar value={progressFraction} />
          <div className="ib-settings-actions">
            <Button
              size="small"
              appearance="secondary"
              onClick={cancelDownload}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {enabled && error ? (
        <Text as="p" className="ib-rewrite-error" role="alert">
          {error}
        </Text>
      ) : null}
    </section>
  );
}
