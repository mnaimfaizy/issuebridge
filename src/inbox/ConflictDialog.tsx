import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Link,
} from "@fluentui/react-components";

type ConflictDialogProps = {
  open: boolean;
  htmlUrl: string | null;
  busy: boolean;
  onKeepMine: () => void;
  onUseTheirs: () => void;
};

/**
 * Must-choose conflict surface for Update (Keep mine / Use theirs).
 * Alert dialog: Escape / outside-click do not dismiss; no leave-dirty path.
 */
export function ConflictDialog({
  open,
  htmlUrl,
  busy,
  onKeepMine,
  onUseTheirs,
}: ConflictDialogProps) {
  return (
    <Dialog
      open={open}
      modalType="alert"
      onOpenChange={(_, data) => {
        // Escape / outside must not dismiss — must choose Keep mine or Use theirs.
        if (!data.open) return;
      }}
    >
      <DialogSurface
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <DialogBody>
          <DialogTitle>Conflict</DialogTitle>
          <DialogContent>
            This issue changed on GitHub since you last updated it. Keep your
            local edits, or use the GitHub version.
          </DialogContent>
          <DialogActions>
            <Button
              appearance="primary"
              disabled={busy}
              autoFocus
              onClick={onKeepMine}
            >
              Keep mine
            </Button>
            <Button appearance="primary" disabled={busy} onClick={onUseTheirs}>
              Use theirs
            </Button>
          </DialogActions>
          {htmlUrl ? (
            <p className="ib-conflict-secondary">
              <Link href={htmlUrl} target="_blank" rel="noopener noreferrer">
                View on GitHub
              </Link>
            </p>
          ) : null}
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
