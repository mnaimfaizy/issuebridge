/**
 * Rewrite model status DTOs shared by Settings (manage) and Help (explain).
 * One definition so the two surfaces cannot drift apart.
 */

export type RewriteHardwareSwitchPromptDto = {
  current_model_id: string;
  recommended_model_id: string;
  reason: string;
  fingerprint: string;
};

export type RewriteModelEntryDto = {
  id: string;
  display_name: string;
  size_bytes: number;
  summary: string;
  on_disk: boolean;
  /** Actual file length when present; catalog `size_bytes` is the expected download. */
  on_disk_bytes: number | null;
  verified: boolean;
  active: boolean;
  update_available: boolean;
};

export type RewriteModelStatusDto = {
  models: RewriteModelEntryDto[];
  active_model_id: string | null;
  recommended_model_id: string;
  recommended_reason: string;
  hardware_tier: string;
  quality_alt_model_id: string | null;
  hardware_switch_prompt: RewriteHardwareSwitchPromptDto | null;
  needs_setup: boolean;
};

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${(bytes / 1_000_000).toFixed(0)} MB`;
  }
  return `${bytes} B`;
}

/** Catalog display name for a model id, falling back to the raw id. */
export function modelDisplayName(
  status: RewriteModelStatusDto,
  modelId: string | null,
): string | null {
  if (!modelId) return null;
  return (
    status.models.find((model) => model.id === modelId)?.display_name ?? modelId
  );
}

/** Models that occupy disk, verified or not — matches Settings' "on disk" row. */
export function modelsOnDisk(
  status: RewriteModelStatusDto,
): RewriteModelEntryDto[] {
  return status.models.filter((model) => model.on_disk);
}

/** Read-only "On disk" line for Help, counting unverified files too. */
export function onDiskLabel(status: RewriteModelStatusDto): string {
  const onDisk = modelsOnDisk(status);
  if (onDisk.length === 0) {
    return "No models downloaded";
  }
  const bytes = onDisk.reduce(
    (total, model) => total + (model.on_disk_bytes ?? 0),
    0,
  );
  const unverified = onDisk.filter((model) => !model.verified).length;
  const base = `${onDisk.length} of ${status.models.length} models · ${formatBytes(bytes)}`;
  return unverified > 0 ? `${base} (${unverified} not verified)` : base;
}
