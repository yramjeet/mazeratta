import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

export default function Overlay({ meta, target }: { meta: CrumbMeta; target: Element | null }) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<Status>("idle");
  const [granularityStatus, setGranularityStatus] = useState<Status>("idle");
  const [granularitySent, setGranularitySent] = useState<GranularityChange | null>(null);
  const [clickPoint, setClickPoint] = useState<{ x: number; y: number } | null>(null);
  const [popoverPosition, setPopoverPosition] = useState({ x: 0, y: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pencilRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const crumbName = crumbNameFromSrc(meta.src);
  const pencilShown = hovered || editing;

  const keepPencil = useCallback(() => {
    clearTimeout(hideTimer.current);
    setHovered(true);
  }, []);
  const hidePencilLater = useCallback((into: EventTarget | null) => {
    if (into instanceof Node && (pencilRef.current?.contains(into) || target?.contains(into))) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHovered(false), PENCIL_HIDE_DELAY_MS);
  }, [target]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const closePopover = useCallback(() => {
    setEditing(false);
    setNote("");
    setNoteStatus("idle");
    setGranularityStatus("idle");
    setGranularitySent(null);
  }, []);

  useEffect(() => {
    if (!target) return;
    const measureTarget = () => setTargetRect(target.getBoundingClientRect());
    measureTarget();
    const onTargetLeave = (e: Event) => hidePencilLater((e as MouseEvent).relatedTarget);
    target.addEventListener("mouseenter", keepPencil);
    target.addEventListener("mouseleave", onTargetLeave);
    window.addEventListener("scroll", measureTarget, true);
    window.addEventListener("resize", measureTarget);
    return () => {
      target.removeEventListener("mouseenter", keepPencil);
      target.removeEventListener("mouseleave", onTargetLeave);
      window.removeEventListener("scroll", measureTarget, true);
      window.removeEventListener("resize", measureTarget);
    };
  }, [target, keepPencil, hidePencilLater]);

  useEffect(() => {
    if (!target) return;
    target.classList.toggle("crumb-active", pencilShown);
    return () => target.classList.remove("crumb-active");
  }, [target, pencilShown]);

  useLayoutEffect(() => {
    if (!editing || !clickPoint || !popoverRef.current) return;
    const { width, height } = popoverRef.current.getBoundingClientRect();
    setPopoverPosition(placePopover(clickPoint, { width, height }, meta.placement));
  }, [editing, clickPoint, meta.placement]);

  useEffect(() => {
    if (!editing) return;
    return claimPopover(closePopover);
  }, [editing, closePopover]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editing, closePopover]);

  const deliverNote = async (text: string) => {
    const payload: CrumbNote = { file: meta.src, functionality: crumbName, text };
    await (meta.onSubmit ?? postCrumbNote)(payload);
  };

  const submitNote = async () => {
    const text = note.trim();
    if (!text || noteStatus === "sending") return;
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
    if (granularityStatus === "sending") return;
    setGranularityStatus("sending");
    setGranularitySent(change);
    try {
      await deliverNote(GRANULARITY_INSTRUCTION[change]);
      setGranularityStatus("sent");
    } catch {
      setGranularityStatus("error");
    }
  };

  const noteFooter =
    noteStatus === "sending"
      ? "Sending…"
      : noteStatus === "sent"
        ? "Sent ✓"
        : noteStatus === "error"
          ? "Failed — retry"
          : "Enter to send · Esc to cancel";

  const granularityFooter =
    granularityStatus === "sending"
      ? "Asking…"
      : granularityStatus === "error"
        ? "Failed — retry"
        : granularityStatus === "sent"
          ? granularitySent === "increase"
            ? "Asked for more crumbs ✓"
            : "Asked for fewer crumbs ✓"
          : "− Fewer · + more crumbs here";

  return createPortal(
    <>
      {pencilShown && targetRect && (
        <button
          ref={pencilRef}
          className="crumb-pencil"
          style={{ left: `${targetRect.right - 11}px`, top: `${targetRect.top - 11}px` }}
          title={`${crumbName}${meta.src ? ` · ${meta.src}` : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (editing) {
              closePopover();
              return;
            }
            setClickPoint({ x: e.clientX, y: e.clientY });
            setPopoverPosition({ x: e.clientX + POPOVER_GAP, y: e.clientY + POPOVER_GAP });
            setEditing(true);
          }}
          onMouseEnter={keepPencil}
          onMouseLeave={(e) => hidePencilLater(e.relatedTarget)}
        >
          ✎
        </button>
      )}

      {editing && (
        <div
          ref={popoverRef}
          className="crumb-popover"
          style={{ left: `${popoverPosition.x}px`, top: `${popoverPosition.y}px` }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="crumb-pop-head">
            <span className="crumb-pop-label">{crumbName}</span>
            <span className="crumb-pop-meta">
              <span className="crumb-pop-src">{meta.src || "unknown source"}</span>
              <button
                className="crumb-pop-close"
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
            className={noteStatus === "error" ? "crumb-pop-input crumb-pop-err" : "crumb-pop-input"}
            type="text"
            placeholder="Add a note, Enter to send…"
            value={note}
            disabled={noteStatus === "sending"}
            onChange={(e) => setNote(e.currentTarget.value)}
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
          <div className="crumb-pop-foot">{noteFooter}</div>

          <div className="crumb-pop-gran">
            <span className="crumb-pop-gran-label">Granularity</span>
            <span className="crumb-gran">
              {GRANULARITY_CHANGES.map((change) => (
                <button
                  key={change}
                  className="crumb-gran-btn"
                  disabled={granularityStatus === "sending"}
                  title={GRANULARITY_UI[change].title}
                  onClick={(e) => {
                    e.stopPropagation();
                    sendGranularity(change);
                  }}
                >
                  {GRANULARITY_UI[change].glyph}
                </button>
              ))}
            </span>
            <span
              className={
                granularityStatus === "error" ? "crumb-pop-gran-hint crumb-gran-err" : "crumb-pop-gran-hint"
              }
            >
              {granularityFooter}
            </span>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
