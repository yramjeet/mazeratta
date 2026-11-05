# crumbs (Svelte)

> **Status: beta.** Under test and not yet approved; behaviour and API may still change.

A **dev-only** Svelte 5 overlay that lets you leave a note on any UI component and
have it delivered to a coding agent. Each UI piece gets a crumb declared in a
barrel, so you can annotate it in place without the component knowing.

## Behaviour

Hover any wrapped component and a pencil ✎ appears. Click it to open a popover
**at the pointer** with two options: a note input (focused, so you can just
type) and a **Granularity** row. Only one popover is open at a time: opening
another closes this one. Press **Enter** — the note, together with the
component's **source path** and **name** (from the file name), is sent to the backend
(`POST /api/note`), which forwards it to a coding agent as a single line:

```
crumb @ src/components/Toolbar.svelte (Toolbar): make Save the primary action
```

Press **Esc** to cancel. The component is never modified directly — a crumb only
*sends a note*; acting on it is the agent's job.

The popover opens next to the click point rather than at the component's edge, so
it stays within reach on tall components. It's portaled to `<body>` and
positioned against the viewport, flipping to the other side of the cursor near an
edge; `placement` only chooses which side is tried first.

### Granularity

Granularity is how much of the UI has crumbs on it — and it lives in the source,
not at runtime. The popover's **Granularity** row has two buttons, and each
forwards one fixed instruction to the agent:

| button | the agent is asked to |
|--------|-----------------------|
| `+`    | give this component's children their own crumbs — one per group, each in its own file and barrel entry |
| `−`    | remove those children's crumbs — their barrel entries, leaving the files alone |

Clicking changes nothing on screen: the request goes to the agent, and the UI
follows once it has edited the code. Every crumb stays annotatable at all times —
there is no depth gate to get past.

### Dev-only

`withCrumb` opens with:

```ts
if (!import.meta.env.DEV) return Comp;
```

In a production build Vite replaces `import.meta.env.DEV` with `false`, so the
wrapper is never created, the overlay is dead-code-eliminated, and your component
ships exactly as written — **zero runtime, zero bytes**. No build plugin
required. (The overlay component is loaded by a
DEV-guarded dynamic `import()`, so its chunk is never emitted.)

## Adopting in a project (init)

1. Copy this folder into your app as `src/crumbs/`.
2. Add a barrel to your components directory (see **Usage**), and
   copy the components rule — `src/components/CLAUDE.md` in mazeratta's template
   for this framework — into that directory as `CLAUDE.md`, so the conventions and how to act on a
   granularity request are in context whenever a component is created there.
3. Point delivery at your backend (default `POST /api/note`, see `postCrumbNote` in `util.ts`).

Nothing else to wire up: the granularity buttons send notes, so there is no
provider to mount and no state to thread through your app.

## Usage

Declare crumbs in a barrel. Components stay plain:

```ts
// src/components/index.ts
import { withCrumb } from "../crumbs";
import ToolbarBase from "./Toolbar.svelte";

export const Toolbar = withCrumb(ToolbarBase, { src: "src/components/Toolbar.svelte" });
```

`withCrumb` adds **no layout box**: it renders the component inside a
`display: contents` span — an element with no box of its own — and attaches to
the span's first child, the component's real root, portaling the pencil and
popover to `<body>` and positioning them from that element's rect. Flex, grid,
sticky and table layouts are untouched.

## Crumb meta

Passed to `withCrumb`:

| field       | type                                 | notes                                                 |
|-------------|--------------------------------------|-------------------------------------------------------|
| `src`       | `string` (required)                  | the component's module path; also its name in the popover and the note (`SignInForm` → "Sign in form") |
| `placement` | `"top" \| "bottom"`                  | preferred side of the cursor; auto-flips near an edge  |
| `onSubmit`  | `(note: CrumbNote) => Promise<void>` | override delivery (default `POST /api/note`)           |

## Files

- `Crumb.ts` — `withCrumb`, the HOC: attaches a crumb to a component, adding no layout box
- `Host.svelte` — what `withCrumb` renders: the component in a `display: contents` span, plus the overlay
- `Overlay.svelte` — the pencil, the popover, and both ways a crumb talks to the agent (loaded lazily, dev only)
- `loadOverlay.ts` — the DEV-guarded dynamic import of `Overlay`
- `util.ts` — the overlay's helpers, no framework code and identical in every port: the backend call (`postCrumbNote`), the granularity wording, popover placement (`placePopover`), one popover at a time (`claimPopover`) and the `portalToBody` action Svelte moves the pencil and popover to `<body>` with
- `types.ts` — `CrumbMeta`
- `crumb.css` — its styles (imported by `Overlay`)
- `index.ts` — the public API: `withCrumb`. The types and helpers stay internal; a custom `onSubmit` imports `CrumbNote` from `util.ts`
- the barrel rule to copy into your components directory lives beside this
  folder in the template, as `src/components/CLAUDE.md`

