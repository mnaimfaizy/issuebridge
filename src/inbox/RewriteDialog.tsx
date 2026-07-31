import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Text,
  Textarea,
} from "@fluentui/react-components";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { formatInvokeError } from "./types";

export type RewriteStyleDto = {
  id: string;
  name: string;
  instruction: string;
  builtin: boolean;
};

type RewritePhase = "idle" | "generating" | "proposal";

type RewriteDialogProps = {
  open: boolean;
  sourceTitle: string;
  sourceBody: string;
  onAccept: (title: string, body: string) => void;
  onClose: () => void;
};

/**
 * Variant B Rewrite modal: style chips → Generate → editable proposal → Accept / Discard.
 * Closing mid-generate cancels; never silent-overwrites the Draft underneath.
 */
export function RewriteDialog({
  open,
  sourceTitle,
  sourceBody,
  onAccept,
  onClose,
}: RewriteDialogProps) {
  const [styles, setStyles] = useState<RewriteStyleDto[]>([]);
  const [styleId, setStyleId] = useState("clear");
  const [phase, setPhase] = useState<RewritePhase>("idle");
  const [proposedTitle, setProposedTitle] = useState("");
  const [proposedBody, setProposedBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyStyles, setBusyStyles] = useState(false);
  const [newName, setNewName] = useState("");
  const [newInstruction, setNewInstruction] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const generateTokenRef = useRef(0);
  const selectedStyle = styles.find((s) => s.id === styleId);

  useEffect(() => {
    if (!open) return;
    setPhase("idle");
    setProposedTitle("");
    setProposedBody("");
    setError(null);
    setShowAdd(false);
    setNewName("");
    setNewInstruction("");
    generateTokenRef.current += 1;
    void (async () => {
      setBusyStyles(true);
      try {
        const snap = await invoke<{
          styles: RewriteStyleDto[];
          last_used_id: string;
        }>("list_rewrite_styles");
        setStyles(snap.styles);
        setStyleId(snap.last_used_id);
      } catch (err) {
        setError(formatInvokeError(err));
      } finally {
        setBusyStyles(false);
      }
    })();
  }, [open]);

  function requestClose() {
    generateTokenRef.current += 1;
    setPhase("idle");
    onClose();
  }

  async function runGenerate() {
    setError(null);
    setPhase("generating");
    const token = ++generateTokenRef.current;
    try {
      const proposal = await invoke<{ title: string; body: string }>(
        "generate_rewrite",
        {
          input: {
            title: sourceTitle,
            body: sourceBody,
            style_id: styleId,
          },
        },
      );
      if (token !== generateTokenRef.current) return;
      setProposedTitle(proposal.title);
      setProposedBody(proposal.body);
      setPhase("proposal");
      try {
        await invoke("remember_last_rewrite_style", { style_id: styleId });
      } catch {
        // Soft: proposal still usable if last-used persistence fails.
      }
    } catch (err) {
      if (token !== generateTokenRef.current) return;
      setError(formatInvokeError(err));
      setPhase("idle");
    }
  }

  function cancelGenerate() {
    generateTokenRef.current += 1;
    setPhase("idle");
  }

  async function addCustomStyle() {
    setError(null);
    setBusyStyles(true);
    try {
      const style = await invoke<RewriteStyleDto>("add_custom_rewrite_style", {
        input: { name: newName, instruction: newInstruction },
      });
      setStyles((current) => [...current, style]);
      setStyleId(style.id);
      setNewName("");
      setNewInstruction("");
      setShowAdd(false);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyStyles(false);
    }
  }

  async function removeCustomStyle(id: string) {
    setError(null);
    setBusyStyles(true);
    try {
      await invoke("remove_custom_rewrite_style", { style_id: id });
      const snap = await invoke<{
        styles: RewriteStyleDto[];
        last_used_id: string;
      }>("list_rewrite_styles");
      setStyles(snap.styles);
      setStyleId(snap.last_used_id);
    } catch (err) {
      setError(formatInvokeError(err));
    } finally {
      setBusyStyles(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) requestClose();
      }}
    >
      <DialogSurface className="ib-rewrite-dialog">
        <DialogBody>
          <DialogTitle>Rewrite Draft</DialogTitle>
          <DialogContent>
            {phase === "idle" ? (
              <>
                <Text>Pick a Rewrite style, then generate a proposal.</Text>
                <div
                  className="ib-rewrite-style-row"
                  role="group"
                  aria-label="Rewrite styles"
                >
                  {styles.map((style) => (
                    <Button
                      key={style.id}
                      size="small"
                      appearance={
                        styleId === style.id ? "primary" : "secondary"
                      }
                      disabled={busyStyles || phase !== "idle"}
                      onClick={() => setStyleId(style.id)}
                    >
                      {style.name}
                    </Button>
                  ))}
                </div>
                {selectedStyle && !selectedStyle.builtin ? (
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={busyStyles}
                    onClick={() => void removeCustomStyle(selectedStyle.id)}
                  >
                    Remove style
                  </Button>
                ) : null}
                {showAdd ? (
                  <div className="ib-rewrite-add">
                    <Field label="Style name">
                      <Input
                        value={newName}
                        onChange={(_, d) => setNewName(d.value)}
                      />
                    </Field>
                    <Field label="Instruction">
                      <Textarea
                        rows={3}
                        value={newInstruction}
                        onChange={(_, d) => setNewInstruction(d.value)}
                      />
                    </Field>
                    <div className="ib-rewrite-add-actions">
                      <Button
                        size="small"
                        appearance="primary"
                        disabled={busyStyles}
                        onClick={() => void addCustomStyle()}
                      >
                        Add style
                      </Button>
                      <Button
                        size="small"
                        appearance="secondary"
                        onClick={() => setShowAdd(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="small"
                    appearance="subtle"
                    disabled={busyStyles}
                    onClick={() => setShowAdd(true)}
                  >
                    Add Rewrite style…
                  </Button>
                )}
              </>
            ) : null}

            {phase === "generating" ? (
              <div className="ib-rewrite-progress" aria-live="polite">
                <Spinner size="tiny" />
                <Text>Rewriting with {selectedStyle?.name ?? "style"}…</Text>
              </div>
            ) : null}

            {phase === "proposal" ? (
              <div className="ib-rewrite-proposal">
                <Field label="Proposed title">
                  <Input
                    value={proposedTitle}
                    onChange={(_, d) => setProposedTitle(d.value)}
                  />
                </Field>
                <Field label="Proposed body">
                  <Textarea
                    rows={10}
                    resize="vertical"
                    value={proposedBody}
                    onChange={(_, d) => setProposedBody(d.value)}
                  />
                </Field>
              </div>
            ) : null}

            {error ? (
              <Text as="p" className="ib-rewrite-error" role="alert">
                {error}
              </Text>
            ) : null}
          </DialogContent>
          <DialogActions>
            {phase === "idle" ? (
              <Button
                appearance="primary"
                disabled={busyStyles || styles.length === 0}
                onClick={() => void runGenerate()}
              >
                Generate
              </Button>
            ) : null}
            {phase === "generating" ? (
              <Button appearance="secondary" onClick={cancelGenerate}>
                Cancel
              </Button>
            ) : null}
            {phase === "proposal" ? (
              <>
                <Button
                  appearance="primary"
                  onClick={() => {
                    onAccept(proposedTitle, proposedBody);
                    requestClose();
                  }}
                >
                  Accept
                </Button>
                <Button appearance="secondary" onClick={requestClose}>
                  Discard
                </Button>
              </>
            ) : null}
            {phase !== "generating" ? (
              <Button appearance="secondary" onClick={requestClose}>
                Close
              </Button>
            ) : null}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
