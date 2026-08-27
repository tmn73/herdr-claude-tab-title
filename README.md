# herdr-claude-tab-title

Mirrors each Claude Code session title, and its agent state, onto its Herdr tab.

Claude Code already maintains a title for every session and revises it only when
the subject of the work genuinely changes. This plugin copies that title onto the
tab, so the tab bar reads like a list of what you are working on rather than a
list of terminal numbers.

Herdr marks agent state in its sidebar but leaves the tab bar plain, so the same
mark is written in front of the label: `✅ Fix the booking total` for an agent that
finished, `🟡` while it works, `🔴` when it is blocked, `⚪` when it is idle. The
mark belongs to the plugin even on a tab you named yourself, so the state of every
agent is readable without opening the sidebar.

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
| `config` | Print the config file path and the settings in effect |
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

Everything lives in `config.toml`, inside the config directory Herdr gives the
plugin. The file is written on first run with every setting commented out, and
`config` prints where it is and what is in effect:

```sh
herdr plugin action invoke config --plugin claude-tab-title
```

```toml
# State mark written in front of every tab label:
# "color" (default), "symbols" for Herdr's monochrome set, or "off" for none.
palette = "color"

# Per-state marks, over whichever palette is in use. Any glyph your terminal font
# draws works, and "" leaves that state unmarked. This is the quiet setup: mark
# what deserves a look, leave idle tabs alone.
[marks]
idle = ""

# How often the worker looks for changes. Below 2000 is ignored.
interval_ms = 10000

# Character bound on a label. Below 12 is ignored.
max_length = 60
```

Edits take effect on the next pass, so there is nothing to restart, except
`interval_ms` which is read when the worker starts. A file that does not parse is
logged and ignored: a typo must not stop tabs from being named.

The same three settings can be overridden per run through the environment, which
wins over the file: `HERDR_CLAUDE_TAB_TITLE_STATUS`,
`HERDR_CLAUDE_TAB_TITLE_INTERVAL_MS`, `HERDR_CLAUDE_TAB_TITLE_MAX_LENGTH`.

Two more variables are read but are not this plugin's to define:

| Variable | Owner | Why it is read |
| --- | --- | --- |
| `CLAUDE_CONFIG_DIR` | Claude Code | Locates the transcripts, normally `~/.claude`. |
| `HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR` | Herdr | Where the settings live, and where the plugin records which labels are its own. Supplied automatically. |

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

The state mark is the exception, and it is not a name: a tab you named yourself
keeps your name and is only restyled in front. The name is remembered without the
mark, so rename it whenever you like and the next pass carries your new name.

A tab label is text Herdr paints itself: it carries no colour of its own, and
escape sequences in it would corrupt the bar. So the colour has to live in the
glyph, which is what the default `color` palette is for. `symbols` swaps in
Herdr's own `× ◐ ✓ ○`, so a tab reads exactly like its sidebar row, for a bar that
should stay quiet, and `[marks]` sets any glyph you like per state. A tab Herdr
sees no agent in gets no mark in any palette.

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
