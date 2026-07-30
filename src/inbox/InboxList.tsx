import { Badge, Button, Text } from "@fluentui/react-components";
import type { KeyboardEvent, RefObject } from "react";
import type { InboxItemDto } from "./types";

type InboxListProps = {
  items: InboxItemDto[];
  selectedId: string | null;
  busy: boolean;
  listRef: RefObject<HTMLDivElement | null>;
  onSelect: (id: string) => void;
  onCapture: () => void;
  onListKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export function InboxList({
  items,
  selectedId,
  busy,
  listRef,
  onSelect,
  onCapture,
  onListKeyDown,
}: InboxListProps) {
  if (items.length === 0) {
    return (
      <div className="ib-inbox-empty" role="region" aria-label="Inbox">
        <Text as="p">
          No drafts yet. Capture with the hotkey or start one here.
        </Text>
        <Text as="p" className="ib-inbox-hotkey-cue">
          Hotkey: <kbd>Ctrl+Alt+Shift+I</kbd>
        </Text>
        <Button appearance="primary" disabled={busy} onClick={onCapture}>
          Capture
        </Button>
      </div>
    );
  }

  return (
    <div
      className="ib-inbox-list"
      ref={listRef}
      role="listbox"
      aria-label="Drafts"
      tabIndex={0}
      onKeyDown={onListKeyDown}
    >
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={selected}
            className={`ib-inbox-row${selected ? " selected" : ""}`}
            tabIndex={-1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(item.id);
              }
            }}
          >
            <div className="ib-inbox-row-title">{item.display_title}</div>
            <div className="ib-inbox-row-meta">
              <span>
                {item.owner}/{item.name}
              </span>
              <span className="ib-inbox-badges">
                <Badge
                  appearance={item.linked ? "filled" : "outline"}
                  color="informative"
                  size="small"
                >
                  {item.linked ? "Linked" : "Unlinked"}
                </Badge>
                {item.dirty ? (
                  <Badge appearance="filled" color="warning" size="small">
                    Dirty
                  </Badge>
                ) : null}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
