# scripts/integrate-brief.ts and scripts/remove-brief.ts — low-level design

## What it is

A read-only Bun script that inspects an existing project and prints a Markdown
brief for a coding agent: how to vendor the framework's crumbs library, wire it
in, tell future sessions how to read a note, and prove it worked. It never
writes anything.

The brief is built by one function per section (`headerSection`,
`detectedSection`, `blockersSection`, `stepsSection`, `runLoopSection`,
`keepLocalSection`), joined in order at the end; the project's facts are read
once, and the stack's into one `Stack` record by `inspectStack`.

**Two logs.** While it inspects the project, the script prints what it checks
and what it finds to stderr (`logToStderr`, in `util.ts`: the git root, `package.json`, the
lockfile, each stack and why, the entry and where it came from, the components
directory, the crumbs folder, the shell, blockers, the step count). The brief
goes to stdout alone, so `mazeratta integrate > brief.md` stays clean while the
terminal (or a `/crumbs-integrate` run) shows the detection. The brief in turn
has a **Report progress** section, built from the step titles
(`progressSection`): the agent says `Step N/M: <title>` before each step (`progressSection` and
`stepTitles` are in `report-progress.ts`, shared with remove), what
changed after it, stops if a step can't be done as written, and ends with every
file it touched and each "Done when" result. Step titles are therefore actions
("Write every `src` relative to…"), since they are read back as the checklist.

## Why a brief and not a generator

Copying the rule folder is mechanical; everything after it isn't. Deciding which
regions are groups, which consumers to repoint at the barrel, whether an inline
region is safe to extract, and how the app's theme is switched needs the code
read with judgement. So the script supplies facts and exact
snippets, and the agent edits. A brief also degrades well: when detection
misses something, the agent sees "not found" and looks, instead of a generator
writing a wrong file.

## Detection

| fact | how |
|------|-----|
| UI framework | `svelte`, `solid-js`, `react` in `package.json` dependencies or devDependencies |
| bundler | `vite` in deps, or a Vite-based meta-framework (SvelteKit, SolidStart, Astro). Next.js and Create React App are named as not Vite |
| entry | the module `<script src>` in `index.html`, else the usual `src/main.*` / `src/index.*` |
| app import | the first `import <…App…> from "…"` line in the entry; resolved to a file by trying the common extensions |
| components dir | `<entry dir>/components`, `src/lib/components`, `components`, `app/components` |
| package manager | lockfile: bun, pnpm, yarn, else npm |
| `src` prefix | the project's path relative to `git rev-parse --show-toplevel` |
| tmux session | `tmux display-message -p '#S'` when `$TMUX` is set |

`--as <stack>` replaces detection, and may be given once. With several stacks
found and no `--as`, the brief prints no steps and asks for one: each stack would
vendor its library into the same `crumbs/` and crumb the same shell in
`src/index.ts`, so two sets of steps would contradict each other.

## Blockers

Listed before the steps, for the agent to resolve with the user rather than work
around:

- **No Vite.** Every port compiles out through `import.meta.env.DEV`. Other
  bundlers don't define it, so the copy would throw or ship. The brief forbids
  patching the vendored copy, since that breaks refreshing it from its template.
- **Svelte < 5** (the library uses runes) and **React < 17** (it relies on the
  automatic JSX runtime).
- **A crumbs folder already at the destination.**

## Choices encoded in the brief

- **`src` is relative to where the agent runs.** The note's `file` is opened by
  the agent from its working directory, which in a monorepo is the git root, so
  the brief prefixes every `src` with the project's path from there.
- **The shell's crumb goes in `src/index.ts`**, a barrel like any other. An
  entry named `index.*` is renamed to `main.*` first (`git mv`, plus its
  `index.html` script tag), because `index.ts` beside `index.tsx` makes `"."`
  ambiguous. The entry then imports `{ App } from "."`, aliased if it used
  another name.
- **The theme comes from `<html>`, not from the copy.** The overlay reads
  `data-theme` or a `.light`/`.dark` class on `<html>`, else the OS. The brief
  asks the agent to pin `data-theme` only when the app is single-theme with no
  switch, or to mirror an unusual switch onto `<html>`, so `crumb.css` stays
  identical to its rule.
- **Coarse first.** Only the app shell and the first level of named regions get
  crumbs. Finer coverage comes from the user's `+` requests, which keeps the
  first change small and puts the granularity control in the user's hands.
- **The host's conventions win.** mazeratta's no-comments rule and full
  barrel coverage aren't imposed: the brief runs `verify-crumbs.ts` without
  `--full-coverage` or `--no-comments`, since neither holds in an existing app. The vendored folder
  is the exception: it stays byte-identical to its rule.
