# components — pure components, crumbs in the barrel

> Adopting crumbs? Copy this file into your UI components directory as
> `CLAUDE.md`, so the rule is in context whenever a component is created there.
> (Adjust the example ids/paths to your project.)

Hard rule for this directory: **component files contain no crumb code.** No
crumb import, no crumb props, no wrapper in the JSX. Every crumb is declared in
`index.ts`, one entry per component.

That is what lets crumbs be added, moved or removed without
touching a single component — and it keeps the components themselves plain
SolidJS.

## Layout — group by feature, share in `common/`

Start flat. As the app grows, organise by **feature**, not by kind:

```
src/components/
  index.ts           this directory's crumbs + re-exports of each subdirectory
  common/
    index.ts  Button.tsx  Field.tsx        used by two or more features
  auth/
    index.ts  SignInForm.tsx  SignUpForm.tsx
  billing/
    index.ts  PlanCard.tsx
```

- **A feature gets a subdirectory once it owns two or more components.** One
  component stays flat; don't create a directory in anticipation.
- **`common/` is for genuine reuse — used by two or more features.** Used once,
  it belongs to that feature. Resist parking things there "for later"; a
  `common/` that collects everything is the same as no organisation.
- **Promote when the second user appears.** When a second feature needs a
  component, move it to `common/` in that change, and update its barrel entry.
- **Never group by kind** (`forms/`, `buttons/`, `modals/`). Features change
  together; kinds don't.

### Each directory owns its crumbs

Every directory holding components has its own `index.ts` declaring their
crumbs, and the root barrel re-exports it:

```ts
// src/components/auth/index.ts
import { withCrumb } from "../../crumbs";
import SignInFormBase from "./SignInForm";

export const SignInForm = withCrumb(SignInFormBase, { src: "src/components/auth/SignInForm.tsx" });
```

```ts
// src/components/index.ts
export * from "./common";
export * from "./auth";
```

- **`src` is the module path** — no line number, and the only field. It changes
  when a component moves between directories, which is exactly when it's easy to
  forget; the check below catches it. The name the user and agent see comes from
  the file name (`SignInForm` → "Sign in form"), so name files for what they are.
- **Only barrels import `withCrumb`.** A component file that imports the crumbs
  folder has crumb code in it; the check below fails it.

### Moving a component

Moving between directories touches three things, all in the same change:

1. the file itself,
2. its entry in the old barrel — deleted — and a new entry in the new one,
3. `src`.

Nothing in the component file changes, because it never mentioned crumbs.

## When you create a component here

1. Write the component. Plain — no crumbs.
2. Add one entry to its directory's `index.ts` (create the barrel, and re-export
   it from the root, if the directory is new).
   - `src` — the module path, without a line number. It is the entry's only field.
3. **One entry per component.** The component is the group; its repeated leaves
   are not. Never two crumbs for one file.
4. **A new logical region = a new file + a new barrel entry.** Don't inline a
   second region inside an existing component — that's how it ends up
   unannotatable.
5. **Import components from the barrel** (`from "./components"`), never from
   their files directly. A direct import gets the uncrumbed version.

## Granularity requests

A crumb's popover has a **Granularity** row with two buttons. They change nothing
at runtime — they forward one of two fixed instructions to you:

```
crumb @ <file> (<name>): Increase crumb granularity — run `mazeratta crumbs more` on
this file; if it says there is nothing to crumb yet, extract this component's regions
into their own components, then run it again

crumb @ <file> (<name>): Decrease crumb granularity — run `mazeratta crumbs fewer` on this file
```

In this directory, a crumb is **a barrel entry**, never code in the file:

- **increase** — run `mazeratta crumbs more <file>`. It crumbs the components
  `<file>` imports from a barrel by rewriting their plain re-exports as entries.
  If it says there is nothing to crumb yet (exit 3), extract what `<file>`
  renders into components, each its own file **in the same directory as its
  parent** (or a new feature subdirectory if that's what the split reveals),
  re-exported plainly from the barrel and imported from it in `<file>`; then run
  it again. One level per request.
- **decrease** — run `mazeratta crumbs fewer <file>`. It turns those entries back
  into plain re-exports. The component files stay exactly as they are; only their
  crumb declarations go.

**This is *crumb* granularity** — how much of the UI carries the dev overlay. If
your project also has a feature called granularity, the two are unrelated: a note
anchored at app code asking for finer granularity is about the app, not about
crumb coverage. See the crumbs rule (`CLAUDE.md` in the crumbs folder) for the full rule.

## Verify before finishing

```bash
bun <mazeratta>/scripts/verify-crumbs.ts .   # the integration brief prints the full path
```

It fails if:

- a subdirectory's barrel isn't re-exported from the root;
- a component imports the crumbs folder directly;
- a `src` points at a file that doesn't exist — the usual cause is a component
  that moved between directories.

Run it after adding or moving a component. It reads barrels as code, so a
commented-out entry does not count as one. A component with no entry isn't an
error here: coverage grows from `+` requests. (mazeratta's templates also pass
`--full-coverage`, which fails it.)
