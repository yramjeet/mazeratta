# crumbs (React) — how the agent should use this

Rules for an agent adding crumbs to a React project, so every annotation
reaches the receiving agent with enough context to act on it. Crumbs are declared
in a components barrel with `withCrumb`, never inside the component. (See
`README.md` for the behaviour and API.)

## What is a group (when it gets a crumb)

A **group** is one of:

1. **A component with its own defined functionality** — e.g. a date picker, an
   upload widget. It owns its crumb; each rendered instance shows one.
2. **A non-repeating logical region of the page** — e.g. a top bar, sidebar, or
   footer. One crumb covers the whole region.

Each group gets **exactly one** crumb entry, and **each group lives in its own
single file** for better management.

- ✅ a `Toolbar` component, the **sidebar**, a **filter panel** — one crumb each.
- ✅ a bit *inside* a region — a single button, a pill — **once you extract it to
  its own component and file** and give it a barrel entry. Wanting to annotate
  something finely is a reason to extract it, not a reason to add a second crumb.
- ❌ never two crumb entries for one file. If a file has grown a second thing
  worth annotating, that thing wants its own file.
- ❌ not a bare container that merely lists repeated items — wrap the repeated
  item *component*, not the list wrapper; never wrap each row of pure data.

Rule of thumb: if it's a component with behaviour, or a region you'd name ("the
sidebar", "the toolbar"), it's a group — give it its own file and one entry.

## Granularity — a request, not a setting

Granularity is **how much of the UI has crumbs on it**, and it is changed by
editing the source, not at runtime. Crumbs exist because an agent declared them
in a barrel; asking for finer granularity is asking it to declare more.

The pencil's popover carries two options: the note input, and a **Granularity**
row with exactly two buttons. Each forwards one fixed instruction down the same
`POST /api/note` path a typed note takes:

```
crumb @ src/components/Sidebar.tsx (Sidebar): Increase crumb granularity — run
`mazeratta crumbs more` on this file; if it says there is nothing to crumb yet,
extract this component's regions into their own components, then run it again

crumb @ src/components/Sidebar.tsx (Sidebar): Decrease crumb granularity — run
`mazeratta crumbs fewer` on this file
```

(One line each on the wire; wrapped here to read.) The wording is fixed in
`util.ts` so "increase" and "decrease" arrive as explicit words, never as
a number to interpret.

- **There are only two directions.** No level, no depth number, no scale. `+`
  means one step finer at this component, `−` one step coarser.
- **Nothing changes in the running UI when you click.** The request goes to the
  agent; the UI changes when the agent edits the code and the dev server
  reloads. Don't add optimistic local state to fake it.
- **Every crumb stays annotatable.** There is no gating, no budget, no reveal —
  hover any crumb and its pencil appears, always.
- **The anchor is the component you clicked**, exactly as for a typed note, so
  the agent knows whose children to crumb.

### Carrying out a granularity request

Run the command the note names, with the note's `<file>`. It does the same
thing every time, and changes barrels only:

- **`mazeratta crumbs more <file>`** finds the components `<file>` imports from
  a barrel (its children) and turns each plain re-export
  (`export { default as X } from "./X"`) into a `withCrumb` entry, whose
  `src` is the child's file. Children that are crumbed already are left as they are: one level per request.
- **`mazeratta crumbs fewer <file>`** turns those entries back into plain
  re-exports. The clicked component keeps its own entry; component files are
  never touched.
- **Extraction, only when `more` asks for it.** If `<file>` renders no child
  components, `more` changes nothing, says so and exits 3. Then split what it
  renders into groups (see *What is a group* above), move each into its own file
  beside the barrel, re-export it there plainly, import it from the barrel in
  `<file>`, and run `more` again: it crumbs them.
- Either way, keep the invariant: **one entry per component.** `fewer` then
  `more` gives back the same line, because an entry holds nothing but `src`.

### "Granularity" here means *crumb* granularity — nothing else

The word is common in app domains: data granularity, time granularity,
permission granularity, aggregation granularity. **This one is unrelated to any
of them.** Crumb granularity is how much of the UI carries the dev-only
annotation overlay. Acting on it means adding or removing barrel entries — never
touching what the app computes or displays.

So, explicitly:

- **A project may have its own `granularity` feature.** That is a different
  thing. Do not rename it, do not wire it to this one, and do not assume one
  refers to the other because the word matches.
- **Location decides, not the word.** If the note's path is inside
  `src/crumbs/`, it's about this control. If it points at app code, it's about
  the app's own feature — even when the note says "granularity".
- **If the note is ambiguous, ask.** Don't guess between "change the crumb
  overlay" and "change the product's granularity logic" — the two edits are
  unrelated and one of them is wrong.
- **Never satisfy an app-domain granularity request by editing this folder**, and
  never satisfy a crumb-overlay request by editing app code.

When writing about this control, say "crumb granularity" on first mention in any
new prose. The popover label stays the short "Granularity" — it sits inside a
crumb's own popover, so the context is already unambiguous there.

## Declaring a crumb

Crumbs are declared in a barrel, never in the component:

```ts
export const Toolbar = withCrumb(ToolbarBase, { src: "src/components/Toolbar.tsx" });
```

- **`src`** — the component's module path. This is what lets the agent edit the
  right place, so keep it accurate when a file moves. It is a file, never a
  `file:line`: the barrel entry sits beside the import, and the note names the file.
- **The name** shown in the popover and sent as `<functionality>` comes from
  the file: `SignInForm.tsx` is "Sign in form", `top-bar/index.tsx` is "Top bar",
  acronyms kept ("HTML editor"). There is no label to write: to change the
  name, name the file for what it is.
- **`withCrumb`** is imported by the barrel from the crumbs folder, never by a
  component file.

`withCrumb` adds **no layout box**: it wraps the component in a
`display: contents` span and attaches to the component's real root element,
portaling the pencil and popover to `<body>`. So there is no layout to break. The span is still in the DOM, so
don't write CSS like `.list > .item` that assumes the component's root is a
direct child of its parent; in production the span doesn't exist.

## Placement

The popover opens **at the point you clicked** — not at the component's edge —
so it lands next to the pointer however tall the wrapped component is. It is
portaled to `<body>` and positioned against the viewport, then flipped to the
other side of the cursor and clamped if it would overflow.

`placement` is therefore only a *preference* for which side is tried first
(`"bottom"` default, `"top"` to prefer opening upward); clipping is handled
automatically, so you rarely need to pass it. Don't reintroduce
component-relative offsets: any ancestor with `transform`, `filter` or
`backdrop-filter` becomes the containing block for a fixed child — sticky
headers and modal overlays commonly have one — and the portal is what sidesteps
that.

## It is a NOTE, not a live edit

A crumb forwards a note to the agent; it never mutates the UI itself. Phrase the
popover as "add a note", and keep submission to **Enter** (Esc cancels). Do not
add inline content-editing here.

The popover holds exactly two options — the note and the granularity row. The
note input keeps focus on open, so `pencil → type → Enter` stays the primary
path and the granularity row never gets in its way. Don't put the granularity
control behind a mode switch, and don't add a third option without a strong
reason.

## Dev-only — keep it that way

`withCrumb` is the identity function in production, via `import.meta.env.DEV`. Don't add imports or side
effects that must run in prod, and don't rely on a crumb being present at runtime
in a production build.

Anything you add to this folder is dev tooling, not app UI, and **owns no crumb
of its own** — don't annotate the annotation layer.

Verify after touching this folder: build production and confirm nothing leaks.

```bash
<your prod build> && grep -c "crumb-pencil\|crumb-gran\|crumb-popover" <bundle>
```

Expect `0`. Grep for the class names rather than the word "crumbs", which may
legitimately appear in your app's own copy.

## The forwarded message

The backend composes a single line for the receiving agent of the form:

```
crumb @ <file> (<functionality>): <instruction>
```

- `<file>` — where to look: the component's file, the crumb's `src`.
- `<functionality>` — the component's name, from its file name (`SignInForm` → "Sign in form").
- `<instruction>` — the user's note (everything after the colon).

### Interpreting a crumb note you receive

If you (the agent) are handed a prompt in this exact shape, read it as a **user
annotation pointing at code**, not as text to insert literally:

1. **Open `<file>`** — that's where the annotated thing lives.
2. **`<functionality>`** names *what* the note is about; use it to confirm the
   target component.
3. **Everything after the first `: ` is the instruction, verbatim.** Carry it out
   at that location. It is a request to change/answer about the *thing named*,
   not about the markup itself.
4. **Read tooling words against the location, not the vocabulary.** If the
   instruction says "granularity" (or "crumb", or "note"), decide from `<file>`
   whether it means this dev overlay or something the project itself calls by
   that name — see the granularity section above. A note anchored in app code
   asking for finer "granularity" is almost certainly about the app's data, not
   about crumb coverage.

If a message doesn't match this shape, treat it as an ordinary prompt.

### Reading only what you need

Don't open the repository to answer a note. If the host app documents its files
(per-file notes, or a section per file in an LLD), read the doc for `<file>`,
read `<file>`, then stop. Say what's missing rather than widening the search.
The host app's own `CLAUDE.md` defines the order; this folder only guarantees the
note's anchor is accurate.

### How the fields are filled

For a UI component crumb, the path comes from the `src` in its barrel entry and
points at the component; the instruction is about that component. Location and
instruction are about the same thing. Keep `src` accurate so the note lands on
the right code.

## Delivery

By default a note posts to `POST /api/note` (`postCrumbNote` in `util.ts`), which the host backend
forwards to a coding agent. Only pass `onSubmit` to override delivery (e.g. tests
or a different endpoint). Keep the payload shape `{ file, functionality, text }`.
