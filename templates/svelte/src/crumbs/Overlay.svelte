<script lang="ts">
  import {
    postCrumbNote,
    placePopover,
    POPOVER_GAP,
    claimPopover,
    crumbNameFromSrc,
    portalToBody,
    GRANULARITY_INSTRUCTION,
    GRANULARITY_UI,
    GRANULARITY_CHANGES,
    type CrumbNote,
    type GranularityChange,
  } from "./util";
  import type { CrumbMeta } from "./types";
  import "./crumb.css";

  let { meta, target }: { meta: CrumbMeta; target: Element | null } = $props();

  const PENCIL_HIDE_DELAY_MS = 150;

  type Status = "idle" | "sending" | "sent" | "error";

  let hovered = $state(false);
  let editing = $state(false);
  let targetRect = $state<DOMRect | null>(null);
  let note = $state("");
  let noteStatus = $state<Status>("idle");
  let granularityStatus = $state<Status>("idle");
  let granularitySent = $state<GranularityChange | null>(null);
  let clickPoint = $state<{ x: number; y: number } | null>(null);
  let popoverPosition = $state({ x: 0, y: 0 });
  let inputEl = $state<HTMLInputElement>();
  let popoverEl = $state<HTMLDivElement>();
  let pencilEl = $state<HTMLButtonElement>();

  const crumbName = $derived(crumbNameFromSrc(meta.src));
  const pencilShown = $derived(hovered || editing);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function keepPencil() {
    clearTimeout(hideTimer);
    hovered = true;
  }

  function hidePencilLater(into: EventTarget | null) {
    if (into instanceof Node && (pencilEl?.contains(into) || target?.contains(into))) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (hovered = false), PENCIL_HIDE_DELAY_MS);
  }

  function closePopover() {
    editing = false;
    note = "";
    noteStatus = "idle";
    granularityStatus = "idle";
    granularitySent = null;
  }

  $effect(() => () => clearTimeout(hideTimer));

  $effect(() => {
    const targetEl = target;
    if (!targetEl) return;
    const measureTarget = () => (targetRect = targetEl.getBoundingClientRect());
    measureTarget();
    const onTargetLeave = (e: Event) => hidePencilLater((e as MouseEvent).relatedTarget);
    targetEl.addEventListener("mouseenter", keepPencil);
    targetEl.addEventListener("mouseleave", onTargetLeave);
    window.addEventListener("scroll", measureTarget, true);
    window.addEventListener("resize", measureTarget);
    return () => {
      targetEl.removeEventListener("mouseenter", keepPencil);
      targetEl.removeEventListener("mouseleave", onTargetLeave);
      window.removeEventListener("scroll", measureTarget, true);
      window.removeEventListener("resize", measureTarget);
    };
  });

  $effect(() => {
    const targetEl = target;
    if (!targetEl) return;
    targetEl.classList.toggle("crumb-active", pencilShown);
    return () => targetEl.classList.remove("crumb-active");
  });

  $effect(() => {
    const point = clickPoint;
    if (!editing || !point || !popoverEl) return;
    const { width, height } = popoverEl.getBoundingClientRect();
    popoverPosition = placePopover(point, { width, height }, meta.placement);
  });

  $effect(() => {
    if (!editing) return;
    return claimPopover(closePopover);
  });

  $effect(() => {
    if (!editing) return;
    inputEl?.focus();
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  async function deliverNote(text: string) {
    const payload: CrumbNote = { file: meta.src, functionality: crumbName, text };
    await (meta.onSubmit ?? postCrumbNote)(payload);
  }

  async function submitNote() {
    const text = note.trim();
    if (!text || noteStatus === "sending") return;
    noteStatus = "sending";
    try {
      await deliverNote(text);
      noteStatus = "sent";
      note = "";
      setTimeout(closePopover, 800);
    } catch {
      noteStatus = "error";
    }
  }

  async function sendGranularity(change: GranularityChange) {
    if (granularityStatus === "sending") return;
    granularityStatus = "sending";
    granularitySent = change;
    try {
      await deliverNote(GRANULARITY_INSTRUCTION[change]);
      granularityStatus = "sent";
    } catch {
      granularityStatus = "error";
    }
  }

  function togglePopover(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (editing) {
      closePopover();
      return;
    }
    clickPoint = { x: e.clientX, y: e.clientY };
    popoverPosition = { x: e.clientX + POPOVER_GAP, y: e.clientY + POPOVER_GAP };
    editing = true;
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitNote();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePopover();
    }
  }

  const noteFooter = $derived(
    noteStatus === "sending"
      ? "Sending…"
      : noteStatus === "sent"
        ? "Sent ✓"
        : noteStatus === "error"
          ? "Failed — retry"
          : "Enter to send · Esc to cancel",
  );

  const granularityFooter = $derived(
    granularityStatus === "sending"
      ? "Asking…"
      : granularityStatus === "error"
        ? "Failed — retry"
        : granularityStatus === "sent"
          ? granularitySent === "increase"
            ? "Asked for more crumbs ✓"
            : "Asked for fewer crumbs ✓"
          : "− Fewer · + more crumbs here",
  );
</script>

{#if pencilShown && targetRect}
  <button
    use:portalToBody
    bind:this={pencilEl}
    class="crumb-pencil"
    style:left="{targetRect.right - 11}px"
    style:top="{targetRect.top - 11}px"
    title="{crumbName}{meta.src ? ` · ${meta.src}` : ''}"
    onclick={togglePopover}
    onmouseenter={keepPencil}
    onmouseleave={(e) => hidePencilLater(e.relatedTarget)}>✎</button
  >
{/if}

{#if editing}
  <div
    use:portalToBody
    bind:this={popoverEl}
    class="crumb-popover"
    role="dialog"
    tabindex="-1"
    style:left="{popoverPosition.x}px"
    style:top="{popoverPosition.y}px"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    <div class="crumb-pop-head">
      <span class="crumb-pop-label">{crumbName}</span>
      <span class="crumb-pop-meta">
        <span class="crumb-pop-src">{meta.src || "unknown source"}</span>
        <button
          class="crumb-pop-close"
          title="Close (Esc)"
          onclick={(e) => {
            e.stopPropagation();
            closePopover();
          }}>×</button
        >
      </span>
    </div>
    <input
      bind:this={inputEl}
      bind:value={note}
      class="crumb-pop-input"
      class:crumb-pop-err={noteStatus === "error"}
      type="text"
      placeholder="Add a note, Enter to send…"
      disabled={noteStatus === "sending"}
      onkeydown={onInputKey}
    />
    <div class="crumb-pop-foot">{noteFooter}</div>

    <div class="crumb-pop-gran">
      <span class="crumb-pop-gran-label">Granularity</span>
      <span class="crumb-gran">
        {#each GRANULARITY_CHANGES as change (change)}
          <button
            class="crumb-gran-btn"
            disabled={granularityStatus === "sending"}
            title={GRANULARITY_UI[change].title}
            onclick={(e) => {
              e.stopPropagation();
              sendGranularity(change);
            }}>{GRANULARITY_UI[change].glyph}</button
          >
        {/each}
      </span>
      <span class="crumb-pop-gran-hint" class:crumb-gran-err={granularityStatus === "error"}>{granularityFooter}</span>
    </div>
  </div>
{/if}
