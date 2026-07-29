import { Label, Radio, RadioGroup, Title3, Body1 } from "@fluentui/react-components";
import type { ThemePreference } from "../theme/preference";

type AppearancePageProps = {
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
};

/** Minimal Settings → Appearance for shell slice; full Settings lands later. */
export function AppearancePage({
  themePreference,
  onThemePreferenceChange,
}: AppearancePageProps) {
  return (
    <section className="ib-destination" aria-labelledby="settings-heading">
      <header className="ib-destination-header">
        <Title3 as="h1" id="settings-heading">
          Settings
        </Title3>
        <Body1>Appearance applies immediately.</Body1>
      </header>

      <div className="ib-settings-block">
        <Label weight="semibold" id="theme-label">
          Theme
        </Label>
        <RadioGroup
          aria-labelledby="theme-label"
          value={themePreference}
          onChange={(_, data) =>
            onThemePreferenceChange(data.value as ThemePreference)
          }
        >
          <Radio value="system" label="System" />
          <Radio value="light" label="Light" />
          <Radio value="dark" label="Dark" />
        </RadioGroup>
      </div>
    </section>
  );
}