- **Prod leak check by class name.** The brief greps the build output for
  `crumb-pencil|crumb-gran|crumb-popover`, as the rules' own `CLAUDE.md` do.
- **The server is not started by the agent.** The brief ends with both ways to
  run the loop, for the user: the tmux command, and the channel launch
  (`claude --mcp-config '<inline config>' --dangerously-load-development-channels
  server:mazeratta`, which writes nothing to the project). Either one
  binds a port and puts notes in front of an agent, so that stays the user's
  decision.

## Keeping it in step

The snippets (the shell's `src/index.ts`, a barrel entry) are the
templates' files with paths substituted. When a template's wiring changes, change the
brief in the same edit. The check: strip a template of its crumbs wiring (the
crumbs folder, both `index.ts` barrels, the components
`CLAUDE.md`), apply the brief, and confirm the typecheck, the prod build with no
overlay class names, and a `NODE_ENV=development` build with them.

## mazeratta.ts — the command

One entry point, `mazeratta <command>`, so nobody types a script path or the
channel's MCP config. `package.json` holds only its `bin`; `bun link` in the
repo symlinks it into `~/.bun/bin`, and `import.meta.dir` resolves through the
link, so the command finds the scripts and `server/` from anywhere.

- `integrate`, `remove`, `local …`, `verify`, `check` run the matching
  script with the arguments unchanged; `on` and `off` are short for `local on`
  and `local off`, the two run around every commit; `commands install|uninstall`
  runs `claude-commands.ts`.
- `serve [session] [flags]` runs `go run .` in `server/`. A bare first argument
  is the tmux session; with none, and no `-tmux` or `-channel`, it takes the
  tmux session it was run from, and refuses outside tmux rather than typing
  notes into a session that may not exist.
- `claude [flags]` execs `claude` with the inline `--mcp-config` and
  `--dangerously-load-development-channels server:mazeratta`, passing the rest
  through (`--continue`, a prompt). Nothing is written to the project.

The briefs and `local-crumbs.ts` print commands through `MAZERATTA_COMMAND`
(`util.ts`): `mazeratta` when it is on the PATH, else `bun
<mazeratta>/scripts/mazeratta.ts`, so a printed command always runs. The
pre-commit hook and the Claude Code commands keep the script's absolute path,
and the hooks Bun's too (`process.execPath`): git GUIs run hooks without the
user's shell PATH. Only mazeratta needs Bun; the target project keeps its own
package manager (npm, pnpm, yarn or bun, from its lockfile).

## granularity.ts — `mazeratta crumbs more|fewer <file>`

What the `+` and `−` buttons ask the agent to run, so a granularity request
gives the same edit every time instead of the agent's reading of a prose rule.

- **Children** are the components `<file>` imports by name from a barrel
  (`import { Header } from "."`), followed through `export * from "./auth"`
  into sub-barrels. A component imported from its own file isn't a child; the
  command lists it as something to fix (the barrel rule forbids that import).
- **more** rewrites each child's plain re-export,
  `export { default as X } from "./X"`, as an entry: `import XBase from "./X"`
  after the last import, `withCrumb` imported from the nearest `crumbs/` above,
  and `export const X = withCrumb(XBase, { src })`, `src` being the file relative
  to the project or the git root, whichever the project's existing entries use.
  An entry holds nothing else, so `fewer` then `more` gives back the same line.
  Crumbed children are left alone: one level per request.
- **fewer** rewrites each crumbed child's entry back as a plain re-export from
  the same module, drops its `XBase` import, and drops the `withCrumb` import
  once nothing uses it. The clicked component's own entry stays.
- **Extraction stays with the agent, and only when needed.** With no child
  components, `more` changes nothing, says what to do and exits 3: the agent
  extracts the regions (one file each, re-exported plainly, imported from the
  barrel in `<file>`), then runs `more` again, which crumbs them. So the
  judgement is only *how* to split; *what gets crumbed* and *how the barrel
  reads* follow from the code.
- `<file>` is the note's path, tried from the current directory and from the git
  root, as `src` paths are written either way. Only barrels are written.

## verify-crumbs.ts

Checks what the barrel model loses silently, on a template or an integrated
project (`mazeratta verify [dir]`). The components
directory is the first of `src/components`, `src/lib/components`,
`components`, `app/components` that exists, as in the integrate brief. A barrel
is a directory's `index.ts`, `index.js` or `index.tsx`: the brief reuses an
existing barrel whichever it is. An unknown option is refused (exit 2), so a
mistyped `--full-coverage` can't quietly run the lenient check.

Always:

1. No component file imports the crumbs folder, by a relative path or an alias
   (`@/crumbs`, `$lib/crumbs`); only barrels declare crumbs.
2. Every barrel below the components root is re-exported by its parent's
   barrel as `./<dir>`, all the way up: `auth/forms/index.ts` by
   `auth/index.ts`, and that by the root. A missing link anywhere makes the
   crumbs below it unreachable.
3. Every `src` in a barrel that calls `withCrumb(` points at a file that
   exists, relative to the project or to the git root (the brief prefixes
   `src` from the git root in a monorepo). Only barrels are read, so an app's own
   `src:` keys (an image, an iframe) aren't mistaken for crumbs.

With `--full-coverage`, which the templates pass: every component has an entry
in its directory's barrel (its `./Name` or `./Name.svelte` imported, in either
quote style), and every directory of components has a barrel. An
integrated project crumbs one level and grows from `+` requests, so this would
fail it by design.

