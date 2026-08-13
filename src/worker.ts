import { appendFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { summarize, sync } from "./sync.ts";

export const DEFAULT_INTERVAL_MS = 10_000;

export interface WorkerInfo {
  pid: number;
  startedAt: string;
}

export function workerPaths(stateDir: string): { pid: string; log: string } {
  return {
    pid: path.join(stateDir, "worker.json"),
    log: path.join(stateDir, "worker.log"),
  };
}

export async function readWorker(stateDir: string): Promise<WorkerInfo | null> {
  const text = await readFile(workerPaths(stateDir).pid, "utf8").catch(() => null);
  if (!text) return null;
  try {
    const info = JSON.parse(text) as Partial<WorkerInfo>;
    if (typeof info.pid !== "number" || typeof info.startedAt !== "string") return null;
    return { pid: info.pid, startedAt: info.startedAt };
  } catch {
    return null;
  }
}

export function alive(pid: number): boolean {
  try {
    // Signal 0 tests for existence without touching the process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function liveWorker(stateDir: string): Promise<WorkerInfo | null> {
  const info = await readWorker(stateDir);
  if (!info) return null;
  if (!alive(info.pid)) {
    await unlink(workerPaths(stateDir).pid).catch(() => {});
    return null;
  }
  return info;
}

async function log(stateDir: string, message: string): Promise<void> {
  await appendFile(
    workerPaths(stateDir).log,
    `${new Date().toISOString()} ${message}\n`,
    "utf8",
  ).catch(() => {});
}

/** Runs the poll loop in this process until it receives a termination signal. */
export async function runWorker(
  stateDir: string,
  intervalMs = DEFAULT_INTERVAL_MS,
): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const existing = await liveWorker(stateDir);
  if (existing) {
    throw new Error(`already running (pid ${existing.pid})`);
  }
  await writeFile(
    workerPaths(stateDir).pid,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    "utf8",
  );
  await log(stateDir, `started pid=${process.pid} interval=${intervalMs}ms`);

  let stopping = false;
  const stop = (signal: string) => {
    stopping = true;
    void log(stateDir, `stopped by ${signal}`);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  while (!stopping) {
    try {
      const outcomes = await sync({ stateDir });
      const renamed = outcomes.filter((outcome) => outcome.action === "renamed");
      if (renamed.length) await log(stateDir, summarize(outcomes));
    } catch (error) {
      await log(stateDir, `pass failed: ${error instanceof Error ? error.message : error}`);
    }
    // Sleep in short slices so a signal is honoured promptly.
    for (let waited = 0; waited < intervalMs && !stopping; waited += 250) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  await unlink(workerPaths(stateDir).pid).catch(() => {});
}
