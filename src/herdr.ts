import { spawn } from "node:child_process";

export interface Tab {
  tabId: string;
  label: string;
}

export interface AgentPane {
  paneId: string;
  tabId: string;
  agent: string;
  sessionId: string | null;
  cwd: string | undefined;
  focused: boolean;
}

function binary(env: NodeJS.ProcessEnv): string {
  return env.HERDR_BIN_PATH || "herdr";
}

async function run(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary(env), args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (out += chunk));
    child.stderr.on("data", (chunk: string) => (err += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`herdr ${args[0]} failed: ${err.trim() || code}`)),
    );
  });
}

async function runJson(args: string[], env: NodeJS.ProcessEnv): Promise<unknown> {
  return JSON.parse(await run(args, env));
}

export async function listTabs(env: NodeJS.ProcessEnv = process.env): Promise<Tab[]> {
  const payload = (await runJson(["tab", "list"], env)) as {
    result?: { tabs?: { tab_id?: unknown; label?: unknown }[] };
  };
  const tabs: Tab[] = [];
  for (const tab of payload.result?.tabs ?? []) {
    if (typeof tab.tab_id === "string") {
      tabs.push({ tabId: tab.tab_id, label: typeof tab.label === "string" ? tab.label : "" });
    }
  }
  return tabs;
}

/**
 * Walks the snapshot rather than assuming a nesting shape, so a layout change in
 * Herdr does not silently drop panes.
 */
export async function listAgentPanes(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentPane[]> {
  const snapshot = await runJson(["api", "snapshot"], env);
  const focusedByTab = new Map<string, string>();
  const panes: AgentPane[] = [];
  const seen = new Set<string>();

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;

    if (typeof record.tab_id === "string" && typeof record.focused_pane_id === "string") {
      focusedByTab.set(record.tab_id, record.focused_pane_id);
    }
    if (typeof record.pane_id === "string" && typeof record.agent === "string") {
      const session = record.agent_session as { kind?: unknown; value?: unknown } | undefined;
      const key = `${record.pane_id}:${record.tab_id}`;
      if (!seen.has(key) && typeof record.tab_id === "string") {
        seen.add(key);
        panes.push({
          paneId: record.pane_id,
          tabId: record.tab_id,
          agent: record.agent,
          sessionId:
            session?.kind === "id" && typeof session.value === "string"
              ? session.value
              : null,
          cwd: typeof record.cwd === "string" ? record.cwd : undefined,
          focused: false,
        });
      }
    }
    Object.values(record).forEach(walk);
  };
  walk(snapshot);

  return panes.map((pane) => ({
    ...pane,
    focused: focusedByTab.get(pane.tabId) === pane.paneId,
  }));
}

export async function renameTab(
  tabId: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await run(["tab", "rename", tabId, label], env);
}
