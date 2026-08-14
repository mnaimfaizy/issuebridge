import type { Destination } from "../shell/destinations";

/**
 * Help content as data so the page and the help-coverage check read one source.
 * Prose describes *behaviour* only — live values (hotkey, hardware tier,
 * recommended and active Rewrite model) are rendered from commands at runtime
 * so Help cannot drift from the catalog.
 */

export type HelpLink = {
  /** Destination the link switches to. */
  destination: Destination;
  /** Element id scrolled into view once that destination renders. */
  anchor: string;
  label: string;
};

export type HelpTokenName = "openCaptureHotkey" | "pttHotkey";

export type HelpPoint = {
  term: string;
  /** May contain `{token}` placeholders resolved at render time. */
  detail: string;
};

export type HelpTopic = {
  id: string;
  heading: string;
  intro: string;
  points: HelpPoint[];
  /** Render points as a numbered sequence instead of a list of terms. */
  ordered?: boolean;
  link?: HelpLink;
};

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "shortcuts",
    heading: "Shortcuts",
    intro: "Capture works from anywhere, without switching to the app first.",
    points: [
      {
        term: "Open Capture",
        detail:
          "Press {openCaptureHotkey} to open the Capture popup over whatever you are testing.",
      },
      {
        term: "Push-to-talk",
        detail: "Hold {pttHotkey} to dictate, release to stop.",
      },
      {
        term: "Rebinding",
        detail:
          "Settings → Capture shows the current PTT binding (rebind coming soon).",
      },
    ],
    link: {
      destination: "settings",
      anchor: "capture-settings-heading",
      label: "Open Settings → Capture",
    },
  },
  {
    id: "how-it-works",
    heading: "How it works",
    intro:
      "Capture → Draft → Inbox → Publish. Nothing reaches GitHub until you Publish.",
    ordered: true,
    points: [
      {
        term: "Capture",
        detail:
          "Record a title and body (text or voice) into a Draft for one Testing set repository.",
      },
      {
        term: "Draft",
        detail:
          "A local issue-in-progress stored on this machine until you Publish it.",
      },
      {
        term: "Inbox",
        detail: "Review, edit, label, and Rewrite Drafts in the main window.",
      },
      {
        term: "Publish",
        detail:
          "Create the GitHub issue from a Draft and form the Local link to it.",
      },
      {
        term: "Local link",
        detail:
          "This install's stored association between a Draft and the remote issue it published — issue number and URL.",
      },
      {
        term: "Remote snapshot",
        detail:
          "The last-known remote title, body, and labels kept on a linked Draft after a successful Publish or update.",
      },
      {
        term: "Dirty",
        detail:
          "A linked Draft whose working title, body, or labels differ from its Remote snapshot — update it to push your edits.",
      },
    ],
  },
  {
    id: "rewrite",
    heading: "Rewrite",
    intro:
      "Rewrite proposes a clearer Draft title and body, on this device, only when you ask for it.",
    points: [
      {
        term: "Explicit, Inbox only",
        detail:
          "Rewrite runs from the Inbox on the open Draft. It never edits a Draft silently — you Accept or Discard the proposal.",
      },
      {
        term: "Rewrite style",
        detail:
          "Pick a built-in or custom style to steer the proposal; the last style you generated with is remembered.",
      },
      {
        term: "Too thin to rewrite",
        detail:
          "Rewrite stays disabled until a Draft has enough to work with — add a longer title or body.",
      },
      {
        term: "Offline",
        detail:
          "Generation runs against a local model on this machine. Draft text is not sent to a cloud service.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "rewrite-models-settings-heading",
      label: "Open Settings → Rewrite models",
    },
  },
  {
    id: "rewrite-models",
    heading: "Local Rewrite models",
    intro:
      "Issuebridge ships a curated catalog of local models and downloads them on demand — never automatically.",
    points: [
      {
        term: "Download",
        detail:
          "Each catalog entry shows its download size and a short summary in Settings before you confirm. Downloads can be cancelled; partial files are removed.",
      },
      {
        term: "Use",
        detail:
          "A downloaded and verified model can be made the active Rewrite model with Use. Only one model is active at a time.",
      },
      {
        term: "Remove",
        detail:
          "Remove deletes a model from disk to reclaim space. Removing the active model means the next Rewrite asks you to download again.",
      },
      {
        term: "Update available",
        detail:
          "A newer file for a model you already have is offered as Update available. Models are never replaced without your confirmation.",
      },
      {
        term: "Hardware changed",
        detail:
          "If this machine's capability changes, Issuebridge offers Keep (stay on your model) or Switch (move to the new recommendation). No download starts on its own.",
      },
      {
        term: "On this device",
        detail:
          "Model files and inference stay local. Downloading a model is the only network traffic Rewrite needs.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "rewrite-models-settings-heading",
      label: "Manage models in Settings → Rewrite models",
    },
  },
  {
    id: "your-machine",
    heading: "Your machine",
    intro:
      "Which model to download depends on this PC. These values are read live from Issuebridge — nothing here changes any setting.",
    points: [
      {
        term: "Hardware tier",
        detail:
          "The capability tier detected for this machine; it decides which catalog model is recommended.",
      },
      {
        term: "Recommended model",
        detail:
          "The best fit for the detected tier, with the reason it was chosen. You can still download any other catalog entry.",
      },
      {
        term: "Active model",
        detail:
          "The model Rewrite generates with today. With none active, the first Rewrite asks you to download one.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "rewrite-models-settings-heading",
      label: "Download or switch in Settings → Rewrite models",
    },
  },
  {
    id: "voice",
    heading: "Voice capture",
    intro:
      "Dictation is offline: audio is transcribed on this machine and never uploaded.",
    points: [
      {
        term: "Push-to-talk",
        detail:
          "Hold {pttHotkey} while the Capture popup is open, release to stop; the transcript lands in the Draft body.",
      },
      {
        term: "Edit after",
        detail:
          "A transcript is ordinary Draft text — correct it in the popup or later in the Inbox.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "capture-settings-heading",
      label: "Open Settings → Capture",
    },
  },
  {
    id: "testing-set",
    heading: "Testing set",
    intro:
      "The Testing set is the repositories you are testing right now; they show as fast chips in the Capture popup.",
    points: [
      {
        term: "Recommended maximum",
        detail:
          "Three repositories keep the chips fast to scan. A larger set is an explicit choice, not the default.",
      },
      {
        term: "Add all App-visible",
        detail:
          "Adds every repository the GitHub App can see, up to your maximum — useful when you test broadly.",
      },
      {
        term: "Reconcile",
        detail:
          "If the App's repository access changes, reconcile drops entries the App can no longer see.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "testing-set-settings-heading",
      label: "Open Settings → Testing set",
    },
  },
  {
    id: "labels",
    heading: "Label catalog",
    intro:
      "The Label catalog is the known GitHub labels for a repository, kept locally and refreshed when stale.",
    points: [
      {
        term: "Suggestions",
        detail:
          "The Inbox suggests labels from the target repository's catalog and uses the catalog's canonical name and color.",
      },
      {
        term: "Kept warm",
        detail:
          "Catalogs for the Testing set are fetched ahead of time so labelling works as soon as you open a Draft.",
      },
    ],
  },
  {
    id: "publish-conflicts",
    heading: "Publishing and conflicts",
    intro:
      "Publish creates the issue; updating a linked Draft pushes later edits to the same issue.",
    points: [
      {
        term: "Update",
        detail:
          "A Dirty linked Draft can push its title, body, and labels to the remote issue.",
      },
      {
        term: "Conflict",
        detail:
          "If the issue changed on GitHub since your Remote snapshot, Issuebridge stops and asks — the choice cannot be dismissed.",
      },
      {
        term: "Keep mine / Use theirs",
        detail:
          "Keep mine overwrites the remote with your Draft; Use theirs replaces your Draft with the remote text.",
      },
    ],
  },
  {
    id: "timestamps",
    heading: "Timestamps",
    intro:
      "Draft times in the Inbox follow one preference, applied everywhere at once.",
    points: [
      {
        term: "Local or UTC",
        detail:
          "Local shows this machine's time zone; UTC is handy when you paste times into an issue for someone else.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "timestamp-settings-heading",
      label: "Open Settings → Timestamps",
    },
  },
  {
    id: "appearance",
    heading: "Appearance",
    intro: "Theme applies immediately and is remembered on this machine.",
    points: [
      {
        term: "System, Light, Dark",
        detail:
          "System follows Windows; Light and Dark pin the app regardless of the Windows setting.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "appearance-heading",
      label: "Open Settings → Appearance",
    },
  },
  {
    id: "account",
    heading: "Account and setup",
    intro:
      "First-run signs you in, installs the GitHub App on the repositories you choose, and picks a Testing set.",
    points: [
      {
        term: "Sign in",
        detail:
          "Sign in with GitHub is the normal path. A personal access token is used only to identify you while installing the App.",
      },
      {
        term: "App-visible repositories",
        detail:
          "Issuebridge can only Capture into and Publish to repositories the GitHub App can see. Grant or revoke that access on GitHub.",
      },
      {
        term: "Signing out",
        detail:
          "Signing out leaves your Drafts on this machine; they are local until you Publish.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "account-heading",
      label: "Open Settings → Account",
    },
  },
  {
    id: "troubleshooting",
    heading: "Why is this greyed out?",
    intro:
      "Unavailable settings stay visible with the reason underneath, so nothing disappears from the page.",
    points: [
      {
        term: "Finish first-run setup",
        detail:
          "Account, Testing set, Capture, and Rewrite models unlock once first-run is complete.",
      },
      {
        term: "Sign in",
        detail:
          "Testing set, Capture, and Rewrite models also need a signed-in account after first-run.",
      },
      {
        term: "Rewrite disabled",
        detail:
          "A Draft with almost no title or body is too thin to rewrite — type a little more and the button returns.",
      },
    ],
    link: {
      destination: "settings",
      anchor: "settings-heading",
      label: "Open Settings",
    },
  },
  {
    id: "about",
    heading: "About",
    intro: "Issuebridge is a Windows-first desktop app, built in the open.",
    points: [
      {
        term: "Local first",
        detail:
          "Drafts, Rewrite model files, and voice transcription stay on this device until you Publish.",
      },
      {
        term: "Feedback",
        detail:
          "Missing something on this page? Open an issue — Help is the single source for how Issuebridge works.",
      },
    ],
  },
];