With `--no-comments`, which the templates pass: no comment anywhere in
`src/`, `src/crumbs/` included: a comment-only line, a trailing `//` not
preceded by `:` (so URLs pass), `<!--` in Svelte, any `/*` in CSS.
`@refresh` pragmas pass.

Barrels are read as code, never prose: a commented-out entry doesn't count.
Each template's `bun run check` runs it after the typecheck, from
`../../scripts`, so there is one copy and the templates hold only what projects
vendor plus the app that builds it.

## remove-brief.ts

The reverse brief, and also read-only. It reports every trace, so a removal is
done when a rerun prints "No crumbs traces found".

It logs the same way as integrate: on stderr, how the files were listed, the
vendored folders, the whole files to delete, the hits per kind (in step order),
the integration commits, the local set and the step count; in the brief, a
**Report progress** section over its steps. A brief with no steps (nothing
found, or local mode on, where `mazeratta off` does the removal) has none.

**What it scans.** In a git repo, `git ls-files --cached --others
--exclude-standard`, so ignored files and build output are skipped. Otherwise
it globs the whole tree, minus dependency directories anywhere (`node_modules`,
`.venv`, `__pycache__`, …) and build output at the top level only (`dist*`,
`build`, `out`, `target`, `vendor`): a `src/build/` of source is still read.
Only source, style, Markdown and `.env` files are read.

**What counts as a trace:**

| kind | found by |
|------|----------|
| vendored folder | a `crumbs/` directory holding a whole signature set: `util.ts`, `crumb.css`, `CLAUDE.md` and `README.md`. One matching file name isn't enough: a project's own `crumbs/` (a breadcrumbs feature) must never get `rm -r` |
| whole files | a components `CLAUDE.md` that starts with the copied components rule's heading |
| appended rules | a `CLAUDE.md` where that heading comes later: the project had its own rules and the integration appended the crumbs ones, so only that part is deleted |
| entry | `import { App } from "."` (or `./index`) |
| barrel entry | `export const X = withCrumb(XBase, …`: anchored to an export, so an app's own `Comlink.wrap(worker, {…})` isn't rewritten |
| import | from any path ending in `crumbs` (relative or alias: `../crumbs`, `@/crumbs`, `$lib/crumbs`, `./crumbs/index`); a side-effect `import "…/crumbs/…"` |
| css | the overlay's class names outside the vendored folder |
| docs | Markdown mentioning the note line, `withCrumb`, or crumbs with barrel, granularity, overlay, vendored or mazeratta |
| env | `VITE_API` in `.env*` or a Vite config |
| theme | `data-theme` on `<html>` in an `index.html`: the integrate theme step may have pinned it, so the brief has the agent check git before dropping it |
| mention | catch-all, last: any other `crumb`/`crumbs` word in code, style or HTML (comments the integrating agent wrote). `\b` keeps a project's own `breadcrumb` out |
| mcp | a `"mazeratta":` entry or `-channel` argument in `.mcp.json`: a channel registered with `claude mcp add` instead of the inline launch; removed with `claude mcp remove mazeratta -s project` |

Each line is assigned to the first kind it matches, so it is listed only once.
Files inside a vendored folder aren't scanned line by line; the whole folder is
deleted.

**Choices encoded in the brief:**

- **An uncommitted integration is the user's call.** When the vendored folder
  is untracked, the brief asks the agent to offer discarding it wholesale
  (restore and delete untracked, listing what other uncommitted work would go)
  or committing first, rather than starting on a dirty tree. Barrels that are
  untracked are named as created by the integration, so they are deleted
  rather than turned into re-exports.
- **Revert first if possible.** `git log --diff-filter=A` on the vendored
  folders names the commits that added them. If those commits hold only the
  integration, reverting them is the cleanest removal; the rerun then catches
  crumbs added later.
