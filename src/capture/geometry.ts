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
 * off the bottom edge. The minimum still wins over the work area, because
 * shrinking below it would scroll the compose region instead of hiding the
 * actions. A missing or nonsensical work area leaves the size untouched.
 */
export function clampCaptureWindowSize(
  size: CaptureWindowSize,
  workArea?: CaptureWindowSize | null,
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
    width: Math.max(CAPTURE_MIN_SIZE.width, Math.min(width, workArea.width)),
    height: Math.max(
      CAPTURE_MIN_SIZE.height,
      Math.min(height, workArea.height),
    ),
  };
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
