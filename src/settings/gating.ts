import type { AccountAuth } from "../shell/Sidebar";

export type FirstRunStep =
  | "sign_in"
  | "install_app"
  | "testing_set"
  | "try_capture"
  | "ready";

/** App install finished — Manage on GitHub unlocks once first-run can reach Testing set. */
export function isAppInstalled(step: FirstRunStep): boolean {
  return step === "testing_set" || step === "try_capture" || step === "ready";
}

/**
 * Settings categories other than Appearance stay gated until first-run is
 * complete (#28 progressive Settings). Post first-run, Testing set / Capture /
 * Rewrite models also require signed-in.
 */
export function isAccountSettingsEnabled(firstRunComplete: boolean): boolean {
  return firstRunComplete;
}

export function isTestingSetEditable(
  auth: AccountAuth,
  firstRunComplete: boolean,
): boolean {
  return auth === "signed_in" && firstRunComplete;
}

export function isCaptureSettingsEnabled(
  auth: AccountAuth,
  firstRunComplete: boolean,
): boolean {
  return auth === "signed_in" && firstRunComplete;
}

export function isRewriteModelsSettingsEnabled(
  auth: AccountAuth,
  firstRunComplete: boolean,
): boolean {
  return auth === "signed_in" && firstRunComplete;
}

export function accountSettingsHelper(
  firstRunComplete: boolean,
): string | null {
  if (isAccountSettingsEnabled(firstRunComplete)) return null;
  return "Finish first-run setup to manage your account here. Sign out stays in the sidebar.";
}

export function testingSetHelper(
  auth: AccountAuth,
  firstRunComplete: boolean,
): string | null {
  if (isTestingSetEditable(auth, firstRunComplete)) return null;
  if (!firstRunComplete) {
    return "Finish first-run setup to edit your Testing set here.";
  }
  return "Sign in to edit your Testing set.";
}

export function captureSettingsHelper(
  auth: AccountAuth,
  firstRunComplete: boolean,
): string | null {
  if (isCaptureSettingsEnabled(auth, firstRunComplete)) return null;
  if (!firstRunComplete) {
    return "Finish first-run setup to view Capture settings.";
  }
  return "Sign in to view Capture settings.";
}

export function rewriteModelsSettingsHelper(
  auth: AccountAuth,
  firstRunComplete: boolean,
): string | null {
  if (isRewriteModelsSettingsEnabled(auth, firstRunComplete)) return null;
  if (!firstRunComplete) {
    return "Finish first-run setup to manage Rewrite models here.";
  }
  return "Sign in to manage Rewrite models.";
}
