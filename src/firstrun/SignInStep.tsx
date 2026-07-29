import { useState, type FormEvent } from "react";
import {
  Body1,
  Button,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import {
  dispatchAppState,
  formatInvokeError,
  type AuthStateDto,
  type FirstRunWizardStep,
} from "./types";
import type { FirstRunStep } from "../settings/gating";

type SignInStepProps = {
  onAdvanced: (auth: AuthStateDto, step: FirstRunStep) => void;
};

export function SignInStep({ onAdvanced }: SignInStepProps) {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refreshAndAdvance() {
    const [auth, step] = await Promise.all([
      invoke<AuthStateDto>("auth_state"),
      invoke<FirstRunStep>("first_run_step"),
    ]);
    dispatchAppState(auth, step);
    onAdvanced(auth, step);
    return { auth, step };
  }

  async function runGithub() {
    setBusy(true);
    setError(null);
    try {
      await invoke<AuthStateDto>("sign_in_with_github");
      await refreshAndAdvance();
    } catch (err) {
      try {
        await refreshAndAdvance();
      } catch {
        /* keep sign-in error */
      }
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  async function runPat(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Enter a personal access token.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const auth = await invoke<AuthStateDto>("sign_in_with_pat", {
        input: { token: trimmed },
      });
      setToken("");
      const step = await invoke<FirstRunStep>("first_run_step");
      dispatchAppState(auth, step);
      onAdvanced(auth, step);
      if (auth !== "signed_in" || (step as FirstRunWizardStep | "ready") === "sign_in") {
        setError(
          "Credentials were accepted, but the app stayed on Sign in. Check the terminal for [issuebridge] keyring logs.",
        );
      }
    } catch (err) {
      try {
        await refreshAndAdvance();
      } catch {
        /* keep PAT error */
      }
      setError(formatInvokeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ib-firstrun-step">
      <Subtitle2 as="h1">Sign in</Subtitle2>
      <Body1>
        Sign in so Issuebridge can create and update issues as you.
      </Body1>
      {error ? (
        <MessageBar intent="error" aria-live="polite">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      ) : null}
      <div className="ib-firstrun-actions">
        <Button appearance="primary" disabled={busy} onClick={() => void runGithub()}>
          Sign in with GitHub
        </Button>
        <details className="ib-pat-details">
          <summary>Use a personal access token</summary>
          <form className="ib-pat-form" onSubmit={(e) => void runPat(e)}>
            <Label htmlFor="firstrun-pat-input" weight="semibold">
              Personal access token
            </Label>
            <Input
              id="firstrun-pat-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="ghp_…"
              value={token}
              disabled={busy}
              onChange={(_, data) => setToken(data.value)}
            />
            <Button type="submit" disabled={busy}>
              Sign in with PAT
            </Button>
          </form>
        </details>
      </div>
    </div>
  );
}
