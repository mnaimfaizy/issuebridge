import { useEffect, useState } from "react";
import {
  Body1,
  Caption1,
  Link,
  Subtitle2,
  Title3,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import packageJson from "../../package.json";

const OPEN_CAPTURE_HOTKEY = "Ctrl+Alt+Shift+I";
const DEFAULT_PTT_HOTKEY = "Ctrl+Alt+Shift+V";
const REPO_URL = "https://github.com/mnaimfaizy/issuebridge";
const FEEDBACK_URL = "https://github.com/mnaimfaizy/issuebridge/issues/new";

/** Full-page Help: Shortcuts, How it works, About. */
export function HelpPage() {
  const [pttHotkey, setPttHotkey] = useState(DEFAULT_PTT_HOTKEY);

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

  return (
    <section className="ib-destination" aria-labelledby="help-heading">
      <header className="ib-destination-header">
        <Title3 as="h1" id="help-heading">
          Help
        </Title3>
        <Body1>
          Learn Capture → Draft → Inbox → Publish without leaving the app.
        </Body1>
      </header>

      <section className="ib-settings-block" aria-labelledby="shortcuts-heading">
        <Subtitle2 as="h2" id="shortcuts-heading">
          Shortcuts
        </Subtitle2>
        <ul className="ib-help-list">
          <li>
            <strong>Open Capture:</strong>{" "}
            <kbd>{OPEN_CAPTURE_HOTKEY}</kbd>
          </li>
          <li>
            <strong>Push-to-talk:</strong> hold <kbd>{pttHotkey}</kbd>, release
            to stop
          </li>
        </ul>
        <Caption1>
          Settings → Capture shows the current PTT binding (rebind coming soon).
        </Caption1>
      </section>

      <section className="ib-settings-block" aria-labelledby="how-it-works-heading">
        <Subtitle2 as="h2" id="how-it-works-heading">
          How it works
        </Subtitle2>
        <ol className="ib-help-list">
          <li>
            <strong>Capture</strong> — open the Capture popup and record a title
            and body (text or voice) into a Draft for one Testing set repo.
          </li>
          <li>
            <strong>Draft</strong> — a local issue-in-progress stored on this
            machine until you Publish.
          </li>
          <li>
            <strong>Inbox</strong> — review, edit, and label Drafts in the main
            window.
          </li>
          <li>
            <strong>Publish</strong> — create the GitHub issue from a Draft and
            form the Local link.
          </li>
        </ol>
      </section>

      <section className="ib-settings-block" aria-labelledby="about-heading">
        <Subtitle2 as="h2" id="about-heading">
          About
        </Subtitle2>
        <Body1>
          <strong>Issuebridge</strong>
        </Body1>
        <Caption1>Version {packageJson.version}</Caption1>
        <div className="ib-settings-actions">
          <Link href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub repository
          </Link>
          <Link href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
            Send feedback
          </Link>
        </div>
      </section>
    </section>
  );
}
