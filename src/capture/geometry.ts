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
 *
 * Judged per dimension, because a pre-#205 resize was stored even though it was
 * never applied: widening the cramped popup to see the clipped chips and leaving
 * the height alone stores a width the user chose next to a height they did not.
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
    return {
      width: storedDimension(
        width,
        CAPTURE_PRE_RESTORE_SIZE.width,
        CAPTURE_DEFAULT_SIZE.width,
        CAPTURE_MIN_SIZE.width,
      ),
      height: storedDimension(
        height,
        CAPTURE_PRE_RESTORE_SIZE.height,
        CAPTURE_DEFAULT_SIZE.height,
        CAPTURE_MIN_SIZE.height,
      ),
    };
  } catch {
    return { ...CAPTURE_DEFAULT_SIZE };
  }
}

/**
 * One dimension of a stored size, or `fallback` where the stored value is at or
 * below what Capture opened at before the restore worked and so cannot have been
 * chosen. Never below `min`, the floor the window enforces.
 */
function storedDimension(
  value: number,
  preRestore: number,
  fallback: number,
  min: number,
): number {
  if (value <= preRestore) return fallback;
  return Math.max(min, Math.round(value));
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

/** What the restore was doing when a `Resized` arrived. */
export type CaptureResizeContext = {
  /** Whether the restore still owned the window size as of the event. */
  duringRestore: boolean;
  /** The inner size the restore asked the window for, once it has asked. */
  restoreSize?: CaptureWindowSize | null;
};

/**
 * Whether a `Resized` payload is a size the user chose, and so worth storing.
 *
 * Two things separate the restore's own resize from the user's, and neither is a
 * clock. `duringRestore` covers the span the restore owns the size: the window
 * is interactive from creation and the restore takes several IPC round-trips, so
 * every resize in it is either the restore's own — a fit for this monitor, not a
 * choice the user made — or one the restore then overrides. `restoreSize` covers
 * what follows: the `Resized` that `setSize` causes makes its own trip back to
 * the webview and can land after the call has resolved, with nothing but the
 * size left to recognise it by. Storing it would replace the stored size with
 * the display clamp's trim, silently and for good — the next open clamps the
 * trimmed value again, so the size the user chose never comes back.
 *
 * Matching on `restoreSize` is not the size-matched guard this replaced: that
 * one armed itself until a match arrived, and a `setSize` landing on the current
 * size emits no event at all, so it stayed armed for the window's life. This is
 * a standing rule with no state to go stale. Its cost is a resize the user makes
 * to within a pixel of the size the restore just gave them, which on this display
 * is the size the stored value already clamps to; on a larger monitor they keep
 * the bigger size they had. That is the safe direction.
 *
 * Windows reports `{0, 0}` on minimise. Storing that floors to
 * `CAPTURE_MIN_SIZE` and replaces whatever size the user had chosen, for good
 * if Capture is minimised when the app quits.
 */
export function isStorableCaptureSize(
  size: CaptureWindowSize,
  context: CaptureResizeContext,
): boolean {
  if (context.duringRestore) return false;
  if (context.restoreSize && isSameCaptureSize(size, context.restoreSize)) {
    return false;
  }
  return (
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

/**
 * Whether two sizes are the same window size, give or take a pixel.
 *
 * A `Resized` payload is physical and divided by the scale factor to compare, so
 * a size the window took exactly can come back a fraction off at a non-integer
 * scale factor. A pixel of slack keeps that rounding from reading as a resize.
 */
function isSameCaptureSize(
  a: CaptureWindowSize,
  b: CaptureWindowSize,
): boolean {
  return Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
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
