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
import { isUnnamed, toLabel } from "../src/label.ts";
import { pruneState, readState, writeState, emptyState } from "../src/state.ts";
import { claimTab, dominantPane } from "../src/sync.ts";
import { PALETTES, stripStatus, toAgentStatus, withStatus } from "../src/status.ts";
import { DEFAULTS, DEFAULT_MAX_LENGTH, TEMPLATE, resolveSettings } from "../src/config.ts";
import type { AgentPane, Tab } from "../src/herdr.ts";

const SESSION_ID = "00000000-0000-4000-8000-000000000001";
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

const tab = (overrides: Partial<Tab>): Tab => ({
  tabId: "w1:t1",
  label: "1",
  agentStatus: "idle",
  ...overrides,
});

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
  assert.equal(long?.length, DEFAULT_MAX_LENGTH);
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

test("state marks carry their own colour, or mirror Herdr's symbols", () => {
  const color = PALETTES.color;
  const mono = PALETTES.symbols;
  assert.equal(withStatus("Fix the booking total", "done", color), "✅ Fix the booking total");
  assert.equal(withStatus("Fix the booking total", "working", color), "🟡 Fix the booking total");
  assert.equal(withStatus("Fix the booking total", "blocked", color), "🔴 Fix the booking total");
  assert.equal(withStatus("Fix the booking total", "idle", color), "⚪ Fix the booking total");
  assert.equal(withStatus("Fix the booking total", "done", mono), "✓ Fix the booking total");
  assert.equal(withStatus("Fix the booking total", "working", mono), "◐ Fix the booking total");
  // A tab Herdr sees no agent in reads exactly as it did before.
  assert.equal(withStatus("Fix the booking total", "unknown", color), "Fix the booking total");
  assert.equal(withStatus("Fix the booking total", "done", null), "Fix the booking total");
});

test("the name under a state mark is always recoverable", () => {
  assert.equal(stripStatus("◐ Fix the booking total"), "Fix the booking total");
  assert.equal(stripStatus("✓ 848 - pay ALGC"), "848 - pay ALGC");
  // Emoji presentation of the mark, and a label that collected two of them.
  assert.equal(stripStatus("✓️ gcal"), "gcal");
  assert.equal(stripStatus("✓ ◐ gcal"), "gcal");
  // Switching palettes must not leave the other palette's mark behind.
  assert.equal(stripStatus("✅ gcal"), "gcal");
  assert.equal(stripStatus("🟡 ✓ gcal"), "gcal");
  // Untouched labels pass through, including one that merely contains a glyph.
  assert.equal(stripStatus("Fix the booking total"), "Fix the booking total");
  assert.equal(stripStatus("2 × 3 matrix"), "2 × 3 matrix");
  assert.equal(toAgentStatus("done"), "done");
  assert.equal(toAgentStatus("banana"), "unknown");
  assert.equal(toAgentStatus(undefined), "unknown");
});

test("config.toml chooses the palette, and the environment overrides it", () => {
  assert.deepEqual(resolveSettings({}, {}), DEFAULTS);
  assert.deepEqual(resolveSettings({ palette: "symbols" }, {}).marks, PALETTES.symbols);
  assert.equal(resolveSettings({ palette: "off" }, {}).marks, null);
  // An unreadable setting is not a reason to stop marking tabs.
  assert.deepEqual(resolveSettings({ palette: "banana" }, {}).marks, PALETTES.color);
  assert.deepEqual(
    resolveSettings({ palette: "symbols" }, { HERDR_CLAUDE_TAB_TITLE_STATUS: "off" }).marks,
    null,
  );
  // Bounds keep a typo from starving the worker or gutting the labels.
  assert.equal(resolveSettings({ interval_ms: 60_000 }, {}).intervalMs, 60_000);
  assert.equal(resolveSettings({ interval_ms: 5 }, {}).intervalMs, DEFAULTS.intervalMs);
  assert.equal(resolveSettings({ max_length: 3 }, {}).maxLength, DEFAULTS.maxLength);
  assert.equal(
    resolveSettings({ max_length: 30 }, { HERDR_CLAUDE_TAB_TITLE_MAX_LENGTH: "80" }).maxLength,
    80,
  );
});

test("a mark can be set per state, and dropped", () => {
  // The quiet setup: mark what deserves a look, leave idle tabs alone.
  const quiet = resolveSettings({ marks: { idle: "" } }, {});
  assert.equal(withStatus("gcal", "idle", quiet.marks), "gcal");
  assert.equal(withStatus("gcal", "done", quiet.marks), "✅ gcal");
  const custom = resolveSettings({ palette: "symbols", marks: { done: "★" } }, {});
  assert.equal(withStatus("gcal", "done", custom.marks), "★ gcal");
  // A mark the operator chose is stripped like any other, so it never doubles up.
  assert.equal(stripStatus("★ gcal", custom.marks), "gcal");
  // Marks are drawn into the bar, so they stay on one line.
  assert.equal(withStatus("gcal", "done", resolveSettings({ marks: { done: "a\nb" } }, {}).marks), "a b gcal");
  // Nothing to override when marks are off.
  assert.equal(resolveSettings({ palette: "off", marks: { done: "★" } }, {}).marks, null);
});

test("the seeded config file changes nothing by itself", () => {
  // Every line is commented, so a fresh install behaves exactly like no file.
  for (const line of TEMPLATE.split("\n")) {
    assert.ok(line === "" || line.startsWith("#"), line);
  }
});

test("a tab we did not name keeps its name and only lends its mark", () => {
  // Herdr's placeholder is ours to claim.
  assert.deepEqual(claimTab(tab({ label: "3" }), {}, PALETTES.color), {});
  // Our own label, mark included, is not an operator rename.
  assert.deepEqual(claimTab(tab({ label: "◐ Fix Total" }), { applied: "◐ Fix Total" }, PALETTES.color), {
    applied: "◐ Fix Total",
  });
  // A label we never wrote belongs to whoever wrote it.
  assert.deepEqual(claimTab(tab({ label: "gcal" }), { applied: "◐ Fix Total" }, PALETTES.color), {
    applied: "◐ Fix Total",
    manual: true,
    base: "gcal",
  });
  // The name we remember for it never accumulates marks.
  assert.deepEqual(claimTab(tab({ label: "✓ gcal" }), { manual: true, base: "gcal" }, PALETTES.color), {
    manual: true,
    base: "gcal",
  });
  // Reclaim hands the name back to the agent's title.
  assert.deepEqual(claimTab(tab({ label: "✓ gcal" }), { manual: true, base: "gcal" }, PALETTES.color, true), {});
});
