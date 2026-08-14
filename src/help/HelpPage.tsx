import {
  Body1,
  Caption1,
  Link,
  Text,
  Title3,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { type ReactNode, useEffect, useState } from "react";
import packageJson from "../../package.json";
import brandMark from "../assets/brand/mark.png";
import {
  modelDisplayName,
  onDiskLabel,
  type RewriteModelStatusDto,
} from "../shared/rewriteModelStatus";
import type { Destination } from "../shell/destinations";
import { HelpSection } from "./HelpSection";
import { HELP_TOPICS, type HelpTokenName, type HelpTopic } from "./helpContent";

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
  const pttHotkey = useCommand("ptt_hotkey", DEFAULT_PTT_HOTKEY);
  const modelStatus = useHelpModelStatus();

  function openLink(topic: HelpTopic) {
    const link = topic.link;
    if (!link || !onNavigate) return;
    onNavigate(link.destination);
    scrollAnchorIntoView(link.anchor);
  }

  const tokens: Record<HelpTokenName, string> = {
    openCaptureHotkey: OPEN_CAPTURE_HOTKEY,
    pttHotkey: pttHotkey,
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

      {HELP_TOPICS.map((topic) => (
        <HelpSection
          key={topic.id}
          topic={topic}
          tokens={tokens}
          onOpenLink={onNavigate ? openLink : undefined}
        >
          {liveBlock(topic.id, modelStatus)}
        </HelpSection>
      ))}
    </section>
  );
}

function liveBlock(
  topicId: string,
  modelStatus: RewriteModelStatusDto | null,
): ReactNode {
  if (topicId === "about") return renderAbout();
  if (topicId === "your-machine") return renderMachine(modelStatus);
  return undefined;
}

/**
 * Re-scrolls after Settings inserts async content (Testing set repo list)
 * that would otherwise push the target heading out of view.
 */
function scrollAnchorIntoView(anchor: string) {
  const content = document.querySelector(".ib-content");
  const scroll = () => {
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  };
  requestAnimationFrame(scroll);
  if (!content) return;
  const observer = new MutationObserver(scroll);
  observer.observe(content, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 8000);
}

function useCommand(command: string, fallback: string): string {
  const [value, setValue] = useState(fallback);
  useEffect(() => {
    let cancelled = false;
    void invoke<string>(command)
      .then((next) => {
        if (!cancelled && next) setValue(next);
      })
      .catch(() => {
        if (!cancelled) setValue(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [command, fallback]);
  return value;
}

/**
 * Live Your-machine snapshot. `skip_content_hash` uses the marker-only
 * path so opening Help cannot stream-hash multi-GB GGUFs under the Core lock.
 */
function useHelpModelStatus(): RewriteModelStatusDto | null {
  const [status, setStatus] = useState<RewriteModelStatusDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    void invoke<RewriteModelStatusDto>("get_rewrite_model_status", {
      skip_content_hash: true,
    })
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
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
        <Text>{onDiskLabel(status)}</Text>
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
