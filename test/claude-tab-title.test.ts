import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  encodeProjectDir,
  sessionTitle,
  titleFromTranscript,
  transcriptPath,
} from "../src/claude.ts";
import { MAX_LABEL_LENGTH, isUnnamed, toLabel } from "../src/label.ts";
import { pruneState, readState, writeState, emptyState } from "../src/state.ts";
import { dominantPane } from "../src/sync.ts";
import type { AgentPane } from "../src/herdr.ts";

const SESSION_ID = "5807bee1-631b-41f3-8f0a-770b160fe182";
const title = (value: string) => JSON.stringify({ type: "ai-title", aiTitle: value });

async function fixture(cwd: string, lines: string[]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-tab-title-"));
  const configDir = path.join(root, ".claude");
  const projectDir = path.join(configDir, "projects", encodeProjectDir(cwd));
  await mkdir(projectDir, { recursive: true });
  const session = path.join(projectDir, `${SESSION_ID}.jsonl`);
  await writeFile(session, `${lines.join("\n")}\n`);
  return {
    root,
    session,
    env: { ...process.env, HOME: root, CLAUDE_CONFIG_DIR: configDir },
  };
}

const pane = (overrides: Partial<AgentPane>): AgentPane => ({
  paneId: "w1:p1",
  tabId: "w1:t1",
  agent: "claude",
  sessionId: SESSION_ID,
  cwd: "/home/dev/project",
  focused: false,
  ...overrides,
});

test("the newest published title wins", () => {
  assert.equal(
    titleFromTranscript(
      [
        title("Install the plugin"),
        JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
        title("Fix the booking total"),
      ].join("\n"),
    ),
    "Fix the booking total",
  );
  assert.equal(titleFromTranscript(""), null);
  assert.equal(titleFromTranscript('{"type":"user"}'), null);
  // A truncated trailing record must not discard the good title before it.
  assert.equal(
    titleFromTranscript(`${title("Fix the booking total")}\n{"type":"ai-tit`),
    "Fix the booking total",
  );
});

test("labels pass the agent's title through unchanged", () => {
  assert.equal(toLabel("Fix the booking total"), "Fix the booking total");
  // Wording, accents, casing and punctuation are the agent's to choose.
  assert.equal(
    toLabel("Préparer documents fiscaux colombiens 2025"),
    "Préparer documents fiscaux colombiens 2025",
  );
  assert.equal(
    toLabel("Install herdr-tab-smart-rename package"),
    "Install herdr-tab-smart-rename package",
  );
  // A label is one line, and control characters would corrupt the bar.
  assert.equal(toLabel("Fix\tthe\nbooking  total"), "Fix the booking total");
  assert.equal(toLabel("   "), null);
  assert.equal(toLabel(""), null);
  // Bounded only so one pathological title cannot dominate the bar.
  const long = toLabel("x".repeat(200));
  assert.equal(long?.length, MAX_LABEL_LENGTH);
  assert.equal(toLabel("abc def", 5), "abc d");
});

test("transcripts resolve by cwd and by scanning", async () => {
  const cwd = "/home/dev/project";
  const f = await fixture(cwd, [title("Fix the booking total")]);
  try {
    assert.equal(await transcriptPath(SESSION_ID, cwd, f.env), f.session);
    assert.equal(await transcriptPath(SESSION_ID, "/somewhere/else", f.env), f.session);
    assert.equal(await transcriptPath("../../etc/passwd", cwd, f.env), null);
    assert.equal(await transcriptPath("not-a-session", cwd, f.env), null);
    assert.equal(await sessionTitle(f.session, f.env), "Fix the booking total");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("transcripts outside the projects root are refused", async () => {
  const f = await fixture("/home/dev/project", [title("Fix the booking total")]);
  const outside = path.join(f.root, `${SESSION_ID}.jsonl`);
  await writeFile(outside, `${title("Do not read this")}\n`);
  try {
    assert.equal(await sessionTitle(outside, f.env), null);
    assert.equal(await sessionTitle(f.root, f.env), null);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("the focused agent pane names the tab", () => {
  const background = pane({ paneId: "w1:p1" });
  const focused = pane({ paneId: "w1:p2", focused: true });
  assert.equal(dominantPane([background, focused])?.paneId, "w1:p2");
  assert.equal(dominantPane([background])?.paneId, "w1:p1");
  // A pane without a session cannot name anything.
  assert.equal(dominantPane([pane({ sessionId: null })]), null);
  assert.equal(dominantPane([]), null);
});

test("only Herdr's own placeholder label is ours to claim", () => {
  // Untouched tabs: Herdr names them by index inside the workspace.
  assert.equal(isUnnamed("6"), true);
  assert.equal(isUnnamed("12"), true);
  assert.equal(isUnnamed(""), true);
  assert.equal(isUnnamed("   "), true);
  // Anything a human would type stays untouched, including short or odd names.
  assert.equal(isUnnamed("cliamp"), false);
  assert.equal(isUnnamed("gcal"), false);
  assert.equal(isUnnamed("main"), false);
  assert.equal(isUnnamed("848 - pay ALGC"), false);
  assert.equal(isUnnamed("v2"), false);
  assert.equal(isUnnamed("Fix the booking total"), false);
});

test("state survives a round trip and forgets closed tabs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "claude-tab-title-state-"));
  try {
    assert.deepEqual(await readState(dir), emptyState());
    const state = {
      version: 1 as const,
      tabs: { "w1:t1": { applied: "Fix Total" }, "w1:t9": { manual: true } },
    };
    await writeState(dir, state);
    assert.deepEqual(await readState(dir), state);
    assert.deepEqual(pruneState(state, ["w1:t1"]), {
      version: 1,
      tabs: { "w1:t1": { applied: "Fix Total" } },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
