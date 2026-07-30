import type { RefObject } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Link,
  Text,
  Textarea,
} from "@fluentui/react-components";
import type { DraftDto } from "./types";

type DraftInspectorProps = {
  draft: DraftDto | null;
  title: string;
  body: string;
  labels: string;
  busy: boolean;
  narrowStacked: boolean;
  editorRef: RefObject<HTMLElement | null>;
  updateButtonRef: RefObject<HTMLButtonElement | null>;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onLabelsChange: (value: string) => void;
  onSave: () => void;
  onPublishOrUpdate: () => void;
  onBack: () => void;
};

export function DraftInspector({
  draft,
  title,
  body,
  labels,
  busy,
  narrowStacked,
  editorRef,
  updateButtonRef,
  onTitleChange,
  onBodyChange,
  onLabelsChange,
  onSave,
  onPublishOrUpdate,
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
      <Field label="Labels (comma-separated names)">
        <Input
          value={labels}
          disabled={busy}
          placeholder="bug, ui"
          onChange={(_, data) => onLabelsChange(data.value)}
        />
      </Field>

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
      </div>

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
