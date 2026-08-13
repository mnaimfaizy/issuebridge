import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { AuthStateDto } from "./firstrun/types";
import { dispatchAppState } from "./firstrun/types";
import type { FirstRunStep } from "./settings/gating";
import type { Destination } from "./shell/destinations";
import { ShellLayout } from "./shell/ShellLayout";
import type { AccountAuth } from "./shell/Sidebar";
import {
  readSystemPrefersDark,
  readThemePreference,
  resolveIsDark,
  type ThemePreference,
  writeThemePreference,
} from "./theme/preference";

type FirstRunStepDto = FirstRunStep;

export function App() {
  const [destination, setDestination] = useState<Destination>("inbox");
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const [systemDark, setSystemDark] = useState(() => readSystemPrefersDark());
  const [auth, setAuth] = useState<AccountAuth>("signed_out");
  const [firstRunStep, setFirstRunStep] = useState<FirstRunStep>("sign_in");
  const [accountBusy, setAccountBusy] = useState(false);

  const firstRunComplete = firstRunStep === "ready";

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    void refreshShellAccount();
    const onAppState = (event: Event) => {
      const detail = (
        event as CustomEvent<{ auth?: AuthStateDto; step?: FirstRunStepDto }>
      ).detail;
      if (detail?.auth === "signed_in" || detail?.auth === "signed_out") {
        setAuth(detail.auth === "signed_in" ? "signed_in" : "signed_out");
      }
      if (detail?.step) {
        setFirstRunStep(detail.step);
      }
      if (!detail?.auth || !detail?.step) {
        void refreshShellAccount();
      }
    };
    const onFocus = () => {
      void refreshShellAccount();
    };
    window.addEventListener("issuebridge:app-state", onAppState);
    window.addEventListener("focus", onFocus);

    // The backend signs out on its own when GitHub rejects the vaulted token
    // (launch validation or any 401 on an authenticated call). Route to Sign in
    // immediately instead of waiting for the next window focus.
    let unlistenAuth: (() => void) | undefined;
    void listen("auth-changed", () => {
      void refreshShellAccount();
    }).then((fn) => {
      unlistenAuth = fn;
    });

    return () => {
      window.removeEventListener("issuebridge:app-state", onAppState);
      window.removeEventListener("focus", onFocus);
      unlistenAuth?.();
    };
  }, []);

  const isDark = resolveIsDark(themePreference, systemDark);

  function handleThemePreferenceChange(preference: ThemePreference) {
    writeThemePreference(preference);
    setThemePreference(preference);
  }

  function handleFirstRunChange(nextAuth: AuthStateDto, step: FirstRunStep) {
    setAuth(nextAuth === "signed_in" ? "signed_in" : "signed_out");
    setFirstRunStep(step);
    if (step === "ready") {
      setDestination("inbox");
    }
  }

  async function refreshShellAccount() {
    try {
      const [state, step] = await Promise.all([
        invoke<AuthStateDto>("auth_state"),
        invoke<FirstRunStepDto>("first_run_step"),
      ]);
      setAuth(state === "signed_in" ? "signed_in" : "signed_out");
      setFirstRunStep(step);
    } catch {
      setAuth("signed_out");
      setFirstRunStep("sign_in");
    }
  }

  async function handleSignOut() {
    setAccountBusy(true);
    try {
      const state = await invoke<AuthStateDto>("sign_out");
      const step = await invoke<FirstRunStepDto>("first_run_step");
      setAuth(state === "signed_in" ? "signed_in" : "signed_out");
      setFirstRunStep(step);
      dispatchAppState(state, step);
    } catch (error) {
      console.error("[issuebridge] sign_out failed", error);
      await refreshShellAccount();
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleSignIn() {
    setDestination("inbox");
    setAccountBusy(true);
    try {
      const state = await invoke<AuthStateDto>("sign_in_with_github");
      const step = await invoke<FirstRunStepDto>("first_run_step");
      setAuth(state === "signed_in" ? "signed_in" : "signed_out");
      setFirstRunStep(step);
      dispatchAppState(state, step);
    } catch (error) {
      console.error("[issuebridge] sign_in_with_github failed", error);
      await refreshShellAccount();
    } finally {
      setAccountBusy(false);
    }
  }

  return (
    <FluentProvider theme={isDark ? webDarkTheme : webLightTheme}>
      <ShellLayout
        destination={destination}
        onNavigate={setDestination}
        auth={auth}
        firstRunStep={firstRunStep}
        firstRunComplete={firstRunComplete}
        accountBusy={accountBusy}
        onSignOut={() => void handleSignOut()}
        onSignIn={() => void handleSignIn()}
        onFirstRunChange={handleFirstRunChange}
        themePreference={themePreference}
        onThemePreferenceChange={handleThemePreferenceChange}
      />
    </FluentProvider>
  );
}
