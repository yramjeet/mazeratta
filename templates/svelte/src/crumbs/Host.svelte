<script lang="ts">
  import type { Component } from "svelte";
  import { loadedOverlay, overlayLoad } from "./loadOverlay";
  import type { CrumbMeta } from "./types";

  let {
    component: Comp,
    props,
    meta,
  }: { component: Component<any>; props: Record<string, any>; meta: CrumbMeta } = $props();

  let hostSpan = $state<HTMLSpanElement>();
  let target = $state<Element | null>(null);
  let Overlay = $state(loadedOverlay());
  if (!loadedOverlay() && overlayLoad) overlayLoad.then((c) => (Overlay = c));

  $effect(() => {
    const el = hostSpan;
    if (!el) return;
    const readTarget = () => (target = el.firstElementChild);
    readTarget();
    const observer = new MutationObserver(readTarget);
    observer.observe(el, { childList: true });
    return () => observer.disconnect();
  });
</script>

<span class="crumb-target" bind:this={hostSpan}><Comp {...props} /></span>
{#if Overlay}<Overlay {meta} {target} />{/if}
