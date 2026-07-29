export type VoiceKind =
  | "permission_denied"
  | "no_device"
  | "sidecar_failed"
  | "empty_transcript";

export const VOICE_MESSAGES: Record<VoiceKind, string> = {
  permission_denied:
    "Voice needs microphone access. Allow Issuebridge in Windows privacy settings, or type instead.",
  no_device: "No microphone found. Plug one in or type instead.",
  sidecar_failed:
    "Voice could not run (Whisper sidecar). Check the terminal for [issuebridge] whisper logs, or type instead.",
  empty_transcript:
    "Didn’t catch that. Hold a bit longer, speak clearly, then release — or type.",
};

export function mapMicError(error: unknown): VoiceKind {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: string }).name)
      : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "no_device";
  }
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "permission_denied";
  }
  return "sidecar_failed";
}

export function parseVoiceKind(error: unknown): VoiceKind {
  const text = String(error);
  if (text.includes("permission_denied")) return "permission_denied";
  if (text.includes("no_device")) return "no_device";
  if (text.includes("empty_transcript")) return "empty_transcript";
  if (text.includes("EncodingError") || text.includes("decode")) {
    return "empty_transcript";
  }
  if (text.includes("sidecar_failed")) return "sidecar_failed";
  return "sidecar_failed";
}