See `CLAUDE.md` for the conventions an agent follows when adding crumbs.

## Implementation notes

- **How `withCrumb` makes a component.** A barrel is TypeScript, and a `.svelte`
  file can only define one component, so the crumbed component is built in code.
  A Svelte 5 component is a function with the public signature
  `Component<Props>` — `(internals, props)`. `withCrumb` returns
  `(internals, props) => Host(internals, { component, props, meta })`: it
  passes `internals` through untouched (the type documents it as "do not use or
  modify", which this honours) and hands the original component, its props and
  the meta to `Host`.
- **The caveat.** That call signature is in Svelte's public types but isn't
  documented as something user code calls. If a future Svelte changes it, the
  crumbed components fail to mount in development — loudly, not silently — and
  `svelte-check` flags the cast in `Crumb.ts`. Production is unaffected
  either way: there `withCrumb` returns the component itself.
- **Props.** `Host` spreads the original `props` object onto the
  component, so reactive props (and snippets, and event callbacks, which are
  props in Svelte 5) flow through unchanged. Two-way `bind:` on a crumbed
  component and `bind:this` to its exports do not pass through the wrapper —
  bind on the inner component's state instead, or leave that component
  uncrumbed.
- **Finding the root element.** Svelte doesn't expose a component's root node,
  so `Host` renders it inside a `<span class="crumb-target">` with
  `display: contents` (no box) and takes the span's `firstElementChild` as the
  target, re-reading it via a `MutationObserver` if the component swaps its root.
  The span is a real element in development, so a parent's `>` child selectors
  see it; it doesn't exist in production.
- **No remount when the overlay loads.** The overlay chunk loads asynchronously
  in development. `Host` renders the component first and mounts the overlay
  *beside* it when the chunk arrives, so the component is never torn down and
  its state survives.
- **Production.** `withCrumb` returns the component unchanged; `Host` and the
  overlay chunk are dropped from the bundle.
- **Script-less components.** `svelte-check` types a `.svelte` file with no
  `<script lang="ts">` as JavaScript, so importing it into a strict TypeScript
  barrel needs `"allowJs": true` (and `"checkJs": true`) in `tsconfig.json`.
- **Placement, portal, hover.** As in the other ports: the popover opens `POPOVER_GAP`
  (12px) from the click point and stays 8px inside the viewport, flipping and
  clamping as needed; pencil and popover are moved to `<body>` with `use:portalToBody`;
  leaving the target into the pencil (or back) never schedules a hide, and any
  other leave hides after 150ms.

- **Host styles (`crumb.css`).** The overlay lives inside someone else's app,
  whose global `button` and `input` rules (a `min-height`, a font, a
  `:hover:not(:disabled)` background) would otherwise reach the pencil and the
  popover: a `min-height: 36px` turns the 22px round pencil into an oval. So
  the overlay's controls open with a `:root :is(…)` reset of the box and text
  properties a host commonly sets (`min-width`, `min-height`, `margin`, font,
  `line-height`, `opacity`, `filter`, `transform`), and every overlay rule
  carries `:root`. At (0,2,0) a base rule outranks a host's `input[type="text"]`
  or `button:not(:disabled)` at (0,1,1), and at (0,3,0) a `:hover` rule outranks
  `button:hover:not(:disabled)` at (0,2,1), whichever stylesheet loads last. The
  hover mark on the target is only an `outline`, which takes no space and leaves
  the host element's own `border-radius` alone.

- **Theme (`crumb.css`).** Every colour is a `--crumb-*` token on `:root`,
  light by default. Dark applies when `<html>` has `data-theme="dark"` or the
  `.dark` class, or when the OS prefers dark and `<html>` has neither
  `data-theme="light"` nor `.light`. That is the convention most apps already
  use (`data-theme`, Tailwind/shadcn `.dark`), so the overlay follows the host's
  own theme switch without wiring. A dark-only app with no switch pins
  `<html data-theme="dark">`, as the templates do. The tokens
  are prefixed, so they can't collide with the host's.
- **One popover at a time (`claimPopover` in `util.ts`).** Opening a crumb's popover closes
  whichever one was open, so two half-written notes can't stack up. `util.ts`
  holds the open popover's close function; each overlay claims it in an effect
  that runs while its popover is open (`claimPopover(closePopover)`) and releases it
  in that effect's cleanup. Claiming calls the previous holder's `closePopover`, the
  same reset Escape does, so its draft is dropped.
- **Helpers in one file (`util.ts`).** Functions that aren't components live
  together in `util.ts`, not one file per function. It has no framework code
  and is byte-identical across the three ports, so it carries `portalToBody`, which
  only the Svelte overlay uses (the other ports use their framework's portal;
  their builds drop it). If it grows too large, split it by the component
  that uses each group of helpers, keeping every file framework-free and
  shared.
