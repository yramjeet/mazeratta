# server — the note bridge

A small HTTP server that receives crumb notes and delivers them to the current
session: a tmux session, where they are typed for the agent to read, or, when
Claude Code started it with `-channel`, the `channel:claude-code` session, where
they are pushed as channel events (the `claude` package). Clients only ever see session
names. Every crumbs-annotated app (e.g. `templates/solidjs`) posts
to it. It reads no files.

It logs with plain `log/slog` to stderr.

## Forwarded notes (the message to the agent)

`POST /api/note` composes a single line and delivers it to the current
session, where a coding agent reads it: typed into tmux (no Enter, unless `-submit`), or pushed as
a channel event:

```
crumb @ <file> (<functionality>): <instruction>
```

`file` (the crumb's `src`) points at the UI component's file, and `functionality` is its name, from the file name: both the location and the
instruction are about that component.

## Format rules

- Keep it one line, composed by `composeNote`. The anchor (`file`,
  functionality) leads; the user's instruction trails after `: ` so everything
  after the colon is the note verbatim.
- `flattenWhitespace` collapses whitespace so the payload stays single-line. For tmux,
  `send-keys -l` types it literally and appends no Enter (the note is
  staged, not run) unless `-submit`, which presses Enter in a second
  `send-keys` after `submitDelay`; for the channel, `stripControl` also drops control and
  format characters before the push.

## Session

- The session is set via `POST /api/session` and read with `GET /api/session`, which also lists `sessions`: the
  channel when present, then `tmux list-sessions`. `-tmux` is the initial
  default, or `channel:claude-code` under `-channel` unless `-tmux` is given.
- Delivery follows the session name, never a client flag. `channel:claude-code`
  can't collide with a tmux name, because tmux forbids `:` in session names.
- Local dev tool: don't expose it beyond localhost as-is.

## Channel mode

- With `-channel`, Claude Code starts the server as an MCP server: stdin/stdout
  carry JSON-RPC, so **nothing but `Channel.writeMessage` in `claude` may write to stdout**. Logs
  go to stderr.
- A pushed note reaches the agent with no human review, so the local-only gates
  (`requireLoopbackHost`, the origin allowlist in `withCORS`, the loopback bind) are the
  security boundary. Don't relax them. They cover the whole server under
  `-channel` and under `-submit` (an auto-submitted tmux note is just as
  unreviewed), including notes sent to tmux sessions; a plain tmux server,
  whose notes wait for the user, stays without them.
- The event content is the same one-line note; `meta` repeats `file` and
  `functionality`. `instructions` in `claude` is what Claude reads about the
  channel; keep it in step with the note rules above.
