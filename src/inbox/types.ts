export type InboxItemDto = {
  id: string;
  display_title: string;
  owner: string;
  name: string;
  linked: boolean;
  dirty: boolean;
  created_at_millis: number;
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
  created_at_millis: number;
};

export type RepoLabelDto = {
  name: string;
  color: string;
};

export type EnsuredLabelCatalogDto = {
  owner: string;
  name: string;
  labels: RepoLabelDto[];
  refresh_failed: boolean;
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

/** Case-insensitive resolve against Label catalog; keeps novel names; dedupes. */
export function canonicalizeLabelNames(
  names: string[],
  catalog: RepoLabelDto[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const hit = catalog.find(
      (label) => label.name.toLowerCase() === name.toLowerCase(),
    );
    const canonical = hit ? hit.name : name;
    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

export function assignedLabelSet(labelsCsv: string): Set<string> {
  return new Set(parseLabelNames(labelsCsv).map((name) => name.toLowerCase()));
}
