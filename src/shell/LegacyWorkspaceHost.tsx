import { useEffect, useRef } from "react";
import { bootMainUi } from "../main";

type LegacyWorkspaceHostProps = {
  /** When false, keep the DOM mounted but visually replace with destinations. */
  visible: boolean;
};

/**
 * Hosts the legacy conflict modal markup until slice 5 replaces it.
 * First-run lives in React (`FirstRunWorkbench`). Boot is once-per-mount.
 */
export function LegacyWorkspaceHost({ visible }: LegacyWorkspaceHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || bootedRef.current) return;

    const template = document.querySelector<HTMLTemplateElement>(
      "#legacy-workspace-template",
    );
    if (!template) {
      console.error("[issuebridge] legacy workspace template missing");
      return;
    }

    host.replaceChildren(template.content.cloneNode(true));
    bootedRef.current = true;
    void bootMainUi();
  }, []);

  return (
    <div
      className="ib-legacy-host"
      ref={hostRef}
      hidden={!visible}
      aria-hidden={!visible}
    />
  );
}
