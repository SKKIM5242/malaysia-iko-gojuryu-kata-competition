"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

let zCounter = 200;

/** True landscape = viewport wider than tall — the split buttons arrange
 * windows side-by-side only then; in portrait they stack top/bottom. */
function isLandscape() {
  return typeof window !== "undefined" && window.innerWidth >= window.innerHeight;
}

export function halfBounds(which: "first" | "second"): Bounds {
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (isLandscape()) {
    return { x: which === "first" ? 8 : W / 2 + 4, y: 8, w: W / 2 - 12, h: H - 16 };
  }
  return { x: 8, y: which === "first" ? 8 : H / 2 + 4, w: W - 16, h: H / 2 - 12 };
}

function centerBounds(w: number, h: number): Bounds {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const width = Math.min(w, W - 16);
  const height = Math.min(h, H - 16);
  return { x: (W - width) / 2, y: Math.max(8, (H - height) / 2), w: width, h: height };
}

const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type Edge = (typeof EDGES)[number];

const EDGE_STYLE: Record<Edge, React.CSSProperties> = {
  n: { top: -4, left: 8, right: 8, height: 8, cursor: "ns-resize" },
  s: { bottom: -4, left: 8, right: 8, height: 8, cursor: "ns-resize" },
  e: { right: -4, top: 8, bottom: 8, width: 8, cursor: "ew-resize" },
  w: { left: -4, top: 8, bottom: 8, width: 8, cursor: "ew-resize" },
  ne: { top: -4, right: -4, width: 14, height: 14, cursor: "nesw-resize" },
  nw: { top: -4, left: -4, width: 14, height: 14, cursor: "nwse-resize" },
  se: { bottom: -4, right: -4, width: 14, height: 14, cursor: "nwse-resize" },
  sw: { bottom: -4, left: -4, width: 14, height: 14, cursor: "nesw-resize" },
};

/**
 * A real floating window: drag it anywhere (grab any non-interactive spot,
 * not just the title bar), resize from every border line and corner,
 * minimize to a title strip, maximize to full screen, snap to either half
 * of the screen (side-by-side in landscape, stacked in portrait), and
 * close from the top-right corner. Used by Watch Recording, the referee
 * score sheets, and Full View.
 */
export default function FloatingWindow({
  title,
  onClose,
  children,
  initial = "center",
  defaultWidth = 720,
  defaultHeight = 520,
  headerExtra,
  boundsSignal,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  initial?: "center" | "first-half" | "second-half" | "max";
  defaultWidth?: number;
  defaultHeight?: number;
  headerExtra?: ReactNode;
  /** Bump this number to re-apply `initial` placement (e.g. re-split). */
  boundsSignal?: number;
}) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [z, setZ] = useState(() => ++zCounter);
  const restoreRef = useRef<Bounds | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; orig: Bounds } | null>(null);
  const resizeRef = useRef<{ edge: Edge; startX: number; startY: number; orig: Bounds } | null>(null);
  const winRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    if (initial === "first-half") setBounds(halfBounds("first"));
    else if (initial === "second-half") setBounds(halfBounds("second"));
    else setBounds(centerBounds(defaultWidth, defaultHeight));
    setMaximized(initial === "max");
    setMinimized(false);
  }, [initial, defaultWidth, defaultHeight]);

  useEffect(() => {
    place();
  }, [place, boundsSignal]);

  const bringToFront = () => setZ(++zCounter);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (dragRef.current && bounds) {
        const { startX, startY, orig } = dragRef.current;
        setBounds({
          ...orig,
          x: Math.min(Math.max(orig.x + e.clientX - startX, -orig.w + 60), window.innerWidth - 60),
          y: Math.min(Math.max(orig.y + e.clientY - startY, 0), window.innerHeight - 40),
        });
      } else if (resizeRef.current) {
        const { edge, startX, startY, orig } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        let { x, y, w, h } = orig;
        if (edge.includes("e")) w = Math.max(280, orig.w + dx);
        if (edge.includes("s")) h = Math.max(160, orig.h + dy);
        if (edge.includes("w")) {
          w = Math.max(280, orig.w - dx);
          x = orig.x + (orig.w - w);
        }
        if (edge.includes("n")) {
          h = Math.max(160, orig.h - dy);
          y = orig.y + (orig.h - h);
        }
        setBounds({ x, y, w, h });
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [bounds]);

  if (!bounds) return null;

  const INTERACTIVE = "button, input, select, textarea, a, video, label, form, [data-no-drag]";

  function startDrag(e: React.PointerEvent) {
    if (maximized || minimized) return;
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    bringToFront();
    dragRef.current = { startX: e.clientX, startY: e.clientY, orig: bounds! };
  }

  function startResize(edge: Edge) {
    return (e: React.PointerEvent) => {
      if (maximized || minimized) return;
      e.stopPropagation();
      bringToFront();
      resizeRef.current = { edge, startX: e.clientX, startY: e.clientY, orig: bounds! };
    };
  }

  function toggleMaximize() {
    if (maximized) {
      setMaximized(false);
      if (restoreRef.current) setBounds(restoreRef.current);
    } else {
      restoreRef.current = bounds;
      setMaximized(true);
      setMinimized(false);
    }
  }

  function snap(which: "first" | "second") {
    setMaximized(false);
    setMinimized(false);
    setBounds(halfBounds(which));
  }

  const frame: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: "100vw", height: "100vh" }
    : { left: bounds.x, top: bounds.y, width: bounds.w, height: minimized ? "auto" : bounds.h };

  const btn =
    "flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800";

  return (
    <div
      ref={winRef}
      className="fixed flex flex-col overflow-visible rounded-lg border-2 border-neutral-300 bg-white shadow-2xl"
      style={{ ...frame, zIndex: z, touchAction: "none" }}
      onPointerDown={(e) => {
        bringToFront();
        startDrag(e);
      }}
    >
      <div className="flex shrink-0 cursor-move items-center justify-between gap-2 rounded-t-md border-b border-neutral-200 bg-neutral-100 px-3 py-1.5">
        <p className="truncate text-xs font-bold text-neutral-700">{title}</p>
        <div className="flex items-center gap-0.5" data-no-drag>
          {headerExtra}
          <button type="button" onClick={() => snap("first")} className={btn} title="Snap to first half (left in landscape, top in portrait)">
            ◧
          </button>
          <button type="button" onClick={() => snap("second")} className={btn} title="Snap to second half (right in landscape, bottom in portrait)">
            ◨
          </button>
          <button
            type="button"
            onClick={() => {
              setMinimized((m) => !m);
              setMaximized(false);
            }}
            className={btn}
            title={minimized ? "Restore" : "Minimize"}
          >
            —
          </button>
          <button type="button" onClick={toggleMaximize} className={btn} title={maximized ? "Restore size" : "Maximize"}>
            {maximized ? "❐" : "□"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-neutral-500 hover:bg-red-600 hover:text-white"
            title="Close"
            aria-label="Close window"
          >
            ✕
          </button>
        </div>
      </div>
      {!minimized && <div className="min-h-0 flex-1 overflow-auto">{children}</div>}
      {!maximized &&
        !minimized &&
        EDGES.map((edge) => (
          <div key={edge} className="absolute" style={EDGE_STYLE[edge]} onPointerDown={startResize(edge)} />
        ))}
    </div>
  );
}
