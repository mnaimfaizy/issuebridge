import {
  Body1,
  Button,
  MessageBar,
  MessageBarBody,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import type { FirstRunStep } from "../settings/gating";
import {
  type AuthStateDto,
  dispatchAppState,
  formatInvokeError,
} from "./types";

type TryCaptureStepProps = {
  onAdvanced: (auth: AuthStateDto, step: FirstRunStep) => void;
};

/**
 * Optional Try capture: opens the real Capture popup, or Skip completes first-run.
 * Dismiss without Save stays on this step (core + Capture window behavior).
 */
export function TryCaptureStep({ onAdvanced }: TryCaptureStepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openCapture() {
    setBusy(true);
    setError(null);
    try {
      await invoke("show_capture");
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    setBusy(true);
    setError(null);
    try {
      await invoke<FirstRunStep>("skip_try_capture");
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
      <Subtitle2 as="h1">Try capture</Subtitle2>
      <Body1>
        Open the real Capture popup and save a Draft (Untitled is fine). Text is
        enough — voice is optional. Later you can open Capture anytime with{" "}
        <kbd>Ctrl+Alt+Shift+I</kbd>, or skip this step.
      </Body1>
      {error ? (
        <MessageBar intent="error" aria-live="polite">
          <MessageBarBody className="ib-message-copy">{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div className="ib-firstrun-actions">
        <Button
          appearance="primary"
          disabled={busy}
          onClick={() => void openCapture()}
        >
          Try capture
        </Button>
        <Button disabled={busy} onClick={() => void skip()}>
          Skip
        </Button>
      </div>
    </div>
  );
}
