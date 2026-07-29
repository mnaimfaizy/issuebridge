/** Soft-clear delay for success MessageBars (~3s). */
export const SUCCESS_CLEAR_MS = 3000;

export type StatusKind = "busy" | "error" | "success";

export type StatusState = {
  kind: StatusKind;
  message: string;
} | null;

/** Clear a success bar on next edit (MessageBars are not persisted). */
export function clearSuccessOnEdit(status: StatusState): StatusState {
  if (status?.kind === "success") return null;
  return status;
}
