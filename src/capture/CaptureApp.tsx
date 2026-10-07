import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
} from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import {
  readSystemPrefersDark,
  readThemePreference,
  resolveIsDark,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../theme/preference";
import { CapturePopup } from "./CapturePopup";
import {
  type CaptureWindowSize,
  clampCaptureWindowSize,
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

    void (async () => {
      // Restore the size the user last resized Capture to, trimmed to this
      // display so a size stored on a bigger monitor cannot open the popup
      // with its actions past the bottom edge.
      let workArea: CaptureWindowSize | null = null;
      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const logical = monitor.workArea.size.toLogical(monitor.scaleFactor);
          workArea = { width: logical.width, height: logical.height };
        }
      } catch {
        // No monitor info: fall back to the minimum clamp alone.
      }
      const size = clampCaptureWindowSize(readCaptureWindowSize(), workArea);
      try {
        await win.setSize(new LogicalSize(size.width, size.height));
      } catch {
        // Ignore when not running under Tauri.
      }
    })();

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
