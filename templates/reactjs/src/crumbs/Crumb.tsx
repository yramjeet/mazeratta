import { useLayoutEffect, useRef, useState, type ComponentType } from "react";
import Overlay, { type CrumbMeta } from "./Overlay";

if (import.meta.env.DEV) {
  import("./crumb.css");
}

export function withCrumb<P extends object>(Comp: ComponentType<P>, meta: CrumbMeta): ComponentType<P> {
  if (!import.meta.env.DEV) {
    return Comp;
  }

  function Crumbed(props: P) {
    const hostRef = useRef<HTMLSpanElement>(null);
    const [target, setTarget] = useState<Element | null>(null);

    useLayoutEffect(() => {
      const el = hostRef.current;
      if (!el) return;
      const readTarget = () => setTarget(el.firstElementChild);
      readTarget();
      const observer = new MutationObserver(readTarget);
      observer.observe(el, { childList: true });
      return () => observer.disconnect();
    }, []);

    return (
      <>
        <span ref={hostRef} className="crumb-target">
          <Comp {...props} />
        </span>
        <Overlay meta={meta} target={target} />
      </>
    );
  }
  Crumbed.displayName = `withCrumb(${Comp.displayName ?? Comp.name ?? "Component"})`;
  return Crumbed;
}
