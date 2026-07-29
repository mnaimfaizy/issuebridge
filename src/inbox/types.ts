export type InboxItemDto = {
  id: string;
  display_title: string;
  owner: string;
  name: string;
  linked: boolean;
  dirty: boolean;
};

export type DraftDto = {
  id: string;
  owner: string;
  name: string;
  title: string;
  body: string;
  label_names: string[];
  linked: boolean;
  dirty: boolean;
  issue_number: number | null;
  html_url: string | null;
};

export type UpdateLinkedOutcomeDto =
  | { kind: "updated"; draft: DraftDto }
  | { kind: "conflict"; html_url: string | null; issue_number: number | null };

export function formatInvokeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function parseLabelNames(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
