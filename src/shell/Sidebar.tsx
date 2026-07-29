import type { ReactElement } from "react";
import {
  Avatar,
  Button,
  Tooltip,
} from "@fluentui/react-components";
import {
  MailInboxRegular,
  QuestionCircleRegular,
  SettingsRegular,
  SignOutRegular,
} from "@fluentui/react-icons";
import type { Destination } from "./destinations";

export type AccountAuth = "signed_in" | "signed_out";

type SidebarProps = {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  auth: AccountAuth;
  /** Sign in affordance only after first-run is complete (AC #36). */
  firstRunComplete: boolean;
  accountBusy: boolean;
  onSignOut: () => void;
  onSignIn: () => void;
};

export function Sidebar({
  destination,
  onNavigate,
  auth,
  firstRunComplete,
  accountBusy,
  onSignOut,
  onSignIn,
}: SidebarProps) {
  return (
    <nav className="ib-sidebar" aria-label="Primary">
      <div className="ib-brand">
        <span className="ib-brand-mark" aria-hidden="true">
          IB
        </span>
        <span>Issuebridge</span>
      </div>

      <div className="ib-nav-primary">
        <NavItem
          label="Inbox"
          active={destination === "inbox"}
          icon={<MailInboxRegular />}
          onClick={() => onNavigate("inbox")}
        />
      </div>

      <div className="ib-nav-bottom">
        <NavItem
          label="Help"
          active={destination === "help"}
          icon={<QuestionCircleRegular />}
          onClick={() => onNavigate("help")}
        />
        <NavItem
          label="Settings"
          active={destination === "settings"}
          icon={<SettingsRegular />}
          onClick={() => onNavigate("settings")}
        />

        <div className="ib-account">
          {auth === "signed_in" ? (
            <>
              <div className="ib-account-cue">
                <Avatar name="Signed in" size={24} color="colorful" />
                <span className="ib-account-copy">
                  <strong>Signed in</strong>
                  <small>GitHub</small>
                </span>
              </div>
              <Button
                appearance="subtle"
                icon={<SignOutRegular />}
                disabled={accountBusy}
                onClick={onSignOut}
              >
                Sign out
              </Button>
            </>
          ) : firstRunComplete ? (
            <Button
              appearance="primary"
              disabled={accountBusy}
              onClick={onSignIn}
            >
              Sign in
            </Button>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

function NavItem({
  label,
  active,
  icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: ReactElement;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} relationship="label" positioning="after">
      <button
        type="button"
        className={`ib-nav-item${active ? " active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
      >
        {icon}
        <span>{label}</span>
      </button>
    </Tooltip>
  );
}
