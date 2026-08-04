import {
  Badge,
  Button,
  Caption1,
  Field,
  Input,
  Link,
  Text,
  Textarea,
} from "@fluentui/react-components";
import type { RefObject } from "react";
import { formatTimestamp, type TimestampDisplay } from "../shared/formatTimestamp";
import type { DraftDto, RepoLabelDto } from "./types";
import { assignedLabelSet, parseLabelNames } from "./types";

type DraftInspectorProps = {
  draft: DraftDto | null;
  title: string;
  body: string;
  labels: string;
  catalogLabels: RepoLabelDto[];
  catalogRefreshFailed: boolean;
  suggestionFilter: string;
  busy: boolean;
  narrowStacked: boolean;
  timestampDisplay: TimestampDisplay;
  editorRef: RefObject<HTMLElement | null>;
  updateButtonRef: RefObject<HTMLButtonElement | null>;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onLabelsChange: (value: string) => void;
  onSuggestionFilterChange: (value: string) => void;
  onToggleCatalogLabel: (name: string) => void;
  onSave: () => void;
  onPublishOrUpdate: () => void;
  onRewrite: () => void;
  rewriteDisabled: boolean;
  rewriteHint: string | null;
  onBack: () => void;
};

function contrastText(hex: string): string {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length !== 6) return "#111";
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return "#111";
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111" : "#fff";
}

export function DraftInspector({
  draft,
  title,
  body,
  labels,
  catalogLabels,
  catalogRefreshFailed,
  suggestionFilter,
  busy,
  narrowStacked,
  timestampDisplay,
  editorRef,
  updateButtonRef,
  onTitleChange,
  onBodyChange,
  onLabelsChange,
  onSuggestionFilterChange,
  onToggleCatalogLabel,
  onSave,
  onPublishOrUpdate,
  onRewrite,
  rewriteDisabled,
  rewriteHint,
  onBack,
}: DraftInspectorProps) {
  if (!draft) {
    return (
      <section
        className="ib-draft-inspector ib-draft-inspector-blank"
        ref={editorRef as RefObject<HTMLElement>}
        tabIndex={-1}
        aria-label="Draft editor"
      >
        <Text as="p" className="ib-muted">
          Select a Draft to edit.
        </Text>
      </section>
    );
  }

  const assigned = assignedLabelSet(labels);
  const filter = suggestionFilter.trim().toLowerCase();
  const suggestions = catalogLabels.filter((label) => {
    if (!filter) return false;
    if (assigned.has(label.name.toLowerCase())) return false;
    return label.name.toLowerCase().includes(filter);
  });

  function commitTypedLabel() {
    const typed = suggestionFilter.trim();
    if (!typed) return;
    const next = parseLabelNames(labels);
    if (!next.some((name) => name.toLowerCase() === typed.toLowerCase())) {
      const hit = catalogLabels.find(
        (label) => label.name.toLowerCase() === typed.toLowerCase(),
      );
      next.push(hit ? hit.name : typed);
      onLabelsChange(next.join(", "));
    }
    onSuggestionFilterChange("");
  }

  return (
    <section
      className="ib-draft-inspector"
      ref={editorRef as RefObject<HTMLElement>}
      tabIndex={-1}
      aria-label="Draft editor"
    >
      {narrowStacked ? (
        <Button appearance="subtle" disabled={busy} onClick={onBack}>
          Back
        </Button>
      ) : null}

      <div className="ib-draft-inspector-header">
        <Text weight="semibold">
          {draft.owner}/{draft.name}
        </Text>
        <Caption1 className="ib-muted">
          {formatTimestamp(draft.created_at_millis, timestampDisplay)}
        </Caption1>
        <span className="ib-inbox-badges">
          <Badge
            appearance={draft.linked ? "filled" : "outline"}
            color="informative"
            size="small"
          >
            {draft.linked ? "Linked" : "Unlinked"}
          </Badge>
          {draft.dirty ? (
            <Badge appearance="filled" color="warning" size="small">
              Dirty
            </Badge>
          ) : null}
        </span>
      </div>

      <Field label="Title">
        <Input
          value={title}
          disabled={busy}
          onChange={(_, data) => onTitleChange(data.value)}
        />
      </Field>
      <Field label="Body">
        <Textarea
          value={body}
          disabled={busy}
          rows={10}
          resize="vertical"
          onChange={(_, data) => onBodyChange(data.value)}
        />
      </Field>
      <Field label="Labels">
        <Input
          value={suggestionFilter}
          disabled={busy}
          placeholder="Type to suggest or create a label"
          aria-label="Label suggestions"
          onChange={(_, data) => onSuggestionFilterChange(data.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commitTypedLabel();
            }
          }}
        />
      </Field>
      {suggestions.length > 0 ? (
        <ul className="ib-label-suggestions" aria-label="Label suggestions">
          {suggestions.map((label) => (
            <li key={label.name}>
              <button
                type="button"
                className="ib-label-chip"
                style={{
                  backgroundColor: `#${label.color.replace("#", "")}`,
                  color: contrastText(label.color),
                }}
                disabled={busy}
                onClick={() => {
                  onToggleCatalogLabel(label.name);
                  onSuggestionFilterChange("");
                }}
              >
                {label.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {catalogRefreshFailed ? (
        <Text as="p" size={200} className="ib-muted">
          Label catalog may be stale or unavailable.
        </Text>
      ) : null}
      <div className="ib-label-catalog" role="group" aria-label="Label catalog">
        {catalogLabels.length === 0 ? (
          <Text as="p" size={200} className="ib-muted">
            Label catalog is empty for this repository. Type a name above to add
            one on Publish.
          </Text>
        ) : (
          catalogLabels.map((label) => {
            const selected = assigned.has(label.name.toLowerCase());
            return (
              <button
                key={label.name}
                type="button"
                className={`ib-label-chip${selected ? " selected" : ""}`}
                style={{
                  backgroundColor: `#${label.color.replace("#", "")}`,
                  color: contrastText(label.color),
                }}
                disabled={busy}
                aria-pressed={selected}
                onClick={() => onToggleCatalogLabel(label.name)}
              >
                {label.name}
              </button>
            );
          })
        )}
      </div>

      <div className="ib-draft-actions">
        <Button appearance="secondary" disabled={busy} onClick={onSave}>
          Save
        </Button>
        <Button
          ref={updateButtonRef}
          appearance="primary"
          disabled={busy}
          onClick={onPublishOrUpdate}
        >
          {draft.linked ? "Update" : "Publish"}
        </Button>
        <Button
          appearance="secondary"
          disabled={busy || rewriteDisabled}
          title={rewriteHint ?? undefined}
          onClick={onRewrite}
        >
          Rewrite…
        </Button>
      </div>
      {rewriteHint ? (
        <Text as="p" size={200} className="ib-muted">
          {rewriteHint}
        </Text>
      ) : null}

      {draft.html_url && draft.issue_number != null ? (
        <p className="ib-draft-link">
          <Link href={draft.html_url} target="_blank" rel="noopener noreferrer">
            View on GitHub
          </Link>
          <Text as="span" size={200} className="ib-muted">
            {" "}
            #{draft.issue_number}
          </Text>
        </p>
      ) : null}
    </section>
  );
}
