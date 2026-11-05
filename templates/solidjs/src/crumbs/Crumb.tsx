import { children, createMemo, type Component } from "solid-js";
import Overlay, { type CrumbMeta } from "./Overlay";

if (import.meta.env.DEV) {
  import("./crumb.css");
}

export function withCrumb<P extends object>(Comp: Component<P>, meta: CrumbMeta): Component<P> {
  if (!import.meta.env.DEV) {
    return Comp;
  }

  return (props: P) => {
    const resolved = children(() => <Comp {...props} />);

    const target = createMemo<Element | null>(() => {
      const rendered = resolved.toArray();
      return (rendered.find((n) => n instanceof Element) as Element | undefined) ?? null;
    });

    return (
      <>
        {resolved()}
        <Overlay meta={meta} target={target} />
      </>
    );
  };
}
