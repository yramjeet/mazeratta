# crumbs templates — how to add a UI framework

`templates/` holds one app per UI framework that has a crumbs overlay
(`solidjs/`, `reactjs/`, `svelte/`). Its `src/crumbs/` is the overlay library
projects vendor, and `src/components/CLAUDE.md` the barrel rule they copy. A
template holds only those two and the smallest app that typechecks and builds
them, wired the way `integrate-brief.ts` wires a project; nothing else, since
nothing else is copied. Each rule's status lives in `status.json`:
`beta` (under test, not yet approved) or `stable` (approved). Every port starts
in beta, and a new port does too. See **Status and approval** at the end.

This file is the instruction for an agent porting the overlay to a **new**
framework. The goal is a port a user can't tell apart from the others: same
pencil, same popover, same granularity row, same note payload.

Read the SolidJS port first (`solidjs/src/crumbs/`), then the React and Svelte ones
to see what a framework forces to differ (React renders a `display: contents`
span to find its root; Svelte loads the overlay by a DEV-guarded dynamic
import). Mirror their structure.

## The one hard requirement: the overlay compiles out of production

A production build must contain **no overlay code at all**: no component, no
CSS, no class names. Use `import.meta.env.DEV`, which Vite replaces with
`false`, so the branch is dead-code-eliminated. `withCrumb` returns the
component itself when it is false. Never a runtime flag that survives in the
bundle.

## What to replicate (the contract)

1. **Shared files, byte-identical:** `util.ts` and `crumb.css`. Copy them; `mazeratta check` fails if they
   differ across the ports.
   Helpers that aren't components go in `util.ts`, never one file per
   function; split it by the component that uses them only once it grows.
2. **`withCrumb(Component, {src, placement?, onSubmit?})`** adds no
   DOM where the framework allows it, attaching to the component's real root
   element.
   Crumbs are declared in a components barrel, never in component files.
3. **The popover:** opens at the pointer, portaled to `<body>`; a note input
   and the `+`/`−` granularity row; Enter sends, Escape cancels; one popover
   open at a time (`claimPopover`); clicks and keys inside it don't propagate to
   the crumbed component's ancestors.
4. **The payload:** `{file, functionality, text}` to `POST /api/note`,
   `functionality` being the name from `src` (`crumbNameFromSrc` in `util.ts`).
5. **Host styles and theme** come from `crumb.css` as is.

## Deliverables — mirror an existing port's folder

Create `templates/<fw>/` as a Vite app: `package.json` (its `check` runs the
typecheck, then `bun ../../scripts/verify-crumbs.ts . --full-coverage --no-comments`),
an entry `main.*`, an `App` shell, one demo component, the two barrels. Then:

- **`src/crumbs/`** — the shared files, the framework's `withCrumb` and overlay,
  an `index.ts` entry, and:
  - **`README.md`** — the status line, behaviour, usage and implementation notes
    (the code carries no comments);
  - **`CLAUDE.md`** — the conventions an agent follows when adding crumbs.
- **`src/components/CLAUDE.md`** — the barrel rule `integrate-brief.ts` copies into a
  project's components directory, including how to act on a granularity request.

Add the port to `status.json` as `beta`, and teach `integrate-brief.ts` and
`remove-brief.ts` to detect it. `mazeratta check` picks the new folder up by
itself.

## Verify before finishing

- `mazeratta check` passes.
- The prod build contains none of `crumb-pencil|crumb-gran|crumb-popover`; a
  dev build does.
- In dev, hovering a crumbed component shows the ✎ and a note reaches the
  server as `crumb @ <src> (<name from src>): <text>`.

## Status and approval

`status.json` is the source of truth, one entry per port:

```json
{ "solidjs": "beta", "reactjs": "beta", "svelte": "beta" }
```

The status is also the first line of `src/crumbs/README.md`
(`> **Status: beta.** …`), so it travels with every vendored copy, and
`integrate-brief.ts` prints it in the brief's Detected table. For a beta port, the
brief also asks the agent to tell the user and to report what doesn't work.

Ports are approved one at a time, once they have been tested on real projects:
integrated with `integrate-brief.ts`, used through the overlay, and taken out again
with `remove-brief.ts`. To approve one:

1. Set its entry in `status.json` to `stable`.
2. Change the status line in `templates/<fw>/src/crumbs/README.md` to
   `> **Status: stable.** Approved; changes keep the API and note format compatible.`
3. Run `mazeratta check`. It fails if a port has no status, a status isn't
   `beta` or `stable`, or the README shows a different status from `status.json`;
   also if a port lacks one of its files or a shared file differs.

A stable port that needs a breaking change goes back to `beta` the same way.
