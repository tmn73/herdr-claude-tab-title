import { sessionTitle, transcriptPath } from "./claude.ts";
import { listAgentPanes, listTabs, renameTab, type AgentPane, type Tab } from "./herdr.ts";
import { settings, type Settings } from "./config.ts";
import { isUnnamed, toLabel } from "./label.ts";
import { stripStatus, withStatus, type Palette } from "./status.ts";
import { pruneState, readState, writeState, type State, type TabRecord } from "./state.ts";

export interface SyncOptions {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  /** Report intended changes without touching any tab. */
  dryRun?: boolean;
  /** Take back a tab the operator had renamed. */
  reclaim?: boolean;
  /** Limit the pass to one tab. */
  onlyTabId?: string;
  /** Reports a problem that does not stop the pass, such as an unreadable config. */
  onError?: (message: string) => void;
}

export interface SyncOutcome {
  tabId: string;
  from: string;
  to: string;
  action: "renamed" | "unchanged" | "no-title" | "no-agent";
  /** True when the name belongs to the operator and only the state mark is ours. */
  manual: boolean;
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

/**
 * Decides who owns the tab's name. Any label this plugin did not write belongs
 * to whoever did write it: the operator naming a tab by hand, or another
 * plugin. Only an untouched tab carrying Herdr's own numeric placeholder is
 * ours to claim. The state mark stays ours in both cases, so the name is
 * remembered without it.
 */
export function claimTab(
  tab: Tab,
  record: TabRecord,
  marks: Palette | null,
  reclaim = false,
): TabRecord {
  const next: TabRecord = { ...record };
  if (reclaim) {
    delete next.manual;
    delete next.base;
    return next;
  }
  if (tab.label !== next.applied && !isUnnamed(tab.label)) next.manual = true;
  if (next.manual) next.base = stripStatus(tab.label, marks);
  return next;
}

/** The name the tab should carry, before the state mark. */
async function baseLabel(
  record: TabRecord,
  pane: AgentPane,
  maxLength: number,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (record.manual) return record.base || null;
  const path = pane.sessionId ? await transcriptPath(pane.sessionId, pane.cwd, env) : null;
  const title = path ? await sessionTitle(path, env) : null;
  return title ? toLabel(title, maxLength) : null;
}

async function syncTab(
  tab: Tab,
  panes: AgentPane[],
  record: TabRecord,
  options: SyncOptions,
  config: Settings,
  env: NodeJS.ProcessEnv,
): Promise<{ outcome: SyncOutcome; record: TabRecord }> {
  const pane = dominantPane(panes);
  if (!pane?.sessionId) {
    return {
      outcome: { tabId: tab.tabId, from: tab.label, to: "", action: "no-agent", manual: false },
      record,
    };
  }

  const next = claimTab(tab, record, config.marks, options.reclaim);
  const base = await baseLabel(next, pane, config.maxLength, env);
  if (!base) {
    const outcome: SyncOutcome = {
      tabId: tab.tabId,
      from: tab.label,
      to: "",
      action: "no-title",
      manual: next.manual === true,
    };
    return { outcome, record: next };
  }

  const label = withStatus(base, tab.agentStatus, config.marks);
  const outcome: SyncOutcome = {
    tabId: tab.tabId,
    from: tab.label,
    to: label,
    action: label === tab.label ? "unchanged" : "renamed",
    manual: next.manual === true,
  };
  // Record ownership even when nothing changes, so a later operator rename is
  // still detected on a tab that already matched.
  if (label === tab.label) return { outcome, record: { ...next, applied: label } };
  if (options.dryRun) return { outcome, record };
  await renameTab(tab.tabId, label, env);
  return { outcome, record: { ...next, applied: label } };
}

export async function sync(options: SyncOptions): Promise<SyncOutcome[]> {
  const env = options.env ?? process.env;
  const config = await settings(env, options.onError);
  const [tabs, panes] = await Promise.all([listTabs(env), listAgentPanes(env)]);

  const byTab = new Map<string, AgentPane[]>();
  for (const pane of panes) {
    byTab.set(pane.tabId, [...(byTab.get(pane.tabId) ?? []), pane]);
  }

  const state = pruneState(await readState(options.stateDir), tabs.map((t) => t.tabId));
  const outcomes: SyncOutcome[] = [];
  let dirty = false;

  for (const tab of tabs) {
    if (options.onlyTabId && tab.tabId !== options.onlyTabId) continue;
    const record = state.tabs[tab.tabId] ?? {};
    const result = await syncTab(tab, byTab.get(tab.tabId) ?? [], record, options, config, env);
    outcomes.push(result.outcome);
    if (JSON.stringify(result.record) !== JSON.stringify(record)) {
      state.tabs[tab.tabId] = result.record;
      dirty = true;
    }
  }

  if (dirty && !options.dryRun) await writeState(options.stateDir, state);
  return outcomes;
}

export function summarize(outcomes: SyncOutcome[]): string {
  const counts = outcomes.reduce<Record<string, number>>((acc, outcome) => {
    acc[outcome.action] = (acc[outcome.action] ?? 0) + 1;
    return acc;
  }, {});
  const manual = outcomes.filter((outcome) => outcome.manual).length;
  if (manual) counts.manual = manual;
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
