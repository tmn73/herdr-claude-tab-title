import { sessionTitle, transcriptPath } from "./claude.ts";
import { listAgentPanes, listTabs, renameTab, type AgentPane } from "./herdr.ts";
import { configuredMaxLength, toLabel } from "./label.ts";
import { pruneState, readState, writeState, type State } from "./state.ts";

export interface SyncOptions {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  /** Report intended changes without touching any tab. */
  dryRun?: boolean;
  /** Take back a tab the operator had renamed. */
  reclaim?: boolean;
  /** Limit the pass to one tab. */
  onlyTabId?: string;
}

export interface SyncOutcome {
  tabId: string;
  from: string;
  to: string;
  action: "renamed" | "unchanged" | "manual" | "no-title" | "no-agent";
}

/**
 * Picks the pane whose session should name the tab: the focused agent first,
 * then any agent with a session. Matches how an operator reads a tab.
 */
export function dominantPane(panes: AgentPane[]): AgentPane | null {
  const withSession = panes.filter((pane) => pane.sessionId);
  return (
    withSession.find((pane) => pane.focused) ?? withSession[0] ?? null
  );
}

export async function sync(options: SyncOptions): Promise<SyncOutcome[]> {
  const env = options.env ?? process.env;
  const maxLength = configuredMaxLength(env);
  const [tabs, panes] = await Promise.all([listTabs(env), listAgentPanes(env)]);

  const byTab = new Map<string, AgentPane[]>();
  for (const pane of panes) {
    byTab.set(pane.tabId, [...(byTab.get(pane.tabId) ?? []), pane]);
  }

  let state = pruneState(await readState(options.stateDir), tabs.map((t) => t.tabId));
  const outcomes: SyncOutcome[] = [];
  let dirty = false;

  for (const tab of tabs) {
    if (options.onlyTabId && tab.tabId !== options.onlyTabId) continue;
    const record = state.tabs[tab.tabId] ?? {};

    if (options.reclaim && record.manual) {
      delete record.manual;
      state.tabs[tab.tabId] = record;
      dirty = true;
    }

    const pane = dominantPane(byTab.get(tab.tabId) ?? []);
    if (!pane?.sessionId) {
      outcomes.push({ tabId: tab.tabId, from: tab.label, to: "", action: "no-agent" });
      continue;
    }

    // A label we did not write means the operator renamed the tab; respect that.
    if (record.applied !== undefined && tab.label !== record.applied) {
      record.manual = true;
      state.tabs[tab.tabId] = record;
      dirty = true;
    }
    if (record.manual) {
      outcomes.push({ tabId: tab.tabId, from: tab.label, to: "", action: "manual" });
      continue;
    }

    const path = await transcriptPath(pane.sessionId, pane.cwd, env);
    const title = path ? await sessionTitle(path, env) : null;
    const label = title ? toLabel(title, maxLength) : null;
    if (!label) {
      outcomes.push({ tabId: tab.tabId, from: tab.label, to: "", action: "no-title" });
      continue;
    }
    if (label === tab.label) {
      // Record ownership even when nothing changes, so a later operator rename
      // is still detected on a tab that already matched.
      if (record.applied !== label) {
        state.tabs[tab.tabId] = { ...record, applied: label };
        dirty = true;
      }
      outcomes.push({ tabId: tab.tabId, from: tab.label, to: label, action: "unchanged" });
      continue;
    }

    if (!options.dryRun) {
      await renameTab(tab.tabId, label, env);
      state.tabs[tab.tabId] = { ...record, applied: label };
      dirty = true;
    }
    outcomes.push({ tabId: tab.tabId, from: tab.label, to: label, action: "renamed" });
  }

  if (dirty && !options.dryRun) await writeState(options.stateDir, state);
  return outcomes;
}

export function summarize(outcomes: SyncOutcome[]): string {
  const counts = outcomes.reduce<Record<string, number>>((acc, outcome) => {
    acc[outcome.action] = (acc[outcome.action] ?? 0) + 1;
    return acc;
  }, {});
  const renamed = outcomes.filter((o) => o.action === "renamed");
  const detail = renamed
    .map((o) => `  ${o.tabId}  ${JSON.stringify(o.from)} -> ${JSON.stringify(o.to)}`)
    .join("\n");
  const header = Object.entries(counts)
    .map(([action, count]) => `${action}=${count}`)
    .join(" ");
  return detail ? `${header}\n${detail}` : header;
}

export type { State };
