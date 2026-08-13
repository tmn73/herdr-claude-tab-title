import { open, readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SESSION_ID = /^[0-9a-fA-F-]{36}$/;
/** Titles are republished often, so the tail always holds the current one. */
const TAIL_BYTES = 256 * 1024;

export function projectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configDir =
    env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
  return path.join(configDir, "projects");
}

/**
 * Claude Code stores one transcript per session at
 * `<projects root>/<cwd with separators replaced by dashes>/<session id>.jsonl`.
 * The pane's cwd names that directory directly; scanning covers panes whose cwd
 * moved after the session started.
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[/\\]/g, "-");
}

export async function transcriptPath(
  sessionId: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  const root = projectsRoot(env);
  const file = `${sessionId}.jsonl`;

  if (cwd && path.isAbsolute(cwd)) {
    const direct = path.join(root, encodeProjectDir(cwd), file);
    if (await isFile(direct)) return direct;
  }

  const entries = await readdir(root, { withFileTypes: true }).catch(() => null);
  for (const entry of entries ?? []) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name, file);
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Claude Code writes `{"type":"ai-title","aiTitle":"…"}` records describing the
 * session as a whole. It republishes the same title as work continues and only
 * revises it when the subject genuinely changes, which is exactly the stability
 * a tab label needs.
 */
export function titleFromTranscript(text: string): string | null {
  let title: string | null = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.includes('"ai-title"')) continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; aiTitle?: unknown };
      if (entry.type === "ai-title" && typeof entry.aiTitle === "string") {
        title = entry.aiTitle;
      }
    } catch {
      // Ignore partial and non-JSON records.
    }
  }
  return title;
}

export async function sessionTitle(
  sessionPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const root = await realpath(projectsRoot(env)).catch(() => null);
  const resolved = await realpath(sessionPath).catch(() => null);
  // Only read transcripts that genuinely live under the projects root.
  if (!root || !resolved || !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) return null;

  const handle = await open(resolved, "r").catch(() => null);
  if (!handle) return null;
  try {
    const offset = Math.max(0, info.size - TAIL_BYTES);
    const length = info.size - offset;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    // Drop the leading partial record when reading from the middle of the file.
    if (offset > 0) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }
    return titleFromTranscript(text);
  } finally {
    await handle.close();
  }
}

async function isFile(candidate: string): Promise<boolean> {
  const info = await stat(candidate).catch(() => null);
  return Boolean(info?.isFile());
}
