import { useState } from "react";
import {
  Body1,
  Button,
  Caption1,
  Subtitle2,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import type { AccountAuth } from "../shell/Sidebar";
import {
  accountSettingsHelper,
  isAccountSettingsEnabled,
  isAppInstalled,
  type FirstRunStep,
} from "./gating";

type AccountSectionProps = {
  auth: AccountAuth;
  firstRunStep: FirstRunStep;
  firstRunComplete: boolean;
  accountBusy: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
};

/** Settings → Account: status, Sign out / Sign in, Manage on GitHub when installed. */
export function AccountSection({
  auth,
  firstRunStep,
  firstRunComplete,
  accountBusy,
  onSignOut,
  onSignIn,
}: AccountSectionProps) {
  const [manageBusy, setManageBusy] = useState(false);
  const enabled = isAccountSettingsEnabled(firstRunComplete);
  const helper = accountSettingsHelper(firstRunComplete);
  const showManage =
    enabled && auth === "signed_in" && isAppInstalled(firstRunStep);

  async function handleManageOnGitHub() {
    setManageBusy(true);
    try {
      await invoke("open_app_install");
    } catch (error) {
      console.error("[issuebridge] open_app_install failed", error);
    } finally {
      setManageBusy(false);
    }
  }

  return (
    <section
      className={`ib-settings-block${enabled ? "" : " ib-settings-block--gated"}`}
      aria-labelledby="account-heading"
      aria-disabled={!enabled}
    >
      <Subtitle2 as="h2" id="account-heading">
        Account
      </Subtitle2>
      {helper ? (
        <Caption1 className="ib-settings-helper">{helper}</Caption1>
      ) : null}
      {auth === "signed_in" ? (
        <>
          <Body1>Signed in with GitHub.</Body1>
          <div className="ib-settings-actions">
            <Button
              appearance="secondary"
              disabled={!enabled || accountBusy}
              onClick={onSignOut}
            >
              Sign out
            </Button>
            <Button
              appearance="subtle"
              disabled={!showManage || manageBusy}
              onClick={() => void handleManageOnGitHub()}
            >
              Manage on GitHub
            </Button>
          </div>
        </>
      ) : (
        <>
          <Body1>
            {enabled
              ? "Signed out. Sign in to Publish and edit your Testing set."
              : "Signed out."}
          </Body1>
          <div className="ib-settings-actions">
            <Button
              appearance="primary"
              disabled={!enabled || accountBusy}
              onClick={onSignIn}
            >
              Sign in
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
