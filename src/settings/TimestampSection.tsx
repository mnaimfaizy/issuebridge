import {
  Caption1,
  Label,
  Radio,
  RadioGroup,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { TimestampDisplay } from "../shared/formatTimestamp";
import type { AccountAuth } from "../shell/Sidebar";

type TimestampSectionProps = {
  auth: AccountAuth;
  firstRunComplete: boolean;
};

/** Settings → Timestamps: local time or UTC for all Draft timestamps. */
export function TimestampSection({
  auth,
  firstRunComplete,
}: TimestampSectionProps) {
  const enabled = auth.signedIn && firstRunComplete;
  const [display, setDisplay] = useState<TimestampDisplay>("local");

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("get_timestamp_display")
      .then((value) => {
        if (!cancelled) setDisplay(value === "utc" ? "utc" : "local");
      })
      .catch(() => {
        if (!cancelled) setDisplay("local");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange(value: string) {
    const next = value === "utc" ? "utc" : ("local" as TimestampDisplay);
    setDisplay(next);
    void invoke("save_timestamp_display", { value: next }).catch(() => {
      // Soft: revert on error.
      setDisplay(display);
    });
  }

  return (
    <section
      className={`ib-settings-block${enabled ? "" : " ib-settings-block--gated"}`}
      aria-labelledby="timestamp-settings-heading"
      aria-disabled={!enabled}
    >
      <Subtitle2 as="h2" id="timestamp-settings-heading">
        Timestamps
      </Subtitle2>
      {!enabled ? (
        <Caption1 className="ib-settings-helper">
          Complete setup to configure timestamps.
        </Caption1>
      ) : null}
      <Label weight="semibold" id="timestamp-display-label">
        Display format
      </Label>
      <RadioGroup
        aria-labelledby="timestamp-display-label"
        value={display}
        disabled={!enabled}
        onChange={(_, data) => handleChange(data.value)}
      >
        <Radio value="local" label="Local time" />
        <Radio value="utc" label="UTC" />
      </RadioGroup>
    </section>
  );
}
