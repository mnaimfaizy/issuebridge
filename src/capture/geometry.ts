/** localStorage key for the Capture popup's inner (client) size, in logical pixels. */
export const CAPTURE_SIZE_STORAGE_KEY = "issuebridge.captureWindowSize";

export type CaptureWindowSize = { width: number; height: number };

/**
 * Must match `inner_size` in `src-tauri/src/adapters/capture_window.rs`, which
 * is the source of truth for the size Capture opens at. The popup contract test
 * parses both and fails if they drift.
 */
export const CAPTURE_DEFAULT_SIZE: CaptureWindowSize = {
  width: 460,
  height: 640,
};

/** Must match `min_inner_size` in `src-tauri/src/adapters/capture_window.rs`. */
export const CAPTURE_MIN_SIZE: CaptureWindowSize = {
  width: 400,
  height: 560,
};

/**
 * The size Capture opened at before #205.
 *
 * Restoring a stored size never worked back then — `setSize` was rejected by the
 * ACL — so a stored value at or below this one is the window an install happened
 * to get, not a size anyone chose. Honouring it now would reopen Capture too
 * small for its own content, which is exactly what #205 reports, so it is
 * dropped in favour of `CAPTURE_DEFAULT_SIZE`.
 */
const CAPTURE_PRE_RESTORE_SIZE: CaptureWindowSize = {
  width: 420,
  height: 520,
};

export function readCaptureWindowSize(): CaptureWindowSize {
  try {
    const raw = localStorage.getItem(CAPTURE_SIZE_STORAGE_KEY);
    if (!raw) return { ...CAPTURE_DEFAULT_SIZE };
    const parsed = JSON.parse(raw) as Partial<CaptureWindowSize>;
    const width = Number(parsed.width);
    const height = Number(parsed.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return { ...CAPTURE_DEFAULT_SIZE };
    }
    if (
      width <= CAPTURE_PRE_RESTORE_SIZE.width &&
      height <= CAPTURE_PRE_RESTORE_SIZE.height
    ) {
      return { ...CAPTURE_DEFAULT_SIZE };
    }
    return {
      width: Math.max(CAPTURE_MIN_SIZE.width, Math.round(width)),
      height: Math.max(CAPTURE_MIN_SIZE.height, Math.round(height)),
    };
  } catch {
    return { ...CAPTURE_DEFAULT_SIZE };
  }
}

/**
 * `size` trimmed to what fits on this display, in logical pixels.
 *
 * A stored size travels with the install: a size saved on a large monitor would
 * otherwise reopen Capture larger than a small laptop screen, with the actions
 * off the bottom edge.
 *
 * `size` is an inner (client) size — what `setSize` takes — while a work area is
 * outer space, so `frame` is the width and height the title bar and borders add
 * around the client area. Without subtracting it the window ends up a title bar
 * taller than the work area, which puts the actions back under the taskbar.
 *
 * Where the work area is genuinely smaller than `CAPTURE_MIN_SIZE` — a small
 * display at a high scale factor — fitting the display wins over the minimum:
 * the compose region scrolls at that size and the hero and actions stay put,
 * whereas honouring the minimum hides the actions off the bottom edge with no
 * way for the user to resize back. A missing or nonsensical work area (or
 * frame) leaves the size untouched.
 */
export function clampCaptureWindowSize(
  size: CaptureWindowSize,
  workArea?: CaptureWindowSize | null,
  frame?: CaptureWindowSize | null,
): CaptureWindowSize {
  const width = Math.max(CAPTURE_MIN_SIZE.width, Math.round(size.width));
  const height = Math.max(CAPTURE_MIN_SIZE.height, Math.round(size.height));
  if (
    !workArea ||
    !Number.isFinite(workArea.width) ||
    !Number.isFinite(workArea.height) ||
    workArea.width <= 0 ||
    workArea.height <= 0
  ) {
    return { width, height };
  }
  return {
    width: fitToDisplay(width, workArea.width, frame?.width),
    height: fitToDisplay(height, workArea.height, frame?.height),
  };
}

/**
 * The inner extent `want` trimmed to an outer `area`, less the `chrome` around
 * the client area. A chrome that is missing, negative or wider than the display
 * itself is ignored rather than trusted, and at least one pixel is left, so a
 * bogus measurement cannot clamp the popup out of existence.
 */
function fitToDisplay(want: number, area: number, chrome?: number): number {
  const frame =
    typeof chrome === "number" && chrome > 0 && chrome < area ? chrome : 0;
  return Math.min(want, Math.max(1, Math.round(area - frame)));
}

export function writeCaptureWindowSize(size: CaptureWindowSize): void {
  try {
    localStorage.setItem(
      CAPTURE_SIZE_STORAGE_KEY,
      JSON.stringify({
        width: Math.max(CAPTURE_MIN_SIZE.width, Math.round(size.width)),
        height: Math.max(CAPTURE_MIN_SIZE.height, Math.round(size.height)),
      }),
    );
  } catch {
    // Ignore storage failures; live size still works in-memory.
  }
}
