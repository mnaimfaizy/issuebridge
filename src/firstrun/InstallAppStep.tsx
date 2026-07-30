import { useState } from "react";
import {
  Body1,
  Button,
  MessageBar,
  MessageBarBody,
  Subtitle2,
} from "@fluentui/react-components";
import { OpenRegular } from "@fluentui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import type { FirstRunStep } from "../settings/gating";
import {
  dispatchAppState,
  formatInvokeError,
  type AuthStateDto,
  type InstallContinueOutcomeDto,
} from "./types";

type InstallAppStepProps = {
  onAdvanced: (auth: AuthStateDto, step: FirstRunStep) => void;
};

export function InstallAppStep({ onAdvanced }: InstallAppStepProps) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openInstall() {
    setBusy(true);
    setError(null);
    try {
      await invoke("open_app_install");
      setHint(null);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function continueInstall() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await invoke<InstallContinueOutcomeDto>("continue_install");
      if (outcome.kind === "no_install") {
        setHint(
          "Don’t see an install yet. Install the App on selected repositories, then Continue.",
        );
        return;
      }
      if (outcome.kind === "zero_repos") {
        setHint("Add selected repositories on GitHub, then Continue.");
        return;
      }
      setHint(null);
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
      <Subtitle2 as="h1">Install App</Subtitle2>
      <Body1>
        Install the Issuebridge GitHub App on{" "}
        <strong>selected repositories</strong> you plan to capture against — not
        every repo in the org. If it is already installed, skip re-install and
        click Continue.
      </Body1>
      {hint ? (
        <MessageBar intent="warning" aria-live="polite">
          <MessageBarBody className="ib-message-copy">{hint}</MessageBarBody>
        </MessageBar>
      ) : null}
      {error ? (
        <MessageBar intent="error" aria-live="polite">
          <MessageBarBody className="ib-message-copy">{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div className="ib-firstrun-actions">
        <Button
          appearance="primary"
          icon={<OpenRegular />}
          disabled={busy}
          onClick={() => void openInstall()}
        >
          Install on GitHub
        </Button>
        <Button disabled={busy} onClick={() => void continueInstall()}>
          Continue
        </Button>
      </div>
    </div>
  );
}