- **Barrels stay as plain re-exports.** `X = withCrumb(XBase, …)` becomes
  `export { default as X } from "./X"`, so no consumer changes. A barrel the
  integration created can be deleted instead, with its consumers repointed.
- **Docs matches are listed for review, not deletion.** The pattern is broad, and
  "crumbs" can be an ordinary word.
- **Files are deleted last**, after every reference to them is gone, so the
  project builds at each step. That includes the catch-all mentions: a
  reference no narrower rule recognised still lands before the folder goes.

`mazeratta commands install` (`claude-commands.ts`) writes `/crumbs-integrate`
and `/crumbs-remove` to `~/.claude/commands`, each running its brief with
`!bun <script> $ARGUMENTS`; `uninstall` deletes both. It is the only write
either brief has, so it lives in its own script.

**The check:** take a copy integrated with integrate's brief, apply remove's
brief, and confirm the rerun prints nothing found, the typecheck and build pass,
and no overlay class names appear in the build output.

## local-crumbs.ts

Crumbs as a local dev tool: integrated in the working tree, never committed.
The state lives in `.git/mazeratta-local/` (`git rev-parse --absolute-git-dir`,
so each worktree has its own), which git never commits or pushes:

| file | holds |
|------|-------|
| `manifest.json` | `state` (on/off), the `base` commit, the saved `files` and `tracked` paths |
| `tracked.patch` | `git diff --binary HEAD` at save: the integration's edits to tracked files |
| `files/` | copies of the untracked paths at save (`git ls-files --others --directory`), e.g. `src/crumbs/`, the barrels, a renamed entry |

Commands: `status` (the default), `save`, `resave`, `off`, `on [--merge]`,
`auto`, `manual`, `forget`; `mazeratta off` and `mazeratta on` are short for
the two used most. Each takes only its own flags and refuses others. A command
that refuses ends with the command to run next. Steps are logged to stderr;
outcomes go to stdout.

**save** takes *every* change against `HEAD` as the integration, so it refuses
without crumbs traces (`findTraces` in `traces.ts`, the scan the remove brief
uses) and prints what it captured for the user to check. It unstages first: a `git mv` rename is then a deleted tracked
file plus a new untracked one, which the two halves of the store can each
reverse. **resave** re-captures while on, after a merge or when a crumbs change
had to touch tracked files.

**off** dry-runs `git apply -R --check` first and changes nothing if it fails
(an edit overlaps a crumbs hunk). Then it copies each saved new path's *current*
content back into the store, reverse-applies the patch, and only then deletes
the new paths, so a failed reverse leaves nothing half done. So
barrel entries added after the save (granularity `+`) are kept, because they
live in files crumbs created. Real work in crumbs-modified files survives
wherever it doesn't share a hunk. After it, it scans for leftovers: anything
the trace scan still finds, and relative imports that resolve to a removed path.
Path aliases aren't resolved; the project's typecheck catches those.

**on** refuses if a saved new path exists, or if the patch no longer applies
(`HEAD` changed a line crumbs modified), or if the snapshot in `files/` is
incomplete. `--merge` merges with `git apply --3way`, leaving conflict markers,
instead. When the tree was clean before `on`, which is the normal case right
after a commit, it re-captures the patch against the new `HEAD`, so the set
follows the branch.

**auto** installs git's pre-commit and post-commit hooks, each running this
script. The pre-commit hook, while crumbs are on, runs every check before
changing anything: the patch reverses in the working tree; each staged file
crumbs modified still holds the crumbs hunks in the index
(`git apply -R --cached --check`); and no staged file of the user's still uses
crumbs (a trace, or an import of a crumbs path). Any failure stops the commit
with nothing changed. Then it does `off`, unstages crumbs' new paths
(`git rm --cached`), reverses crumbs' hunks in the staged copy of each
crumbs-modified file (the user's own staged hunks there stay), and leaves a
marker, `taken-out-for-commit`. git re-reads the index after the hook, so the
commit holds only the user's work. The post-commit hook does `on` only when that
marker exists, so it never turns on crumbs someone took out by hand; a commit
aborted between the two (an empty message) leaves crumbs off, and `status`
says so. `auto` never overwrites a hook it didn't write; it prints the line to
add. `manual` removes the hooks. `git commit --no-verify` skips the pre-commit
hook, and with it the marker, so the post-commit hook does nothing either.

`remove-brief.ts` knows the store: with a saved set it leads with off, forget, manual,
then a rerun. While the set is on, that is the whole brief, because `off` already
reverses everything the save captured, and listing the manual steps (or offering to
discard the uncommitted integration) would only invite a second, conflicting
removal. The rerun's ordinary brief covers anything crumbed after the save.
