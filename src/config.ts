import { TOML } from "bun";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENT_STATUSES,
  DEFAULT_PALETTE,
  NAMED_PALETTES,
  PALETTES,
  type AgentStatus,
  type Palette,
} from "./status.ts";

export const DEFAULT_INTERVAL_MS = 10_000;
export const MIN_INTERVAL_MS = 2_000;
export const DEFAULT_MAX_LENGTH = 60;
export const MIN_MAX_LENGTH = 12;

export interface Settings {
  /** The mark for each agent state, or null when marks are turned off. */
  marks: Palette | null;
  intervalMs: number;
  maxLength: number;
}

export const DEFAULTS: Settings = {
  marks: PALETTES.color,
  intervalMs: DEFAULT_INTERVAL_MS,
  maxLength: DEFAULT_MAX_LENGTH,
};

const CONTROL = /[\p{Cc}\p{Cf}]/gu;

function bounded(value: unknown, minimum: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum ? Math.floor(number) : fallback;
}

/** A mark is drawn into the tab bar, so it is a glyph on one line or nothing. */
function toMark(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

function toPalette(name: unknown): Palette | null {
  const choice = typeof name === "string" ? name.trim().toLowerCase() : "";
  if (choice === "off") return null;
  return NAMED_PALETTES[choice] ?? PALETTES.color;
}

/** Reads config.toml over the defaults, then the environment over both. */
export function resolveSettings(
  file: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Settings {
  const named = env.HERDR_CLAUDE_TAB_TITLE_STATUS ?? file.palette;
  let marks = named === undefined ? DEFAULTS.marks : toPalette(named);

  const overrides = (file.marks ?? {}) as Record<string, unknown>;
  for (const [state, value] of Object.entries(overrides)) {
    if (!AGENT_STATUSES.includes(state as AgentStatus)) continue;
    const mark = toMark(value);
    // Overriding a state while marks are off would be a contradiction, so the
    // palette stays off and the override is ignored.
    if (mark === null || marks === null) continue;
    marks = { ...marks, [state as AgentStatus]: mark };
  }

  return {
    marks,
    intervalMs: bounded(
      env.HERDR_CLAUDE_TAB_TITLE_INTERVAL_MS ?? file.interval_ms,
      MIN_INTERVAL_MS,
      DEFAULTS.intervalMs,
    ),
    maxLength: bounded(
      env.HERDR_CLAUDE_TAB_TITLE_MAX_LENGTH ?? file.max_length,
      MIN_MAX_LENGTH,
      DEFAULTS.maxLength,
    ),
  };
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env.HERDR_PLUGIN_CONFIG_DIR;
  return dir ? path.join(dir, "config.toml") : null;
}

/**
 * Read on every pass rather than cached, so editing config.toml takes effect
 * without restarting the worker. A file that does not parse is reported and
 * then ignored: a typo must not stop tabs from being named.
 */
export async function settings(
  env: NodeJS.ProcessEnv = process.env,
  onError: (message: string) => void = () => {},
): Promise<Settings> {
  const file = configPath(env);
  const text = file ? await readFile(file, "utf8").catch(() => null) : null;
  let parsed: Record<string, unknown> = {};
  if (text) {
    try {
      parsed = TOML.parse(text) as Record<string, unknown>;
    } catch (error) {
      onError(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return resolveSettings(parsed, env);
}

export const TEMPLATE = `# Claude Tab Title
# Every setting is commented out and shows its default. Changes to this file are
# picked up on the next pass, except interval_ms which is read when the worker
# starts.

# State mark written in front of every tab label.
#   "color"   ${Object.values(PALETTES.color).filter(Boolean).join(" ")}  glyphs that carry their own colour
#   "symbols" ${Object.values(PALETTES.symbols).filter(Boolean).join(" ")}  Herdr's own monochrome indicators
#   "off"     no mark at all
# palette = "${DEFAULT_PALETTE}"

# Per-state marks, over whichever palette is in use. Any glyph your terminal font
# draws works, and "" leaves that state unmarked. This one keeps the mark for the
# states worth looking at and leaves idle tabs quiet:
# [marks]
# idle = ""

# How often the worker looks for changes, in milliseconds.
# Values below ${MIN_INTERVAL_MS} are ignored.
# interval_ms = ${DEFAULT_INTERVAL_MS}

# Character bound on a label, so one pathological title cannot dominate the bar.
# Values below ${MIN_MAX_LENGTH} are ignored.
# max_length = ${DEFAULT_MAX_LENGTH}
`;

/** Writes the commented template once, so the settings are discoverable. */
export async function ensureConfigFile(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const file = configPath(env);
  if (!file) return;
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing !== null) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, TEMPLATE, "utf8").catch(() => {});
}
