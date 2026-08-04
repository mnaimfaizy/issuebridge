/** Timestamp display preference: local browser time or UTC. */
export type TimestampDisplay = "local" | "utc";

/**
 * Format a millis-since-epoch value as a readable date+time string.
 * Uses absolute date+time ("exact moment") with no relative phrasing.
 */
export function formatTimestamp(
  millis: number,
  display: TimestampDisplay,
): string {
  const date = new Date(millis);
  if (display === "utc") {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
