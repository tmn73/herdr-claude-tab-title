# herdr-claude-tab-title

Mirrors each Claude Code session title onto its Herdr tab.

Claude Code already maintains a title for every session and revises it only when
the subject of the work genuinely changes. This plugin copies that title onto the
tab, so the tab bar reads like a list of what you are working on rather than a
list of terminal numbers.

No model, no API key, no prompt. Reading a title costs nothing, so there is no
rate limit and no configuration you have to fill in before it works.

## Install

Requires Herdr 0.7.5+ and Bun.

```sh
herdr plugin install tmn73/herdr-claude-tab-title
herdr plugin action invoke start --plugin claude-tab-title
```

That `start` is only needed for the current session. From then on Herdr starts the
worker itself once its API socket is ready, so it survives a restart.

On a fresh install it may look like nothing happens, and that is deliberate: a
tab that already carries a name is treated as yours and left alone. New tabs get
titled as they appear. To hand your existing tabs over too, once:

```sh
herdr plugin action invoke reclaim --plugin claude-tab-title
```

For local development, point Herdr at a checkout instead:

```sh
herdr plugin link /path/to/herdr-claude-tab-title
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
herdr plugin action invoke <action> --plugin claude-tab-title
```

A useful keybinding for an immediate pass:

```toml
[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "claude-tab-title.sync"
description = "sync claude session titles onto tabs"
```

## Configuration

Two variables belong to this plugin. Both are optional.

| Variable | Default | Effect |
| --- | --- | --- |
| `HERDR_CLAUDE_TAB_TITLE_INTERVAL_MS` | `10000` | How often the worker polls. Values below 2000 are ignored. |
| `HERDR_CLAUDE_TAB_TITLE_MAX_LENGTH` | `60` | Character bound on a label. Values below 12 are ignored. |

Two more are read but are not this plugin's to define:

| Variable | Owner | Why it is read |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | Claude Code | Locates the transcripts, normally `~/.claude`. |
| `HERDR_PLUGIN_STATE_DIR` | Herdr | Where the plugin records which labels are its own. Supplied automatically. |

`HERDR_BIN_PATH` overrides the `herdr` binary if it is not on `PATH`.

## Behaviour

For each tab the worker picks the pane whose session should name it: the focused
agent first, then any agent with a session. It reads that agent's transcript and
applies the latest title it published.

**A label this plugin did not write is never overwritten.** A tab is claimed only
while it still carries Herdr's own placeholder — a digits-only or empty label — or
a label the plugin wrote itself. Name a tab yourself and it stays yours, including
tabs you named before installing this, and labels set by other plugins. `reclaim`
is the only way to hand one back.

Tabs with no agent, and sessions that have not published a title yet, are left
exactly as they are.

Titles are applied as published, keeping the agent's own wording, punctuation and
language. The only changes are collapsing whitespace and removing control
characters, which would corrupt the tab bar, plus the length bound above. There is
deliberately no cleverer trimming: an earlier version cut on word boundaries and
dropped trailing prepositions, which quietly threw away the Jira key at the end of
`Rechercher session Claude précédente pour ticket DS-940`.

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

## License

MIT
