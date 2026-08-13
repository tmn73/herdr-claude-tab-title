import { spawn } from "node:child_process";
import path from "node:path";
import { summarize, sync } from "./sync.ts";
import {
  DEFAULT_INTERVAL_MS,
  alive,
  liveWorker,
  readWorker,
  runWorker,
  workerPaths,
} from "./worker.ts";

function stateDir(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

function intervalMs(): number {
  const raw = Number(process.env.AGENT_TITLE_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 2_000 ? raw : DEFAULT_INTERVAL_MS;
}

async function start(): Promise<void> {
  const dir = stateDir();
  const existing = await liveWorker(dir);
  if (existing) {
    console.log(`Agent Title already running (pid ${existing.pid})`);
    return;
  }
  const child = spawn(
    process.execPath,
    [path.join(import.meta.dirname, "cli.ts"), "run"],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.unref();
  console.log(`Agent Title started (pid ${child.pid})`);
}

async function stop(): Promise<void> {
  const dir = stateDir();
  const info = await readWorker(dir);
  if (!info || !alive(info.pid)) {
    console.log("Agent Title not running");
    return;
  }
  process.kill(info.pid, "SIGTERM");
  console.log(`Agent Title stopping (pid ${info.pid})`);
}

async function status(): Promise<void> {
  const dir = stateDir();
  const info = await liveWorker(dir);
  console.log(
    info
      ? `Agent Title running (pid ${info.pid}, since ${info.startedAt})`
      : "Agent Title stopped",
  );
}

async function syncOnce(options: { dryRun?: boolean; reclaim?: boolean }): Promise<void> {
  const outcomes = await sync({ stateDir: stateDir(), ...options });
  console.log(summarize(outcomes));
}

const ACTIONS: Record<string, () => Promise<void>> = {
  start,
  stop,
  status,
  run: async () => runWorker(stateDir(), intervalMs()),
  sync: () => syncOnce({}),
  "dry-run": () => syncOnce({ dryRun: true }),
  reclaim: () => syncOnce({ reclaim: true }),
  logs: async () => {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(workerPaths(stateDir()).log, "utf8").catch(() => "");
    console.log(text.trimEnd() || "(no log yet)");
  },
};

async function main(argv = process.argv.slice(2)): Promise<void> {
  const action = ACTIONS[argv[0] ?? ""];
  if (!action) {
    console.error(`usage: cli.ts ${Object.keys(ACTIONS).join("|")}`);
    process.exitCode = 2;
    return;
  }
  try {
    await action();
  } catch (error) {
    console.error(
      `Agent Title: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

await main();
