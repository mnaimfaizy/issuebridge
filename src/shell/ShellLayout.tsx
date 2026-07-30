import { Sidebar, type AccountAuth } from "./Sidebar";
import type { Destination } from "./destinations";
import { LegacyWorkspaceHost } from "./LegacyWorkspaceHost";
import { SettingsPage } from "../settings/SettingsPage";
import type { FirstRunStep } from "../settings/gating";
import { HelpPage } from "../help/HelpPage";
import { InboxWorkbench } from "../inbox/InboxWorkbench";
import { FirstRunWorkbench } from "../firstrun/FirstRunWorkbench";
import type { AuthStateDto } from "../firstrun/types";
import type { ThemePreference } from "../theme/preference";
import "./shell.css";

type ShellLayoutProps = {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  auth: AccountAuth;
  firstRunStep: FirstRunStep;
  firstRunComplete: boolean;
  accountBusy: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
  onFirstRunChange: (auth: AuthStateDto, step: FirstRunStep) => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
};

export function ShellLayout({
  destination,
  onNavigate,
  auth,
  firstRunStep,
  firstRunComplete,
  accountBusy,
  onSignOut,
  onSignIn,
  onFirstRunChange,
  themePreference,
  onThemePreferenceChange,
}: ShellLayoutProps) {
  const showInboxWorkbench = destination === "inbox" && firstRunComplete;
  const showFirstRun = destination === "inbox" && !firstRunComplete;

  return (
    <div className="ib-shell">
      <Sidebar
        destination={destination}
        onNavigate={onNavigate}
        auth={auth}
        firstRunComplete={firstRunComplete}
        accountBusy={accountBusy}
        onSignOut={onSignOut}
        onSignIn={onSignIn}
      />
      <div className="ib-content" role="main">
        {showInboxWorkbench ? <InboxWorkbench /> : null}
        {showFirstRun ? (
          <FirstRunWorkbench
            step={firstRunStep}
            onStepChange={onFirstRunChange}
          />
        ) : null}
        {/* Conflict modal host for slice 5; Update conflicts use Inbox ConflictDialog. */}
        <LegacyWorkspaceHost visible={false} />
        {destination === "settings" && (
          <SettingsPage
            themePreference={themePreference}
            onThemePreferenceChange={onThemePreferenceChange}
            auth={auth}
            firstRunStep={firstRunStep}
            firstRunComplete={firstRunComplete}
            accountBusy={accountBusy}
            onSignOut={onSignOut}
            onSignIn={onSignIn}
          />
        )}
        {destination === "help" && <HelpPage />}
      </div>
    </div>
  );
}
