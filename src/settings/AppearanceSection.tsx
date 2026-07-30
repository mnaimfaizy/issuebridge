import {
  Body1,
  Label,
  Radio,
  RadioGroup,
  Subtitle2,
} from "@fluentui/react-components";
import type { ThemePreference } from "../theme/preference";

type AppearanceSectionProps = {
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
};

/** Settings → Appearance: theme applies immediately. */
export function AppearanceSection({
  themePreference,
  onThemePreferenceChange,
}: AppearanceSectionProps) {
  return (
    <section className="ib-settings-block" aria-labelledby="appearance-heading">
      <Subtitle2 as="h2" id="appearance-heading">
        Appearance
      </Subtitle2>
      <Body1>Theme applies immediately.</Body1>
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
    </section>
  );
}
