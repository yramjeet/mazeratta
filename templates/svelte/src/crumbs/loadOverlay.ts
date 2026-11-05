import type { Component } from "svelte";
import type { CrumbMeta } from "./types";

export type OverlayComponent = Component<{ meta: CrumbMeta; target: Element | null }>;

let loadedComponent: OverlayComponent | null = null;

export const overlayLoad: Promise<OverlayComponent> | null = import.meta.env.DEV
  ? import("./Overlay.svelte").then((m) => (loadedComponent = m.default))
  : null;

export const loadedOverlay = () => loadedComponent;
