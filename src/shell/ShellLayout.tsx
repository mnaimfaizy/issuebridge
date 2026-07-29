import { Sidebar, type AccountAuth } from "./Sidebar";
import type { Destination } from "./destinations";
import { LegacyWorkspaceHost } from "./LegacyWorkspaceHost";
import { AppearancePage } from "../settings/AppearancePage";
import { HelpPage } from "../help/HelpPage";
import type { ThemePreference } from "../theme/preference";
import "./shell.css";

type ShellLayoutProps = {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  auth: AccountAuth;
  firstRunComplete: boolean;
  accountBusy: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
};

export function ShellLayout({
  destination,
  onNavigate,
  auth,
  firstRunComplete,
  accountBusy,
  onSignOut,
  onSignIn,
  themePreference,
  onThemePreferenceChange,
}: ShellLayoutProps) {
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
        <LegacyWorkspaceHost visible={destination === "inbox"} />
        {destination === "settings" && (
          <AppearancePage
            themePreference={themePreference}
            onThemePreferenceChange={onThemePreferenceChange}
          />
        )}
        {destination === "help" && <HelpPage />}
      </div>
    </div>
  );
}
