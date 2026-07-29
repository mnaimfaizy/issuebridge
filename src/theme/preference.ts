export type ThemePreference = "system" | "light" | "dark";

/** localStorage key for the user's Appearance theme preference. */
export const THEME_STORAGE_KEY = "issuebridge.themePreference";

export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    // Ignore storage failures (private mode); default System.
  }
  return "system";
}

export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Ignore storage failures; live theme still updates in-memory.
  }
}

/** Resolve whether the shell should use the dark Fluent theme. */
export function resolveIsDark(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): boolean {
  if (preference === "dark") return true;
  if (preference === "light") return false;
  // System follows prefers-color-scheme.
  return systemPrefersDark;
}

export function readSystemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
