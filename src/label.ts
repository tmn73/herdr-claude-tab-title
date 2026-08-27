import { DEFAULT_MAX_LENGTH } from "./config.ts";

const CONTROL = /[\p{Cc}\p{Cf}]/gu;

/**
 * Herdr labels a new tab with its index inside the workspace, so a digits-only
 * or empty label means nobody has named it. Any other label was chosen by the
 * operator or another plugin and is never overwritten.
 */
export function isUnnamed(label: string): boolean {
  const value = label.trim();
  return value === "" || /^\d+$/.test(value);
}

/**
 * The agent wrote this title for its operator, so it is passed through as
 * published. Control characters are removed because they would corrupt the tab
 * bar, and whitespace is collapsed because a label is a single line.
 */
export function toLabel(title: string, maxLength = DEFAULT_MAX_LENGTH): string | null {
  const cleaned = title.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length <= maxLength ? cleaned : cleaned.slice(0, maxLength).trimEnd();
}
