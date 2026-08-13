import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TabRecord {
  /** The label this plugin last wrote, used to detect operator renames. */
  applied?: string;
  /** Set once the operator renames the tab themselves; we then leave it alone. */
  manual?: boolean;
}

export interface State {
  version: 1;
  tabs: Record<string, TabRecord>;
}

export function emptyState(): State {
  return { version: 1, tabs: {} };
}

export function statePath(stateDir: string): string {
  return path.join(stateDir, "state.json");
}

export async function readState(stateDir: string): Promise<State> {
  const text = await readFile(statePath(stateDir), "utf8").catch(() => null);
  if (!text) return emptyState();
  try {
    const parsed = JSON.parse(text) as Partial<State>;
    if (parsed.version !== 1 || typeof parsed.tabs !== "object" || !parsed.tabs) {
      return emptyState();
    }
    return { version: 1, tabs: parsed.tabs };
  } catch {
    return emptyState();
  }
}

export async function writeState(stateDir: string, state: State): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  // Write then rename so a crash cannot leave a half-written state file.
  const target = statePath(stateDir);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 1)}\n`, "utf8");
  await rename(temporary, target);
}

/** Forgets tabs that no longer exist so the file does not grow without bound. */
export function pruneState(state: State, liveTabIds: Iterable<string>): State {
  const live = new Set(liveTabIds);
  const tabs: Record<string, TabRecord> = {};
  for (const [tabId, record] of Object.entries(state.tabs)) {
    if (live.has(tabId)) tabs[tabId] = record;
  }
  return { version: 1, tabs };
}
