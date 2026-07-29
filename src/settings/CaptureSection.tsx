import { useEffect, useState } from "react";
import {
  Body1,
  Button,
  Caption1,
  Input,
  Label,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import type { AccountAuth } from "../shell/Sidebar";
import { captureSettingsHelper, isCaptureSettingsEnabled } from "./gating";

type CaptureSectionProps = {
  auth: AccountAuth;
  firstRunComplete: boolean;
};

const DEFAULT_PTT = "Ctrl+Alt+Shift+V";

/** Settings → Capture: read-only PTT; rebind visible but Coming soon. */
export function CaptureSection({
  auth,
  firstRunComplete,
}: CaptureSectionProps) {
  const enabled = isCaptureSettingsEnabled(auth, firstRunComplete);
  const helper = captureSettingsHelper(auth, firstRunComplete);
  const [pttHotkey, setPttHotkey] = useState(DEFAULT_PTT);

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("ptt_hotkey")
      .then((value) => {
        if (!cancelled && value) setPttHotkey(value);
      })
      .catch(() => {
        if (!cancelled) setPttHotkey(DEFAULT_PTT);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      className={`ib-settings-block${enabled ? "" : " ib-settings-block--gated"}`}
      aria-labelledby="capture-settings-heading"
      aria-disabled={!enabled}
    >
      <Subtitle2 as="h2" id="capture-settings-heading">
        Capture
      </Subtitle2>
      {helper ? (
        <Caption1 className="ib-settings-helper">{helper}</Caption1>
      ) : null}
      <Label weight="semibold" htmlFor="ptt-hotkey-display">
        Push-to-talk hotkey
      </Label>
      <Input
        id="ptt-hotkey-display"
        value={pttHotkey}
        readOnly
        disabled={!enabled}
      />
      {enabled ? (
        <Body1>
          Hold the hotkey to dictate in the Capture popup; release to stop.
        </Body1>
      ) : null}
      <div className="ib-settings-actions">
        <Button appearance="secondary" disabled>
          Rebind hotkey
        </Button>
        <Caption1 className="ib-settings-helper">Coming soon</Caption1>
      </div>
    </section>
  );
}
