import { useEffect, useState } from "react";
import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  THEME_STORAGE_KEY,
  readSystemPrefersDark,
  readThemePreference,
  resolveIsDark,
  type ThemePreference,
} from "../theme/preference";
import { CapturePopup } from "./CapturePopup";
import {
  readCaptureWindowSize,
  writeCaptureWindowSize,
} from "./geometry";

export function CaptureApp() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const [systemDark, setSystemDark] = useState(() => readSystemPrefersDark());

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const refreshTheme = () => {
      setThemePreference(readThemePreference());
      setSystemDark(readSystemPrefersDark());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        refreshTheme();
      }
    };
    window.addEventListener("focus", refreshTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", refreshTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const win = getCurrentWindow();
    const size = readCaptureWindowSize();
    void win
      .setSize(new LogicalSize(size.width, size.height))
      .catch(() => {
        // Ignore when not running under Tauri.
      });

    void (async () => {
      try {
        unlisten = await win.onResized(async ({ payload }) => {
          try {
            const factor = await win.scaleFactor();
            writeCaptureWindowSize({
              width: payload.width / factor,
              height: payload.height / factor,
            });
          } catch {
            writeCaptureWindowSize({
              width: payload.width,
              height: payload.height,
            });
          }
        });
      } catch {
        // Ignore when not running under Tauri.
      }
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  const isDark = resolveIsDark(themePreference, systemDark);

  return (
    <FluentProvider theme={isDark ? webDarkTheme : webLightTheme}>
      <div className={`ib-capture-root theme-${isDark ? "dark" : "light"}`}>
        <CapturePopup />
      </div>
    </FluentProvider>
  );
}
