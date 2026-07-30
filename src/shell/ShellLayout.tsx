import { FirstRunWorkbench } from "../firstrun/FirstRunWorkbench";
import type { AuthStateDto } from "../firstrun/types";
import { HelpPage } from "../help/HelpPage";
import { InboxWorkbench } from "../inbox/InboxWorkbench";
import type { FirstRunStep } from "../settings/gating";
import { SettingsPage } from "../settings/SettingsPage";
import type { ThemePreference } from "../theme/preference";
import type { Destination } from "./destinations";
import { type AccountAuth, Sidebar } from "./Sidebar";
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
