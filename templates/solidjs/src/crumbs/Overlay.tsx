import { createSignal, createEffect, onCleanup, Show, For, type Component } from "solid-js";
import { Portal } from "solid-js/web";
import {
  postCrumbNote,
  placePopover,
  POPOVER_GAP,
  claimPopover,
  crumbNameFromSrc,
  GRANULARITY_INSTRUCTION,
  GRANULARITY_UI,
  GRANULARITY_CHANGES,
  type CrumbNote,
  type GranularityChange,
} from "./util";

export interface CrumbMeta {
  src: string;
  placement?: "top" | "bottom";
  onSubmit?: (note: CrumbNote) => Promise<void>;
}

type Status = "idle" | "sending" | "sent" | "error";

const PENCIL_HIDE_DELAY_MS = 150;

const Overlay: Component<{ meta: CrumbMeta; target: () => Element | null }> = (props) => {
  const [hovered, setHovered] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [targetRect, setTargetRect] = createSignal<DOMRect | null>(null);
  const [note, setNote] = createSignal("");
  const [noteStatus, setNoteStatus] = createSignal<Status>("idle");
  const [granularityStatus, setGranularityStatus] = createSignal<Status>("idle");
  const [granularitySent, setGranularitySent] = createSignal<GranularityChange | null>(null);
  const [clickPoint, setClickPoint] = createSignal<{ x: number; y: number } | null>(null);
  const [popoverPosition, setPopoverPosition] = createSignal({ x: 0, y: 0 });

  const meta = () => props.meta;
  const crumbName = () => crumbNameFromSrc(meta().src);
  const pencilShown = () => hovered() || editing();

  let inputRef: HTMLInputElement | undefined;
  let popoverRef: HTMLDivElement | undefined;

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const keepPencil = () => {
    clearTimeout(hideTimer);
    setHovered(true);
  };
  const hidePencilLater = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => setHovered(false), PENCIL_HIDE_DELAY_MS);
  };
  onCleanup(() => clearTimeout(hideTimer));

  const closePopover = () => {
    setEditing(false);
    setNote("");
    setNoteStatus("idle");
    setGranularityStatus("idle");
    setGranularitySent(null);
  };

  createEffect(() => {
    const targetEl = props.target();
    if (!targetEl) return;
    const measureTarget = () => setTargetRect(targetEl.getBoundingClientRect());
    measureTarget();

    targetEl.addEventListener("mouseenter", keepPencil);
    targetEl.addEventListener("mouseleave", hidePencilLater);
    window.addEventListener("scroll", measureTarget, true);
    window.addEventListener("resize", measureTarget);
    onCleanup(() => {
      targetEl.removeEventListener("mouseenter", keepPencil);
      targetEl.removeEventListener("mouseleave", hidePencilLater);
      window.removeEventListener("scroll", measureTarget, true);
      window.removeEventListener("resize", measureTarget);
    });
  });

  createEffect(() => {
    const targetEl = props.target();
    if (!targetEl) return;
    targetEl.classList.toggle("crumb-active", pencilShown());
    onCleanup(() => targetEl.classList.remove("crumb-active"));
  });

  createEffect(() => {
    const point = clickPoint();
    if (!editing() || !point || !popoverRef) return;
    const { width, height } = popoverRef.getBoundingClientRect();
    setPopoverPosition(placePopover(point, { width, height }, meta().placement));
  });

  createEffect(() => {
    if (!editing()) return;
    onCleanup(claimPopover(closePopover));
  });

  createEffect(() => {
    if (!editing()) return;
    inputRef?.focus();
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    onCleanup(() => window.removeEventListener("keydown", closeOnEscape));
  });

  const deliverNote = async (text: string) => {
    const payload: CrumbNote = { file: meta().src, functionality: crumbName(), text };
    await (meta().onSubmit ?? postCrumbNote)(payload);
  };

  const submitNote = async () => {
    const text = note().trim();
    if (!text || noteStatus() === "sending") return;
    setNoteStatus("sending");
    try {
      await deliverNote(text);
      setNoteStatus("sent");
      setNote("");
      setTimeout(closePopover, 800);
    } catch {
      setNoteStatus("error");
    }
  };

  const sendGranularity = async (change: GranularityChange) => {
    if (granularityStatus() === "sending") return;
    setGranularityStatus("sending");
    setGranularitySent(change);
    try {
      await deliverNote(GRANULARITY_INSTRUCTION[change]);
      setGranularityStatus("sent");
    } catch {
      setGranularityStatus("error");
    }
  };

  const granularityFooter = () => {
    if (granularityStatus() === "sending") return "Asking…";
    if (granularityStatus() === "error") return "Failed — retry";
    if (granularityStatus() === "sent") {
      return granularitySent() === "increase" ? "Asked for more crumbs ✓" : "Asked for fewer crumbs ✓";
    }
    return "− Fewer · + more crumbs here";
  };

  return (
    <Portal>
      <Show when={pencilShown() && targetRect()}>
        <button
          class="crumb-pencil"
          style={{ left: `${targetRect()!.right - 11}px`, top: `${targetRect()!.top - 11}px` }}
          title={`${crumbName()}${meta().src ? ` · ${meta().src}` : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (editing()) {
              closePopover();
              return;
            }
            setClickPoint({ x: e.clientX, y: e.clientY });
            setPopoverPosition({ x: e.clientX + POPOVER_GAP, y: e.clientY + POPOVER_GAP });
            setEditing(true);
          }}
          onMouseEnter={keepPencil}
          onMouseLeave={hidePencilLater}
        >
          ✎
        </button>
      </Show>

      <Show when={editing()}>
        <div
          ref={popoverRef}
          class="crumb-popover"
          style={{ left: `${popoverPosition().x}px`, top: `${popoverPosition().y}px` }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div class="crumb-pop-head">
            <span class="crumb-pop-label">{crumbName()}</span>
            <span class="crumb-pop-meta">
              <span class="crumb-pop-src">{meta().src || "unknown source"}</span>
              <button
                class="crumb-pop-close"
                title="Close (Esc)"
                onClick={(e) => {
                  e.stopPropagation();
                  closePopover();
                }}
              >
                ×
              </button>
            </span>
          </div>
          <input
            ref={inputRef}
            class="crumb-pop-input"
            classList={{ "crumb-pop-err": noteStatus() === "error" }}
            type="text"
            placeholder="Add a note, Enter to send…"
            value={note()}
            disabled={noteStatus() === "sending"}
            onInput={(e) => setNote(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitNote();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closePopover();
              }
            }}
          />
          <div class="crumb-pop-foot">
            {noteStatus() === "sending"
              ? "Sending…"
              : noteStatus() === "sent"
                ? "Sent ✓"
                : noteStatus() === "error"
                  ? "Failed — retry"
                  : "Enter to send · Esc to cancel"}
          </div>

          <div class="crumb-pop-gran">
            <span class="crumb-pop-gran-label">Granularity</span>
            <span class="crumb-gran">
              <For each={GRANULARITY_CHANGES}>
                {(change) => (
                  <button
                    class="crumb-gran-btn"
                    disabled={granularityStatus() === "sending"}
                    title={GRANULARITY_UI[change].title}
                    onClick={(e) => {
                      e.stopPropagation();
                      sendGranularity(change);
                    }}
                  >
                    {GRANULARITY_UI[change].glyph}
                  </button>
                )}
              </For>
            </span>
            <span
              class="crumb-pop-gran-hint"
              classList={{ "crumb-gran-err": granularityStatus() === "error" }}
            >
              {granularityFooter()}
            </span>
          </div>
        </div>
      </Show>
    </Portal>
  );
};

export default Overlay;
