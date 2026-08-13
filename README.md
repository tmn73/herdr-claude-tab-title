# herdr-agent-title

Mirrors each coding agent's own session title onto its Herdr tab.

Claude Code already maintains a title for every session and revises it only when
the subject of the work genuinely changes. This plugin copies that title onto the
tab, so the tab bar reads like a list of what you are working on rather than a
list of terminal numbers.

No model, no API key, no prompt. Reading a title costs nothing, so there is no
rate limit and nothing to configure.

## Install

Requires Herdr 0.7.0+ and Bun.

```sh
herdr plugin install <owner>/herdr-agent-title
herdr plugin action invoke start --plugin agent-title
```

For local development, point Herdr at a checkout instead:

```sh
herdr plugin link /path/to/herdr-agent-title
```

## Actions

| Action | Effect |
| --- | --- |
| `start` / `stop` / `status` | Control the sync worker |
| `sync` | Apply titles to every tab now |
| `dry-run` | Report what a sync would change, without changing it |
| `reclaim` | Resume managing tabs you had renamed by hand |
| `logs` | Print the worker log |

```sh
herdr plugin action invoke <action> --plugin agent-title
```

A useful keybinding for an immediate pass:

```toml
[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "agent-title.sync"
description = "sync agent titles"
```

## Behaviour

The worker polls every 10 seconds. Override with `AGENT_TITLE_INTERVAL_MS`
(minimum 2000).

For each tab it picks the pane whose session should name it: the focused agent
first, then any agent with a session. It then reads that agent's transcript and
applies the latest title it published.

**Your own names win.** Rename a tab yourself and the plugin notices the label is
not the one it wrote, marks the tab as yours, and stops touching it. Use
`reclaim` to hand it back.

Tabs with no agent, and sessions that have not published a title yet, are left
exactly as they are.

Labels keep the agent's own wording, punctuation, and language. Only control
characters and leading progress glyphs are stripped, and the result is bounded to
48 characters, cut on a word boundary and never left ending on a preposition or
article.

## Agent support

Currently Claude Code, which publishes `ai-title` records into its session
transcript under `~/.claude/projects`. Set `CLAUDE_CONFIG_DIR` if yours lives
elsewhere. Other agents can be added by teaching `src/claude.ts` where their
transcripts live and how they name a session.

## Privacy

Only the title the agent already wrote for you is read, and only from transcripts
that resolve inside the agent's own projects directory. No conversation content,
no terminal output, and no pane contents are read, stored, or sent anywhere. The
plugin makes no network calls.

## Development

```sh
bun install
bun run check
bun test
```
