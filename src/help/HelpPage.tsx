import {
  Body1,
  Caption1,
  Link,
  Text,
  Title3,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import packageJson from "../../package.json";
import brandMark from "../assets/brand/mark.png";
import {
  formatBytes,
  modelDisplayName,
  type RewriteModelStatusDto,
} from "../settings/rewriteModelStatus";
import type { Destination } from "../shell/destinations";
import { HelpSection } from "./HelpSection";
import { HELP_TOPICS, type HelpTopic } from "./helpContent";

const OPEN_CAPTURE_HOTKEY = "Ctrl+Alt+Shift+I";
const DEFAULT_PTT_HOTKEY = "Ctrl+Alt+Shift+V";
const REPO_URL = "https://github.com/mnaimfaizy/issuebridge";
const FEEDBACK_URL = "https://github.com/mnaimfaizy/issuebridge/issues/new";

type HelpPageProps = {
  /** Lets Help deep-link into Settings; Help itself stays read-only. */
  onNavigate?: (destination: Destination) => void;
};

/**
 * Full-page Help: the single in-app reference for what Issuebridge does —
 * Shortcuts, How it works, Rewrite and local models, Your machine, voice,
 * Testing set, Label catalog, Publish conflicts, Timestamps, Appearance,
 * Account, troubleshooting, About. Actions live in Settings, not here.
 */
export function HelpPage({ onNavigate }: HelpPageProps) {
  const [pttHotkey, setPttHotkey] = useState(DEFAULT_PTT_HOTKEY);
  const [modelStatus, setModelStatus] = useState<RewriteModelStatusDto | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void invoke<string>("ptt_hotkey")
      .then((value) => {
        if (!cancelled && value) setPttHotkey(value);
      })
      .catch(() => {
        if (!cancelled) setPttHotkey(DEFAULT_PTT_HOTKEY);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void invoke<RewriteModelStatusDto>("get_rewrite_model_status")
      .then((status) => {
        if (!cancelled) setModelStatus(status);
      })
      .catch(() => {
        // Help is reference-only: fall back to the static prose, no error.
        if (!cancelled) setModelStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openLink(topic: HelpTopic) {
    const link = topic.link;
    if (!link || !onNavigate) return;
    onNavigate(link.destination);
    // The destination renders after this state change — wait for it, then
    // bring the matching section into view.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document
          .getElementById(link.anchor)
          ?.scrollIntoView({ block: "start" });
      });
    });
  }

  const tokens = {
    openCaptureHotkey: OPEN_CAPTURE_HOTKEY,
    pttHotkey,
  };

  return (
    <section className="ib-destination" aria-labelledby="help-heading">
      <header className="ib-destination-header">
        <Title3 as="h1" id="help-heading">
          Help
        </Title3>
        <Body1>
          Capture → Draft → Inbox → Publish, on-device Rewrite, and everything
          Settings can change — without leaving the app.
        </Body1>
      </header>

      {HELP_TOPICS.map((topic) =>
        topic.id === "about" ? (
          <HelpSection key={topic.id} topic={topic} tokens={tokens}>
            {renderAbout()}
          </HelpSection>
        ) : (
          <HelpSection
            key={topic.id}
            topic={topic}
            tokens={tokens}
            onOpenLink={onNavigate ? openLink : undefined}
          >
            {topic.id === "your-machine"
              ? renderMachine(modelStatus)
              : undefined}
          </HelpSection>
        ),
      )}
    </section>
  );
}

/** Live, read-only view of hardware tier, recommended and active model. */
function renderMachine(status: RewriteModelStatusDto | null) {
  if (!status) {
    return (
      <Caption1 className="ib-settings-helper">
        Live details appear once Issuebridge can read this machine's Rewrite
        model status.
      </Caption1>
    );
  }
  const recommended = modelDisplayName(status, status.recommended_model_id);
  const active = modelDisplayName(status, status.active_model_id);
  const downloaded = status.models.filter((model) => model.verified);
  const diskBytes = downloaded.reduce(
    (total, model) => total + model.size_bytes,
    0,
  );

  return (
    <dl className="ib-help-facts">
      <dt>
        <Text weight="semibold">Hardware tier</Text>
      </dt>
      <dd>
        <Text>{status.hardware_tier}</Text>
      </dd>
      <dt>
        <Text weight="semibold">Recommended model</Text>
      </dt>
      <dd>
        <Text>
          {recommended}
          {status.recommended_reason ? ` — ${status.recommended_reason}` : ""}
        </Text>
      </dd>
      <dt>
        <Text weight="semibold">Active model</Text>
      </dt>
      <dd>
        <Text>
          {active ?? "none yet — the first Rewrite offers a download"}
        </Text>
      </dd>
      <dt>
        <Text weight="semibold">On disk</Text>
      </dt>
      <dd>
        <Text>
          {downloaded.length === 0
            ? "No models downloaded"
            : `${downloaded.length} of ${status.models.length} models · ${formatBytes(diskBytes)}`}
        </Text>
      </dd>
    </dl>
  );
}

function renderAbout() {
  return (
    <>
      <div className="ib-about-brand">
        <img
          className="ib-about-mark"
          src={brandMark}
          alt=""
          width={40}
          height={40}
          aria-hidden="true"
        />
        <div className="ib-about-brand-copy">
          <Body1>
            <strong>Issuebridge</strong>
          </Body1>
          <Caption1>Version {packageJson.version}</Caption1>
        </div>
      </div>
      <div className="ib-settings-actions">
        <Link href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub repository
        </Link>
        <Link href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          Send feedback
        </Link>
      </div>
    </>
  );
}
