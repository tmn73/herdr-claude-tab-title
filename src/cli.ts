import { spawn } from "node:child_process";
import path from "node:path";
import { configPath, ensureConfigFile, settings } from "./config.ts";
import { summarize, sync } from "./sync.ts";
import { alive, liveWorker, readWorker, runWorker, workerPaths } from "./worker.ts";

function stateDir(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR;
  if (!dir) throw new Error("HERDR_PLUGIN_STATE_DIR is required");
  return dir;
}

async function start(): Promise<void> {
  const dir = stateDir();
  // Written on the first run so the settings are discoverable without the README.
  await ensureConfigFile();
  const existing = await liveWorker(dir);
  if (existing) {
    console.log(`Claude Tab Title already running (pid ${existing.pid})`);
    return;
  }
  const child = spawn(
    process.execPath,
    [path.join(import.meta.dirname, "cli.ts"), "run"],
    { detached: true, stdio: "ignore", env: process.env },
  );
  child.unref();
  console.log(`Claude Tab Title started (pid ${child.pid})`);
}

async function stop(): Promise<void> {
  const dir = stateDir();
  const info = await readWorker(dir);
  if (!info || !alive(info.pid)) {
    console.log("Claude Tab Title not running");
    return;
  }
  process.kill(info.pid, "SIGTERM");
  console.log(`Claude Tab Title stopping (pid ${info.pid})`);
}

async function status(): Promise<void> {
  const dir = stateDir();
  const info = await liveWorker(dir);
  console.log(
    info
      ? `Claude Tab Title running (pid ${info.pid}, since ${info.startedAt})`
      : "Claude Tab Title stopped",
  );
}

async function syncOnce(options: { dryRun?: boolean; reclaim?: boolean }): Promise<void> {
  const outcomes = await sync({
    stateDir: stateDir(),
    onError: (message) => console.error(`Claude Tab Title: ${message}`),
    ...options,
  });
  console.log(summarize(outcomes));
}

/** Answers "where do I configure this, and what is it doing right now". */
async function showConfig(): Promise<void> {
  await ensureConfigFile();
  const config = await settings(process.env, (message) =>
    console.error(`Claude Tab Title: ${message}`),
  );
  const marks = config.marks
    ? Object.entries(config.marks)
        .map(([state, glyph]) => `${state}=${glyph || "(none)"}`)
        .join(" ")
    : "off";
  console.log(configPath() ?? "(no config dir)");
  console.log(`marks       ${marks}`);
  console.log(`interval_ms ${config.intervalMs}`);
  console.log(`max_length  ${config.maxLength}`);
}

const ACTIONS: Record<string, () => Promise<void>> = {
  start,
  stop,
  status,
  run: async () => runWorker(stateDir(), (await settings()).intervalMs),
  sync: () => syncOnce({}),
  "dry-run": () => syncOnce({ dryRun: true }),
  reclaim: () => syncOnce({ reclaim: true }),
  config: showConfig,
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
      `Claude Tab Title: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

await main();
