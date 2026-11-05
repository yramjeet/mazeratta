# mazeratta

Tooling around **crumbs**. You point at a component in a running UI and leave a
note; it reaches a coding agent with the exact code location attached.

```
 annotated app ──POST /api/note──▶ server ──session──▶ coding agent
```

## The parts

```
server/        the note bridge (Go module `mazeratta/server`)          (see its CLAUDE.md)
  claude/           the Claude Code channel: MCP on stdio, the channel:claude-code session
package.json   only its bin: `bun link` puts `mazeratta` on the PATH
scripts/       the Bun scripts (run from anywhere; repo paths resolve from the script)
  mazeratta.ts        the `mazeratta` command: one entry point that runs the scripts below,
                      the server (serve) and Claude Code with the channel (claude)
  util.ts             helpers shared by the scripts: MAZERATTA_COMMAND, runQuiet, currentTmuxSession,
                      and where local mode keeps its manifest (read by remove-brief.ts too)
  report-progress.ts  the Report progress section both briefs print, built from their step titles
  traces.ts           the scan for crumbs traces, used by the remove brief and local mode
  claude-commands.ts  writes or deletes /crumbs-integrate and /crumbs-remove in ~/.claude/commands
  integrate-brief.ts  prints the brief an agent follows to add crumbs to an existing project
  remove-brief.ts     prints the brief to take every trace of crumbs out again
  local-crumbs.ts     keeps an integration uncommitted: save it in .git; auto takes it out of every commit
  check-ports.ts      every folder in templates/ is a port: status, required files, shared files identical
  granularity.ts      mazeratta crumbs more|fewer <file>: the + / − requests, done the same way every time
  verify-crumbs.ts    checks a project's barrels: no crumbs imports in components, reachable barrels, real src paths
templates/     one app per framework, with crumbs wired in           (see templates/CLAUDE.md)
  status.json        each port's status: beta or stable
  solidjs/ reactjs/ svelte/
    src/crumbs/      the overlay library — canonical, what projects vendor
    src/components/  the demo app; its CLAUDE.md is the barrel rule integrate copies
```

- **server** reads no files: it composes the note
  line and delivers it to the current session: typed into tmux, or pushed as a
  channel event when Claude Code started it with `-channel`. It is shared by
  every annotated app, which only ever sees session names.
- **Every port is currently beta** (`templates/status.json`): ports are tested
  and approved one at a time (`templates/CLAUDE.md`, "Status and approval"). A
  README's status line must match `status.json`.
- **`templates/<fw>/src/crumbs` is the library.** Edit it there, inside an app
  that typechecks and builds; adopting projects vendor a copy. Keep app
  concerns out of it. `util.ts` (every helper the overlay uses, no framework code) and `crumb.css` are shared by the three ports; `mazeratta check` fails if
  they drift.
- **integrate-brief.ts / remove-brief.ts** only read the target project; the brief each prints
  is the contract with the agent. Keep integrate's snippets in step with the
  templates, which are the reference wiring, and remove's patterns in step with
  what integrate adds (`docs/lld/integrate.md`).
- **UI crumbs live in barrels.** In every frontend (all three templates) component files contain no crumb code; each crumb is a
  `withCrumb(Component, {src})` entry (the name shown comes from the file) in the directory's `index.ts`. In Svelte, two-way `bind:` doesn't pass through a
  crumbed component.

## Docs, not comments

Code carries **no comments** — not even "why" comments. Explanation goes in the
docs, in the same change as the code:

- `docs/hld.md` — the system: parts, data flow, the note, key decisions.
- `docs/lld/server.md`, `docs/lld/integrate.md` —
  internals of each app and of the integration brief.
- `templates/<fw>/src/crumbs/README.md` — each overlay's behaviour *and*
  implementation notes; it travels with every vendored copy.

Compiler directives and pragmas (`/* @refresh reload */`) are not
comments and stay.

## Run it

```bash
mazeratta serve [<session>]                  # :8080; defaults to the current tmux session
cd templates/solidjs && bun install && bun run dev   # :3000, an annotated app
```

Or let Claude Code start the server as a channel. It serves the same API on
`127.0.0.1:8080` and adds a `channel:claude-code` session (the default) that
pushes notes straight into that Claude session; tmux sessions still work:

```bash
mazeratta claude    # claude --mcp-config <inline: go -C server run . -channel> --dangerously-load-development-channels server:mazeratta
```

The session starts as `-tmux`, or `channel:claude-code` under `-channel`;
`POST /api/session` changes it and `GET /api/session` lists the choices. Clients
never know how a session is delivered. `VITE_API` points a template at another
server.

## UI crumbs

- **UI crumbs** (`templates/<fw>/src/crumbs`) — a dev-only
  annotation overlay for UI, one port per framework with the same behaviour,
  popover and note payload, declared with `withCrumb` in a components barrel.
  `util.ts` and `crumb.css` are byte-identical
  across the ports. Compiled out of production via `import.meta.env.DEV`.

## Notes forwarded to the agent

Every annotation path posts to `POST /api/note`; the server composes one line
and delivers it to the current session (typed into tmux with no Enter unless `-submit`, or pushed
over the channel) where a coding agent reads it:

```
crumb @ <file> (<functionality>): <instruction>
```

Read such a line as a **user annotation pointing at code**: open `<file>`,
treat `<functionality>` as the named target, and act on everything after the
`:` as the instruction. The location *and* the instruction concern that
component.
The mechanics live in `server/CLAUDE.md`.

## Endpoints (server)

- `POST /api/note` — `{file, functionality, text}`; delivered to the current session.
- `GET /api/session` / `POST /api/session` — read / set the target session;
  `GET` also lists the available ones (`sessions`: the channel, if any, then the
  running tmux sessions).
