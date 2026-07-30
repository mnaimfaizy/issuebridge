import { CheckmarkRegular } from "@fluentui/react-icons";
import { FIRST_RUN_STRIP_STEPS, type FirstRunWizardStep } from "./types";

type ProgressStripProps = {
  current: FirstRunWizardStep;
};

/** Horizontal first-run progress strip (Variant C) — display-only, linear sequence. */
export function ProgressStrip({ current }: ProgressStripProps) {
  const currentIndex = FIRST_RUN_STRIP_STEPS.findIndex(
    (item) => item.id === current,
  );

  return (
    <nav className="ib-step-strip" aria-label="First-run progress">
      {FIRST_RUN_STRIP_STEPS.map((item, index) => {
        const isCurrent = item.id === current;
        const isDone = currentIndex > index;
        return (
          <div
            key={item.id}
            className={`ib-strip-item${isCurrent ? " current" : ""}${isDone ? " done" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            <span className="ib-strip-index" aria-hidden="true">
              {isDone ? <CheckmarkRegular /> : index + 1}
            </span>
            <span>{item.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
