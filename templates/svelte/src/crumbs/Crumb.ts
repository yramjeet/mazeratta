import type { Component } from "svelte";
import Host from "./Host.svelte";
import type { CrumbMeta } from "./types";

export function withCrumb<P extends Record<string, any>>(Comp: Component<P>, meta: CrumbMeta): Component<P> {
  if (!import.meta.env.DEV) {
    return Comp;
  }

  return ((internals, props) => Host(internals, { component: Comp, props, meta })) as Component<P>;
}
