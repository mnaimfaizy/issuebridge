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

/** The same window size, give or take the rounding a DPI round-trip adds. */
function isSameSize(a: CaptureWindowSize, b: CaptureWindowSize): boolean {
  return Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
}

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

    // Read the stored size before the awaits below. A `Resized` event arriving
    // while the restore is still in flight — window show, a DPI change, the
    // user grabbing an edge — would otherwise persist the size Capture opened
    // at over the stored one before it has been read, losing it for good.
    const stored = readCaptureWindowSize();
    // Set while the restore's own resize is outstanding, and only when the
    // display clamp trimmed the stored size: that trim is a fit for this
    // monitor, not a decision the user made, so it must not be written back.
    let trimmedTo: CaptureWindowSize | null = null;

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
      // What the title bar and borders add around the client area. The size
      // below is an inner size and the work area is outer space, so without
      // this the window lands a title bar taller than the work area.
      let frame: CaptureWindowSize | null = null;
      try {
        const factor = await win.scaleFactor();
        const outer = (await win.outerSize()).toLogical(factor);
        const inner = (await win.innerSize()).toLogical(factor);
        frame = {
          width: outer.width - inner.width,
          height: outer.height - inner.height,
        };
      } catch {
        // No window metrics: clamp against the work area alone.
      }
      const size = clampCaptureWindowSize(stored, workArea, frame);
      trimmedTo = isSameSize(size, stored) ? null : size;
      try {
        await win.setSize(new LogicalSize(size.width, size.height));
      } catch {
        // Ignore when not running under Tauri.
        trimmedTo = null;
      }
    })();

    void (async () => {
      try {
        unlisten = await win.onResized(async ({ payload }) => {
          let size = { width: payload.width, height: payload.height };
          try {
            const factor = await win.scaleFactor();
            size = {
              width: payload.width / factor,
              height: payload.height / factor,
            };
          } catch {
            // No scale factor: the physical size is the best guess available.
          }
          if (trimmedTo && isSameSize(size, trimmedTo)) {
            trimmedTo = null;
            // The restore's own resize, not the user's. Re-assert the stored
            // size, in case an earlier event already overwrote it.
            writeCaptureWindowSize(stored);
            return;
          }
          writeCaptureWindowSize(size);
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
