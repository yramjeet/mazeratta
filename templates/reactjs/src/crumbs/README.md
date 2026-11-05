# crumbs (React)

> **Status: beta.** Under test and not yet approved; behaviour and API may still change.

A **dev-only** React overlay that lets you leave a note on any UI component and
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
crumb @ src/components/Toolbar.tsx (Toolbar): make Save the primary action
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
required.

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
import ToolbarBase from "./Toolbar";

export const Toolbar = withCrumb(ToolbarBase, { src: "src/components/Toolbar.tsx" });
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

- `Crumb.tsx` — `withCrumb`, the HOC: attaches a crumb to a component, adding no layout box
- `Overlay.tsx` — the pencil, the popover, and both ways a crumb talks to the agent
- `util.ts` — the overlay's helpers, no framework code and identical in every port: the backend call (`postCrumbNote`), the granularity wording, popover placement (`placePopover`), one popover at a time (`claimPopover`) and the `portalToBody` action Svelte moves the pencil and popover to `<body>` with
- `crumb.css` — its styles
- `index.ts` — the public API: `withCrumb`. The types and helpers stay internal; a custom `onSubmit` imports `CrumbNote` from `util.ts`
- the barrel rule to copy into your components directory lives beside this
  folder in the template, as `src/components/CLAUDE.md`

See `CLAUDE.md` for the conventions an agent follows when adding crumbs.

## Implementation notes

- **Finding the root element.** React has no way to ask a component for its
  root DOM node (`findDOMNode` is gone in React 19, and forwarding refs would
  mean editing every component). So `withCrumb` renders the component inside a
  `<span class="crumb-target">` with `display: contents`, which produces no
  box, and takes the span's `firstElementChild` as the target. A
  `MutationObserver` on the span's children keeps it current, because a
  component that swaps its root (a spinner, then the content) re-renders only
  itself, not `Crumbed`; the Svelte port does the same. Component files stay pure (no crumb import, no props, no wrapper);
  crumbs are declared once in a components barrel. The span is a real element,
  so a parent's `>` child selectors see it in development; it doesn't exist in
  production.
- **React tree propagation.** Events inside a portal still bubble through the
  *React* tree to the crumb's ancestors. The popover stops `click` and `keydown`
  at its root, so typing or clicking in it never triggers the wrapped
  component's own handlers.
- **Hover grace.** The pencil is portaled to `<body>` and overlaps the target's
  corner, so moving onto it fires `mouseleave` on the target. A leave whose
  `relatedTarget` is the pencil (or, leaving the pencil, the target) never
  schedules a hide; any other leave hides after 150ms unless an enter cancels
  it. The `relatedTarget` check is needed in React specifically: React derives
  the pencil's `onMouseEnter` from the target's `mouseout`, which arrives
  *before* the target's native `mouseleave`, so a timer alone would be
  rescheduled after the enter had already cancelled it.
- **Production.** `withCrumb` returns the component itself when
  `import.meta.env.DEV` is false, and the CSS is
  imported only under `DEV`, so a prod build carries components exactly as
  written.
- **Tracking the target (`Overlay.tsx`).** The pencil is positioned against the
  viewport, so the overlay re-measures the target's rect on `resize` and on
  `scroll` (capture phase, to catch nested scrollers), and tracks hover with
  `mouseenter`/`mouseleave` on the target. The hover outline is the
  `crumb-active` class on the target itself, removed on cleanup so no mark is
  left on someone else's element.
- **`src`** is the component's module path and goes into the note as `file`, as
  is.
- **Placement (`placePopover` in `util.ts`).** Opens `POPOVER_GAP` (12px) from the click point and stays
  `VIEWPORT_MARGIN` (8px) inside the viewport. Right of the cursor, flipped left on
  overflow; the `placement` side first vertically (default below), the other
  side if that fits, clamped as a last resort. The popover is measured after it
  renders (its height depends on content), using separate `clickPoint` and `popoverPosition`
  signals so the measuring effect can't trigger itself.
- **Portal.** Fixed positioning inside an ancestor with `transform`, `filter` or
  `backdrop-filter` would be relative to that ancestor; portaling to `<body>`
  avoids it and lifts the popover above app stacking (`z-index: 200`).
- **Payload.** Note and granularity requests share one `deliverNote`: the anchor is
  the component, `functionality` its name from `src`. Their status signals are separate.
  Escape closes the popover via a `window` listener.
- **Granularity wording** is fixed in `util.ts`, two directions only;
  keep it in step with the components rule (`src/components/CLAUDE.md`). `GRANULARITY_CHANGES` is
  coarse → fine, the button order.

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
