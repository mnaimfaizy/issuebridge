import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { FirstRunStep } from "../settings/gating";
import { ProgressStrip } from "./ProgressStrip";
import { SignInStep } from "./SignInStep";
import { InstallAppStep } from "./InstallAppStep";
import { TestingSetStep } from "./TestingSetStep";
import { TryCaptureStep } from "./TryCaptureStep";
import {
  dispatchAppState,
  type AuthStateDto,
  type FirstRunWizardStep,
} from "./types";
import "./firstrun.css";

type FirstRunWorkbenchProps = {
  step: FirstRunStep;
  onStepChange: (auth: AuthStateDto, step: FirstRunStep) => void;
};

function asWizardStep(step: FirstRunStep): FirstRunWizardStep {
  if (step === "ready") return "sign_in";
  return step;
}

/**
 * First-run inside the command-workbench shell: progress strip + step panels.
 * Product gates stay in core; this adapter only invokes existing commands.
 */
export function FirstRunWorkbench({
  step,
  onStepChange,
}: FirstRunWorkbenchProps) {
  const wizardStep = asWizardStep(step);
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("inbox-changed", () => {
      // Save during Try capture completes first-run → refresh into Inbox.
      void (async () => {
        try {
          const [auth, next] = await Promise.all([
            invoke<AuthStateDto>("auth_state"),
            invoke<FirstRunStep>("first_run_step"),
          ]);
          dispatchAppState(auth, next);
          onStepChangeRef.current(auth, next);
        } catch (error) {
          console.error(
            "[issuebridge] first-run inbox-changed refresh failed",
            error,
          );
        }
      })();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <section className="ib-firstrun" aria-label="First-run setup">
      <ProgressStrip current={wizardStep} />
      <div className="ib-firstrun-panel">
        {wizardStep === "sign_in" ? (
          <SignInStep onAdvanced={onStepChange} />
        ) : null}
        {wizardStep === "install_app" ? (
          <InstallAppStep onAdvanced={onStepChange} />
        ) : null}
        {wizardStep === "testing_set" ? (
          <TestingSetStep onAdvanced={onStepChange} />
        ) : null}
        {wizardStep === "try_capture" ? (
          <TryCaptureStep onAdvanced={onStepChange} />
        ) : null}
      </div>
    </section>
  );
}
