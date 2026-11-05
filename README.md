<p align="center"><img src="templates/reactjs/public/mz_icon.png" alt="mazeratta" width="160" /></p>

# mazeratta

Tooling around **crumbs**: a dev-only annotation overlay for UIs. You point at
a component in the running app and the note reaches your coding agent with the
exact code location attached.

```
 annotated app ──POST /api/note──▶ server ──session──▶ coding agent
```

Two parts, plus the scripts that wire them into a project:

| dir | what |
|-----|------|
| [`server/`](server) | the note bridge (Go): receives notes, delivers them to a session: typed into tmux, or pushed over a Claude Code channel |
| [`templates/`](templates) | one app per framework (`solidjs/`, `reactjs/`, `svelte/`); each `src/crumbs/` is that framework's overlay library, the folder projects vendor |
| [`scripts/`](scripts) | the `mazeratta` command: `integrate-brief.ts` and `remove-brief.ts` print the briefs to add and remove crumbs; `local-crumbs.ts` keeps an integration uncommitted; `check-ports.ts` checks the ports agree; `verify-crumbs.ts` checks a project's barrels |

## Install

```bash
bun link        # in this repo: puts `mazeratta` on your PATH (bun unlink removes it)
mazeratta help
```

Every command below also works as `bun <mazeratta>/scripts/mazeratta.ts …`.

## Run

```bash
mazeratta serve                                     # :8080; types notes into the tmux session you run it from
mazeratta serve <session>                           # or into a named one
mazeratta serve -submit                             # and press Enter, so each note runs at once
cd templates/solidjs && bun install && bun run dev   # :3000, an annotated app
```

A typed note waits in the prompt for you to read and send. With `-submit` the
server presses Enter itself; since nobody reviews the note then, the server
also listens on `127.0.0.1` only and accepts only localhost pages, as in
channel mode below.

### Without tmux: a Claude Code channel

Claude Code can run the server itself and receive notes as
[channel](https://code.claude.com/docs/en/channels.md) events. That means no
tmux, and Claude acts on a note as soon as it arrives instead of leaving it in
the prompt for you to review. The channel appears as one more session,
`channel:claude-code`, next to your tmux sessions; it is the default session,
so templates work without any setup. Start Claude Code in your project with
the channel (add `--continue` to resume the last conversation; any other
`claude` flags pass through):

```bash
mazeratta claude
```

That runs `claude --mcp-config '<inline config>' --dangerously-load-development-channels
server:mazeratta`, the config starting `go -C <mazeratta>/server run . -channel`.

Confirm the development-channel warning, and check that the banner says
`Channels (experimental) messages from server:mazeratta…`. The config is passed
inline, so nothing is written to the project, and the server runs only in
sessions launched this way. Avoid registering it with `claude mcp add`
instead: Claude Code would then start it in every session in that project.
Sessions started without the dev flag would hold port 8080 and accept notes
that Claude Code silently drops.

Channels are a research preview. They need a claude.ai or Console login, and on
Team or Enterprise plans an admin must enable them. In this mode the server
listens on `127.0.0.1:8080` and accepts only localhost pages (add one with
`-origin https://host:port`).

Point a template (or any annotated app) at another note server with `VITE_API`, e.g.
`VITE_API=http://host:9000 bun run dev`.

## Add crumbs to an existing project

```bash
mazeratta integrate [dir]       # print a brief for your coding agent
mazeratta remove [dir]          # print a brief to remove every trace again
mazeratta commands install      # or: install /crumbs-integrate and /crumbs-remove for Claude Code
mazeratta commands uninstall    # delete those two commands
```

The brief detects the stack (SolidJS, React, Svelte; force one
with `--as`) and prints everything the agent needs: what it found, the copy
commands, the snippets for the app-shell crumb and the barrel, the
`CLAUDE.md` section that tells future sessions how to read a note, blockers
(e.g. a UI not built with Vite), the checks that prove it worked, and the server
command for the loop. It changes nothing itself. While it runs it prints what it
checks and finds to stderr; the brief itself, on stdout, asks the agent to
announce each step (`Step 3/7: …`), say what changed, and end with every file it
touched.

`mazeratta remove` is the reverse. It scans the project and lists every trace with its
file and line: the copied crumbs folders, the app-shell crumb, barrel entries,
styles aimed at the overlay,
crumbs sections in agent docs, and `VITE_API`. It names the commits that added
the crumbs folders, in case reverting them is simpler. Once the removal is complete, running it again prints "No crumbs
traces found". Like integrate, it prints what it scans and finds on stderr, and its brief asks the agent to report
each step.

In a Claude Code session inside the project, run `/crumbs-integrate` or
`/crumbs-remove` after `mazeratta commands install`, or paste a brief with
`! mazeratta integrate` (or `! mazeratta remove`).

### Keep it local (never committed)

To use crumbs only as a local dev tool, integrate on a clean tree, don't commit,
and save the result:

```bash
mazeratta local save    # keep the integration as a local set, in .git
mazeratta local auto    # every commit takes crumbs out first and puts them back after
mazeratta local         # status: on or off, what's saved, whether auto is on
```

With `auto`, just commit: git's pre-commit hook takes crumbs out of the files
and out of what's staged (so `git add -A` is safe), and the post-commit hook
puts them back, rebased onto the new commit. It refuses the commit, changing
nothing, if a staged file of yours still uses crumbs. Without it, or with
`git commit --no-verify`, do it by hand:

```bash
mazeratta off    # take crumbs out; your own changes stay
git commit …
mazeratta on     # put them back, rebased onto the new commit
```

`off` keeps what changed in the crumbs files since the save (new barrel entries
from `+` requests) and refuses, changing nothing, if your edits overlap a crumbs
change. It also lists any new import of a crumbs file, which would break once
the file is gone. If a pull changed a line crumbs modified, `on` refuses too;
`mazeratta on --merge` merges it with conflict markers, and `mazeratta local resave`
takes the resolved tree as the set. `mazeratta local manual` removes the hooks, and
`mazeratta local forget` deletes the set.

## Docs

- [`docs/hld.md`](docs/hld.md) — architecture and decisions
- [`docs/lld/server.md`](docs/lld/server.md) — internals
- `templates/<fw>/src/crumbs/README.md` — each overlay, including implementation notes

Code carries no comments; explanation lives in these docs.

## Checks

```bash
cd server && go vet ./...
mazeratta crumbs more <file>    # what + asks the agent to run: crumb <file>'s child components
mazeratta crumbs fewer <file>   # what − asks: uncrumb them
mazeratta check          # shared overlay files match across the ports
mazeratta verify [dir]   # barrels: no crumbs imports in components, reachable, real src paths
```

`mazeratta check` treats every folder in `templates/` (and every entry in `templates/status.json`) as a port, so a
new one is checked without editing the script. Each port must have a status in `status.json` (`beta` or `stable`;
all are beta for now) matching the status line in its README, its `src/crumbs/README.md`, `src/crumbs/CLAUDE.md`
and `src/components/CLAUDE.md`, and the same `util.ts` and `crumb.css` as the others. A missing or broken
`status.json` is reported as such.

Each template has its own check: `cd templates/<fw> && bun run check && bun run
build`. `check` runs the typecheck, then `verify-crumbs.ts --full-coverage --no-comments`.
