import { Body1, Button, Subtitle2 } from "@fluentui/react-components";
import { Fragment, type ReactNode } from "react";
import type { HelpTopic } from "./helpContent";

type HelpSectionProps = {
  topic: HelpTopic;
  /** Live values substituted into `{token}` placeholders, shown as keys. */
  tokens?: Record<string, string>;
  /** Deep link handler; the section hides its link when absent. */
  onOpenLink?: (topic: HelpTopic) => void;
  /** Live content rendered under the points (e.g. Your machine). */
  children?: ReactNode;
};

/** Renders one Help topic: heading, intro, points, optional live block + deep link. */
export function HelpSection({
  topic,
  tokens,
  onOpenLink,
  children,
}: HelpSectionProps) {
  const headingId = `help-${topic.id}-heading`;
  const ListTag = topic.ordered ? "ol" : "ul";

  return (
    <section className="ib-settings-block" aria-labelledby={headingId}>
      <Subtitle2 as="h2" id={headingId}>
        {topic.heading}
      </Subtitle2>
      <Body1>{topic.intro}</Body1>
      <ListTag className="ib-help-list">
        {topic.points.map((point) => (
          <li key={point.term}>
            <strong>{point.term}</strong> — {renderDetail(point.detail, tokens)}
          </li>
        ))}
      </ListTag>
      {children}
      {topic.link && onOpenLink ? (
        <div className="ib-settings-actions">
          <Button
            size="small"
            appearance="secondary"
            onClick={() => onOpenLink(topic)}
          >
            {topic.link.label}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Splits `{token}` placeholders out of detail copy and renders them as keys. */
function renderDetail(
  detail: string,
  tokens: Record<string, string> | undefined,
): ReactNode {
  const parts = detail.split(/(\{[a-zA-Z]+\})/);
  return parts.map((part, index) => {
    const match = /^\{([a-zA-Z]+)\}$/.exec(part);
    const value = match ? tokens?.[match[1]] : undefined;
    const key = `${index}-${part}`;
    if (value) {
      return <kbd key={key}>{value}</kbd>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}
