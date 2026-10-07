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
 * `CAPTURE_MIN_SIZE` is the floor even where the work area is genuinely smaller
 * — a small display at a high scale factor. It mirrors `min_inner_size`, which
 * Windows enforces on the `SetWindowPos` behind `setSize`, so a smaller result
 * could never reach the window: it would be raised back to the minimum, and the
 * resize that followed would not match what the caller asked for, which is how
 * the restore's own resize ends up stored as if the user had chosen it. The
 * overhang on a work area shorter than the minimum is not something this
 * function can trim away — only a lower `min_inner_size` could.
 *
 * A missing or nonsensical work area (or frame) leaves the size untouched.
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
    width: fitToDisplay(
      width,
      workArea.width,
      frame?.width,
      CAPTURE_MIN_SIZE.width,
    ),
    height: fitToDisplay(
      height,
      workArea.height,
      frame?.height,
      CAPTURE_MIN_SIZE.height,
    ),
  };
}

/**
 * The inner extent `want` trimmed to an outer `area`, less the `chrome` around
 * the client area, and never below `min`. A chrome that is missing, negative or
 * wider than the display itself is ignored rather than trusted, and `min` keeps
 * a bogus measurement — or a display smaller than the popup's own floor — from
 * asking for a size the window is not allowed to take.
 */
function fitToDisplay(
  want: number,
  area: number,
  chrome: number | undefined,
  min: number,
): number {
  const frame =
    typeof chrome === "number" && chrome > 0 && chrome < area ? chrome : 0;
  return Math.max(min, Math.min(want, Math.round(area - frame)));
}

/**
 * Whether a `Resized` payload is a size the user chose, and so worth storing.
 *
 * `duringRestore` is provenance, and it is the only thing that can separate the
 * restore's own resize from the user's. Matching on size cannot: the restore's
 * request is raised to `min_inner_size` before it lands, so the resize that
 * comes back is not the size that was asked for, and a snap or a DPI change can
 * repeat a size the restore already used. Provenance also cannot go stale —
 * a `setSize` that lands on the current size emits no event at all, which left
 * a size-matched guard armed for the rest of the window's life.
 *
 * Windows reports `{0, 0}` on minimise. Storing that floors to
 * `CAPTURE_MIN_SIZE` and replaces whatever size the user had chosen, for good
 * if Capture is minimised when the app quits.
 */
export function isStorableCaptureSize(
  size: CaptureWindowSize,
  duringRestore: boolean,
): boolean {
  if (duringRestore) return false;
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
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
