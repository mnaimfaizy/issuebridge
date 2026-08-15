/**
 * Help coverage manifest — the input to `scripts/help-coverage.mjs`.
 *
 * Every user-facing surface (a Settings section, a Destination, a Tauri
 * command) must appear here exactly once, either mapped to a Help topic in
 * `helpContent.ts` or explicitly opted out. Opting out is allowed; silence is
 * not. Add a feature, add a row — the check fails otherwise.
 */

export type HelpCoverageStatus = "covered" | "intentionally-not-user-facing";

export type HelpCoverageEntry = {
  /** `settings:<Component>`, `destination:<id>`, or `command:<name>`. */
  surface: string;
  status: HelpCoverageStatus;
  /** Required when status is `covered`: a topic id from `helpContent.ts`. */
  topicId?: string;
  /** Required when status is `intentionally-not-user-facing`: why. */
  note?: string;
};

export const HELP_COVERAGE: HelpCoverageEntry[] = [
  // Destinations
  { surface: "destination:inbox", status: "covered", topicId: "how-it-works" },
  {
    surface: "destination:settings",
    status: "covered",
    topicId: "troubleshooting",
  },
  { surface: "destination:help", status: "covered", topicId: "about" },

  // Settings sections
  {
    surface: "settings:AppearanceSection",
    status: "covered",
    topicId: "appearance",
  },
  { surface: "settings:AccountSection", status: "covered", topicId: "account" },
  {
    surface: "settings:TestingSetSection",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "settings:CaptureSection",
    status: "covered",
    topicId: "shortcuts",
  },
  {
    surface: "settings:TimestampSection",
    status: "covered",
    topicId: "timestamps",
  },
  {
    surface: "settings:RewriteModelsSection",
    status: "covered",
    topicId: "rewrite-models",
  },

  // Account and first-run commands
  {
    surface: "command:auth_state",
    status: "intentionally-not-user-facing",
    note: "Reads sign-in state for the shell; no separate user action.",
  },
  {
    surface: "command:validate_session",
    status: "intentionally-not-user-facing",
    note: "Background token validation on launch.",
  },
  {
    surface: "command:first_run_step",
    status: "intentionally-not-user-facing",
    note: "Routes the first-run workbench; the steps themselves are covered.",
  },
  {
    surface: "command:sign_in_with_pat",
    status: "covered",
    topicId: "account",
  },
  { surface: "command:sign_out", status: "covered", topicId: "account" },
  {
    surface: "command:sign_in_with_github",
    status: "covered",
    topicId: "account",
  },
  {
    surface: "command:open_app_install",
    status: "covered",
    topicId: "account",
  },
  {
    surface: "command:continue_install",
    status: "covered",
    topicId: "account",
  },
  {
    surface: "command:complete_testing_set",
    status: "covered",
    topicId: "account",
  },
  {
    surface: "command:skip_try_capture",
    status: "covered",
    topicId: "account",
  },

  // Testing set commands
  {
    surface: "command:app_visible_repos",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "command:all_repositories_warning",
    status: "covered",
    topicId: "testing-set",
  },
  { surface: "command:testing_set", status: "covered", topicId: "testing-set" },
  {
    surface: "command:add_testing_set_repo",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "command:remove_testing_set_repo",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "command:testing_set_max",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "command:set_testing_set_max",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "command:add_all_app_visible_to_testing_set",
    status: "covered",
    topicId: "testing-set",
  },
  {
    surface: "command:reconcile_testing_set_with_app_visible",
    status: "covered",
    topicId: "testing-set",
  },

  // Capture, Draft, Inbox commands
  {
    surface: "command:save_capture",
    status: "covered",
    topicId: "how-it-works",
  },
  { surface: "command:list_inbox", status: "covered", topicId: "how-it-works" },
  { surface: "command:edit_draft", status: "covered", topicId: "how-it-works" },
  {
    surface: "command:get_draft",
    status: "intentionally-not-user-facing",
    note: "Loads the open Draft for the Inbox; not a distinct user action.",
  },
  {
    surface: "command:last_used_repo",
    status: "intentionally-not-user-facing",
    note: "Preselects the Capture popup repo chip.",
  },
  { surface: "command:show_capture", status: "covered", topicId: "shortcuts" },
  { surface: "command:ptt_hotkey", status: "covered", topicId: "shortcuts" },
  { surface: "command:apply_ptt", status: "covered", topicId: "voice" },
  {
    surface: "command:ensure_label_catalog",
    status: "covered",
    topicId: "labels",
  },
  {
    surface: "command:prefetch_testing_set_label_catalogs",
    status: "intentionally-not-user-facing",
    note: "Warms Label catalogs in the background; covered by the labels topic.",
  },

  // Publish and conflict commands
  {
    surface: "command:publish_draft",
    status: "covered",
    topicId: "publish-conflicts",
  },
  {
    surface: "command:update_linked_draft",
    status: "covered",
    topicId: "publish-conflicts",
  },
  {
    surface: "command:keep_mine",
    status: "covered",
    topicId: "publish-conflicts",
  },
  {
    surface: "command:use_theirs",
    status: "covered",
    topicId: "publish-conflicts",
  },

  // Timestamp commands
  {
    surface: "command:get_timestamp_display",
    status: "covered",
    topicId: "timestamps",
  },
  {
    surface: "command:save_timestamp_display",
    status: "covered",
    topicId: "timestamps",
  },

  // Rewrite commands
  {
    surface: "command:list_rewrite_styles",
    status: "covered",
    topicId: "rewrite",
  },
  {
    surface: "command:add_custom_rewrite_style",
    status: "covered",
    topicId: "rewrite",
  },
  {
    surface: "command:remove_custom_rewrite_style",
    status: "covered",
    topicId: "rewrite",
  },
  {
    surface: "command:generate_rewrite",
    status: "covered",
    topicId: "rewrite",
  },
  { surface: "command:cancel_rewrite", status: "covered", topicId: "rewrite" },
  {
    surface: "command:remember_last_rewrite_style",
    status: "covered",
    topicId: "rewrite",
  },

  // Rewrite model commands
  {
    surface: "command:get_rewrite_model_status",
    status: "covered",
    topicId: "your-machine",
  },
  {
    surface: "command:respond_rewrite_hardware_prompt",
    status: "covered",
    topicId: "rewrite-models",
  },
  {
    surface: "command:start_rewrite_model_download",
    status: "covered",
    topicId: "rewrite-models",
  },
  {
    surface: "command:cancel_rewrite_model_download",
    status: "covered",
    topicId: "rewrite-models",
  },
  {
    surface: "command:set_active_rewrite_model",
    status: "covered",
    topicId: "rewrite-models",
  },
  {
    surface: "command:remove_rewrite_model",
    status: "covered",
    topicId: "rewrite-models",
  },
];
