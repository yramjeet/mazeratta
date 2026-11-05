const NOTE_SERVER_URL = import.meta.env.VITE_API ?? "http://localhost:8080";

export interface CrumbNote {
  file: string;
  functionality: string;
  text: string;
}

export async function postCrumbNote(note: CrumbNote): Promise<void> {
  const response = await fetch(`${NOTE_SERVER_URL}/api/note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note),
  });
  if (!response.ok) {
    throw new Error(`server returned ${response.status} ${response.statusText}`);
  }
}

const FILE_EXTENSION = /\.[^.]+$/;
const LOWER_THEN_UPPER = /([a-z0-9])([A-Z])/g;
const ACRONYM_THEN_WORD = /([A-Z])([A-Z][a-z])/g;
const WORD_SEPARATORS = /[-_]+/g;
const WHITESPACE = /\s+/;

export function crumbNameFromSrc(src: string) {
  const parts = src.split("/").filter(Boolean);
  let stem = (parts.pop() ?? "").replace(FILE_EXTENSION, "");
  if (stem === "index" && parts.length) stem = parts.pop()!;
  const words = stem
    .replace(LOWER_THEN_UPPER, "$1 $2")
    .replace(ACRONYM_THEN_WORD, "$1 $2")
    .replace(WORD_SEPARATORS, " ")
    .trim()
    .split(WHITESPACE)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() ? word : word.toLowerCase()));
  if (!words.length) return src;
  return [words[0][0].toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}

export type GranularityChange = "increase" | "decrease";

export const GRANULARITY_INSTRUCTION: Record<GranularityChange, string> = {
  increase:
    "Increase crumb granularity — run `mazeratta crumbs more` on this file; if it says there is " +
    "nothing to crumb yet, extract this component's regions into their own components, then run it again",
  decrease:
    "Decrease crumb granularity — run `mazeratta crumbs fewer` on this file",
};

export const GRANULARITY_UI: Record<GranularityChange, { glyph: string; title: string }> = {
  decrease: { glyph: "−", title: "Fewer crumbs — ask the agent to remove its children's crumbs" },
  increase: { glyph: "+", title: "More crumbs — ask the agent to crumb its children" },
};

export const GRANULARITY_CHANGES: GranularityChange[] = ["decrease", "increase"];

export const POPOVER_GAP = 12;
const VIEWPORT_MARGIN = 8;

export function placePopover(
  point: { x: number; y: number },
  popoverSize: { width: number; height: number },
  placement?: "top" | "bottom",
): { x: number; y: number } {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = point.x + POPOVER_GAP;
  if (x + popoverSize.width > viewportWidth - VIEWPORT_MARGIN) {
    x = point.x - POPOVER_GAP - popoverSize.width;
  }
  x = Math.max(VIEWPORT_MARGIN, Math.min(x, viewportWidth - VIEWPORT_MARGIN - popoverSize.width));

  const below = point.y + POPOVER_GAP;
  const above = point.y - POPOVER_GAP - popoverSize.height;
  const fitsViewport = (y: number) => y >= VIEWPORT_MARGIN && y + popoverSize.height <= viewportHeight - VIEWPORT_MARGIN;
  let y = placement === "top" ? above : below;
  if (!fitsViewport(y)) {
    const other = placement === "top" ? below : above;
    if (fitsViewport(other)) y = other;
  }
  y = Math.max(VIEWPORT_MARGIN, Math.min(y, viewportHeight - VIEWPORT_MARGIN - popoverSize.height));

  return { x, y };
}

let closeOpenPopover: (() => void) | null = null;

export function claimPopover(close: () => void): () => void {
  if (closeOpenPopover !== close) closeOpenPopover?.();
  closeOpenPopover = close;
  return () => {
    if (closeOpenPopover === close) closeOpenPopover = null;
  };
}

export function portalToBody(node: HTMLElement) {
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
