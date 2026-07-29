import { Body1, Title3 } from "@fluentui/react-components";
import type { AccountAuth } from "../shell/Sidebar";
import type { ThemePreference } from "../theme/preference";
import { AccountSection } from "./AccountSection";
import { AppearanceSection } from "./AppearanceSection";
import { CaptureSection } from "./CaptureSection";
import { TestingSetSection } from "./TestingSetSection";
import type { FirstRunStep } from "./gating";

type SettingsPageProps = {
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  auth: AccountAuth;
  firstRunStep: FirstRunStep;
  firstRunComplete: boolean;
  accountBusy: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
};

/** Full-page Settings destination: Appearance, Account, Testing set, Capture. */
export function SettingsPage({
  themePreference,
  onThemePreferenceChange,
  auth,
  firstRunStep,
  firstRunComplete,
  accountBusy,
  onSignOut,
  onSignIn,
}: SettingsPageProps) {
  return (
    <section className="ib-destination" aria-labelledby="settings-heading">
      <header className="ib-destination-header">
        <Title3 as="h1" id="settings-heading">
          Settings
        </Title3>
        <Body1>Changes apply immediately.</Body1>
      </header>

      <AppearanceSection
        themePreference={themePreference}
        onThemePreferenceChange={onThemePreferenceChange}
      />
      <AccountSection
        auth={auth}
        firstRunStep={firstRunStep}
        firstRunComplete={firstRunComplete}
        accountBusy={accountBusy}
        onSignOut={onSignOut}
        onSignIn={onSignIn}
      />
      <TestingSetSection auth={auth} firstRunComplete={firstRunComplete} />
      <CaptureSection auth={auth} firstRunComplete={firstRunComplete} />
    </section>
  );
}
