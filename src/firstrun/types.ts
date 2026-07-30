import type { FirstRunStep } from "../settings/gating";

export type AuthStateDto = "signed_out" | "signed_in";

export type FirstRunWizardStep = Exclude<FirstRunStep, "ready">;

export type InstallContinueOutcomeDto =
  | { kind: "no_install" }
  | { kind: "zero_repos" }
  | { kind: "ready"; all_repositories_warning: boolean };

export type RepoIdDto = { owner: string; name: string };

export const FIRST_RUN_STRIP_STEPS: Array<{
  id: FirstRunWizardStep;
  label: string;
}> = [
  { id: "sign_in", label: "Sign in" },
  { id: "install_app", label: "Install App" },
  { id: "testing_set", label: "Testing set" },
  { id: "try_capture", label: "Try capture" },
];

export function formatInvokeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`.toLowerCase();
}

/** Notify the shell of auth / first-run changes (same event as legacy main.ts). */
export function dispatchAppState(auth: AuthStateDto, step: FirstRunStep): void {
  window.dispatchEvent(
    new CustomEvent("issuebridge:app-state", { detail: { auth, step } }),
  );
}
