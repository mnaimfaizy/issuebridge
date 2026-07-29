/** localStorage key for Capture popup outer size. */
export const CAPTURE_SIZE_STORAGE_KEY = "issuebridge.captureWindowSize";

export type CaptureWindowSize = { width: number; height: number };

export const CAPTURE_DEFAULT_SIZE: CaptureWindowSize = {
  width: 420,
  height: 520,
};

export const CAPTURE_MIN_SIZE: CaptureWindowSize = {
  width: 360,
  height: 420,
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
