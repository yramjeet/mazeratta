# server — low-level design

`server/main.go` (HTTP, sessions, tmux) and the package `server/claude` (`channel.go`)
(the Claude Code channel: MCP on stdio, the `channel:claude-code` session).

```bash
go run . -tmux <session> [-addr :8080]
go run . -channel [-tmux <session>] [-addr 127.0.0.1:8080] [-origin https://host:port]...
```

The second form is how Claude Code starts the server; it is not run by hand.
It comes from an inline `--mcp-config` at launch, together with
`--dangerously-load-development-channels server:mazeratta` (verified against a
live session: a posted note arrived as a channel event and Claude acted on it).
Prefer that to a registered `.mcp.json` entry. A registered server starts in
every session of the project, and in one launched without the dev flag the
handshake still completes, so the server accepts notes that Claude Code then
drops without telling anyone.

## Routes

| route | handler | behaviour |
|-------|---------|-----------|
| `GET /api/session` | `handleGetSession` | `{session, sessions}`: the current target and the available ones |
| `POST /api/session` | `handleSetSession` | body `{session}`; trimmed, rejected if empty, or if it is the channel session on a server without `-channel` (400) |
| `POST /api/note` | `handleNote` | body `noteRequest`; delivered to the current session; 502 if tmux fails, 503 if the channel isn't initialised |

Without `-channel` or `-submit`, all routes go through `withCORS(mux, nil)`, which allows any
origin so a dev frontend on another port can call them, and answers `OPTIONS`
preflights with 204. Under `-channel` or `-submit`, see *Local-only gates*. Errors are JSON
`{error}` via `httpError`.

## State

`server.session` is the only state. It starts from `-tmux`, or from
`channel:claude-code` under `-channel` when `-tmux` isn't given, and is replaced
by `POST /api/session`. It is read and written without a lock: this is a
single-user local tool.

`listSessions()` lists the channel session first (only under `-channel`), then
`tmux list-sessions -F '#{session_name}'`, one name per line; if tmux is missing
or has no server, there are no tmux entries. `POST /api/session` doesn't
require a name to be in the list, so a tmux session started later still works.

**Delivery follows the name.** `handleNote` pushes to the channel when the
session is `channel:claude-code` and the channel exists, and otherwise runs
`typeIntoTmux`. Clients never see how a session is delivered. tmux forbids `:`
in session names, so the channel name can't collide with one.

## Composing a note

`noteRequest` is `{file, functionality, text}`. `composeNote` builds:

```
crumb[ @ <file>][ (<functionality>)]: <text>
```

- The location is omitted when `file` is empty. There is no line: a crumb is
  declared in a barrel and points at the component's file.
- The anchor leads and the instruction trails, so everything after the first
  `": "` is the user's note verbatim.
- Every field goes through `flattenWhitespace` (`strings.Fields` + single spaces), which
  collapses newlines and tabs so the payload stays on one line.

## Delivering to tmux

`typeIntoTmux` runs `tmux send-keys -t <session> -l -- <text>`:

- `-l` sends the text literally, so words like `Enter` or `C-c` are typed, not
  interpreted as keys.
- No `Enter` is appended: the note is staged in the agent's prompt for the user
  to submit. With `-submit` the server presses it: a second
  `send-keys -t <session> Enter`, `submitDelay` (100ms) after the text. In the
  same call it would be typed as part of the burst, which an agent's input can
  treat as a paste and keep as a newline; separate and a moment later, it is a
  keypress. `-submit` turns on the local-only gates below.
- `--` stops option parsing, so text starting with `-` is safe.

## Delivering to the channel (`server/claude`)

Under `-channel`, Claude Code spawns the server and talks MCP (JSON-RPC 2.0, one
message per line) on stdin/stdout. Only `Channel.writeMessage` touches stdout,
behind a mutex; all logs go to stderr.

