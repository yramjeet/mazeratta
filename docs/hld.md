# mazeratta — high-level design

## Purpose

Point at a component in a running UI, leave a note, and have it reach a coding agent with the exact code
location attached.

## Parts

```
  ┌──────────────┐   POST /api/note    ┌──────────┐  tmux or channel    ┌──────────────┐
  │ templates/   │────────────────────▶│ server/  │────────────────────▶│ coding agent │
  │ any crumbed  │                     │ (Go)     │                     └──────────────┘
  │ app          │                     └──────────┘
  └──────────────┘

  templates/<fw>/src/crumbs — the library; adopting apps vendor a copy
```

| part | role | depends on |
|------|------|------------|
| `server/` | note bridge: composes one line per note, delivers it to a session (tmux, or a Claude Code channel) | tmux or Claude Code |
| `templates/` | one app per framework (`solidjs`, `reactjs`, `svelte`); `src/crumbs` in each is the overlay library with its agent rules | server (notes) |
| `scripts/` | Bun scripts: the integrate and remove briefs, local mode, the cross-port and barrel checks | reads `templates/`; prints, never edits, a target project (except `local-crumbs.ts`) |

## The note

Every annotation path posts `{file, functionality, text}` to
`POST /api/note`. The server composes one line and delivers it to the current
**session**: a tmux session, where it is typed with no Enter (or submitted, with
`-submit`), or, when Claude
Code started the server with `-channel`, the `channel:claude-code` session,
where it is pushed as a channel event:

```
crumb @ <file> (<functionality>): <instruction>
```

`file` is the component's file (the crumb's hand-written `src`) and
`functionality` its name, derived from that file name; location and instruction concern the same thing.

## Decisions

- **The server reads no files.** It is a single-purpose bridge shared by every
  client, and no endpoint reads
  arbitrary paths from disk.
- **The library lives in its template; consumers vendor copies.** Adopting
  crumbs means copying a folder, so copies are expected outside mazeratta.
  Inside it there is one copy per framework, in an app that builds, so the
  library is edited where it can be tested. `mazeratta check` keeps the
  files the three ports share identical.
- **The UI overlay costs nothing in production.** It compiles out through
  `import.meta.env.DEV`
  (SolidJS and React by a DEV branch, Svelte by a DEV-guarded dynamic import of
  the overlay component; in all three `withCrumb` returns the component itself). Each is a compile-time elimination, never a runtime
  flag.
- **UI crumbs are declared in barrels where the framework allows it.** SolidJS
  and React use `withCrumb` in a components barrel: component files contain no
  crumb code, and a granularity request only
  touches the barrel: `mazeratta crumbs more|fewer <file>` rewrites the
  children's barrel lines the same way every time, and the agent extracts
  components only when `more` finds none to crumb. SolidJS attaches to the component's real root element;
  React can't get a root DOM node without changing the component, so it renders
  inside a `display: contents` span (no layout box) and attaches to its first
  child. Svelte does the same with a `display: contents` span; because a
  `.svelte` file can only define one component, its `withCrumb` builds the
  wrapper by forwarding Svelte's public `(internals, props)` component call to a
  host component — the one place a port relies on a calling convention that is
  typed but not documented for user code (see `templates/svelte/src/crumbs/README.md`).
- **Adopting crumbs in an existing project is agent work, briefed by a
  script.** `integrate-brief.ts` only reads the project and prints a brief: what it
  detected, the exact copy commands and snippets, blockers, and how to run the
  loop. The agent does the edits, because wiring a barrel into an existing app
  means judgement (which regions are groups, which imports to repoint) that a
  generator would get wrong. `remove-brief.ts` is the reverse: an inventory of every
  trace, plus the steps to remove them. See [`lld/integrate.md`](lld/integrate.md).
- **Crumbs can stay local, toggled by git rather than by code.** `local-crumbs.ts`
  saves the integration (everything against `HEAD` right after integrating) in
  `.git`, where it is never committed or pushed, and switches it off before a
  commit and on after it, by hand or, with `mazeratta local auto`, from git's
  pre-commit and post-commit hooks. The toggle is a reversible patch plus copies of the
  new files, not a runtime flag, so a commit is byte-for-byte what it would be
  without crumbs, and the app needs no knowledge of the mode.
- **Clients only know sessions; the server picks delivery.** A session is an
  opaque name the UI lists and selects. tmux sessions work with any agent and
  leave the note in the prompt for the user to read before sending. The
  channel session (`-channel`, a Claude Code research preview) needs no tmux
  and starts a turn as soon as the note arrives. For it, Claude Code launches
  the server as an MCP server over stdio. Because a pushed note reaches the
  agent with no human in between, a `-channel` server, and a tmux one started
  with `-submit` to press Enter, accepts only local
  requests: a loopback bind, localhost browser origins (plus any given with
  `-origin`), and a loopback `Host`. See [`lld/server.md`](lld/server.md).
- **Code carries no comments.** Explanation lives in READMEs, this document and
  [`lld/`](lld).
- **Local dev tool.** No authentication; the server is meant to be reached from
  localhost only.

## Open

- Without `-channel` the server sends `Access-Control-Allow-Origin: *` and listens
  on all interfaces, so any page or host can post a note. (A `-channel` server is
  already restricted to local requests.) See [`lld/server.md`](lld/server.md).