- **Handshake.** `initialize` gets back the client's `protocolVersion` (or
  `2025-06-18`), the capability `experimental["claude/channel"]: {}`, and
  `instructions`, the text Claude reads about the channel (`instructions`:
  how to read a crumb note, that the channel is one-way, and to confirm
  destructive or unrelated requests in the terminal). `ping` is answered; any
  other request gets `-32601`; notifications other than
  `notifications/initialized` are ignored.
- **Readiness.** Notes are refused with 503 until `notifications/initialized`
  arrives, since Claude Code silently drops events sent earlier.
- **The event.** `notifications/claude/channel` with `content` set to the same
  one-line note and `meta` set to `{file, functionality}` (keys must be
  identifiers). `stripControl` removes control and format
  characters (ESC, bidi overrides) from content and meta; `main` flattens the
  whitespace first and passes `file` and `functionality` as a `Meta`, so
  the package knows nothing of the HTTP request.
- **Lifetime.** The process exits when stdin closes, i.e. when the Claude
  session ends, which frees the port.
- **Both loopbacks.** A loopback `-addr` (`127.0.0.1`, `::1` or `localhost`)
  is served on `127.0.0.1` *and* `[::1]`, because the frontends post to
  `localhost`, which resolves to `::1` first on macOS. Bound to `127.0.0.1`
  alone, a plain server on `:8080` would take the `localhost` traffic. `[::1]`
  is skipped only when the machine has no IPv6 loopback.
- **Busy port.** A bind is not proof the port is free: on macOS a specific
  address binds alongside another process's wildcard `:8080` (and the reverse),
  and each gets part of the traffic. So both modes first dial the port on both
  loopbacks (`checkPortFree`). If something answers, channel mode logs a warning
  and leaves HTTP off, while the MCP side keeps running so the session doesn't
  show a failed server; that session gets no notes. Without `-channel` the
  server exits with status 1.

## Local-only gates (`-channel`, `-submit`)

A pushed note starts a Claude turn with no human in between, and so does an
auto-submitted tmux note, so whoever can reach `/api/note` can drive the agent.
Under `-channel` or `-submit` the whole server (tmux sessions included) accepts
only local requests. A plain tmux server leaves every note in the prompt for the
user, so it keeps the open defaults:

- **Bind.** `-addr` defaults to `127.0.0.1:8080`; a non-loopback address exits
  with status 2.
- **Host.** `requireLoopbackHost` returns 403 unless the `Host` header is `localhost` or a
  loopback IP, which blocks DNS rebinding.
- **Origin.** `withCORS(mux, origins.allow)` sends no wildcard. A request carrying
  `Origin` must be `http(s)://localhost` or a loopback IP on any port, or an
  exact `-origin` value; otherwise 403, preflights included. An allowed origin
  is echoed with `Vary: Origin`. No `Origin` (curl, local scripts) passes:
  those already run on the machine.

## Logging

Plain `log/slog` with the default text handler on stderr, at INFO. Under
`-channel` stdout carries JSON-RPC, so logs must never go there; Claude Code
keeps the server's stderr in its own MCP log rather than the terminal.

- **`server/discover`.** Claude Code asks for it on connect. The server still
  answers `-32601` (it doesn't implement it), but logs that at debug, not as a
  warning, so Claude Code's MCP log doesn't gain one at every start.

## Security notes

Without `-channel`:

- Listens on all interfaces (`:8080`) and allows any origin: any web page the
  user opens, or any host on the network, can post a note or retarget the
  session.
- `flattenWhitespace` removes whitespace control characters but not others (e.g. ESC),
  which reach the agent's terminal UI as typed input.
- Session names are not validated beyond non-empty.

Planned hardening for that mode: bind `127.0.0.1` by default, allow only
configured origins, require `Content-Type: application/json`, strip all control
characters, and validate session names against `^[A-Za-z0-9_.-]+$`. The
`-channel` gates above already implement most of it.
