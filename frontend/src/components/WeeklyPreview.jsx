/**
 * Mini weekly preview with drag-and-drop on proposed blocks.
 *
 * Props:
 *  - blocks: proposed blocks (mutable via dragging)
 *  - existingBlocks: read-only existing therapist sessions
 *  - therapists: [{therapist_id, therapist_name}, ...] — drives color palette
 *  - onBlockClick(block, kind): fires on a click WITHOUT drag movement
 *  - onBlockMove(blockIndex, {day, start, end}): fires when drag ends with a snap delta
 */
import React, { useEffect, useRef, useState, useMemo } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_HEIGHT = 28; // px per hour
const SNAP_MIN = 30;    // snap to half-hour
const PALETTE = [
  { bg: "#274f38", border: "#1E3D2B" },
  { bg: "#B07C60", border: "#946750" },
  { bg: "#7B968B", border: "#5e7a70" },
];

const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const blockTop = (t) => ((toMin(t) - HOUR_START * 60) / 60) * HOUR_HEIGHT;
const blockHeight = (s, e) => ((toMin(e) - toMin(s)) / 60) * HOUR_HEIGHT;

function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

export default function WeeklyPreview({
  blocks = [],
  existingBlocks = [],
  therapists = [],
  onBlockClick,
  onBlockMove,
}) {
  const therapistColor = useMemo(() => {
    const m = {};
    therapists.forEach((t, i) => { m[t.therapist_id] = PALETTE[i % PALETTE.length]; });
    return m;
  }, [therapists]);

  // Pre-compute conflicts: a proposed block overlaps an existing block on same therapist+day
  const conflictByIndex = useMemo(() => {
    const out = {};
    blocks.forEach((b, i) => {
      const bs = toMin(b.start), be = toMin(b.end);
      const conflicts = [];
      // vs existing
      for (const ex of existingBlocks) {
        if (ex.day !== b.day) continue;
        if (ex.therapist_id && b.therapist_id && ex.therapist_id !== b.therapist_id) continue;
        if (overlaps(bs, be, toMin(ex.start), toMin(ex.end))) {
          conflicts.push(`${ex.client_name || "Existing"} ${ex.start}-${ex.end}`);
        }
      }
      // vs other proposed (same therapist, same day)
      blocks.forEach((other, j) => {
        if (i === j) return;
        if (other.day !== b.day) return;
        if (other.therapist_id !== b.therapist_id) return;
        if (overlaps(bs, be, toMin(other.start), toMin(other.end))) {
          conflicts.push(`Another proposed block ${other.start}-${other.end}`);
        }
      });
      if (conflicts.length) out[i] = conflicts;
    });
    return out;
  }, [blocks, existingBlocks]);

  const proposedByDay = useMemo(() => {
    const m = {}; for (let i = 0; i < 7; i++) m[i] = [];
    blocks.forEach((b, i) => m[b.day].push({ ...b, _idx: i }));
    return m;
  }, [blocks]);

  const existingByDay = useMemo(() => {
    const m = {}; for (let i = 0; i < 7; i++) m[i] = [];
    existingBlocks.forEach(b => m[b.day].push(b));
    return m;
  }, [existingBlocks]);

  const totalHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

  // ---- Drag state ----
  const gridRef = useRef(null);
  const [drag, setDrag] = useState(null); // {idx, originX, originY, startMin, endMin, day, didMove}

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - drag.originX;
      const dy = e.clientY - drag.originY;
      const colWidth = rect.width / 7;
      let dayDelta = Math.round(dx / colWidth);
      let newDay = Math.max(0, Math.min(6, drag.day + dayDelta));
      let minDelta = Math.round((dy / HOUR_HEIGHT) * 60 / SNAP_MIN) * SNAP_MIN;
      const dur = drag.endMin - drag.startMin;
      let newStart = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - dur, drag.startMin + minDelta));
      let newEnd = newStart + dur;
      const moved = Math.abs(dx) > 3 || Math.abs(dy) > 3;
      setDrag({ ...drag, ghost: { day: newDay, startMin: newStart, endMin: newEnd }, didMove: drag.didMove || moved });
    };
    const onUp = () => {
      if (!drag) return;
      const block = blocks[drag.idx];
      if (drag.didMove && drag.ghost && onBlockMove) {
        const newDay = drag.ghost.day;
        const newStart = fromMin(drag.ghost.startMin);
        const newEnd = fromMin(drag.ghost.endMin);
        if (newDay !== block.day || newStart !== block.start || newEnd !== block.end) {
          onBlockMove(drag.idx, { day: newDay, start: newStart, end: newEnd });
        }
      } else if (!drag.didMove && onBlockClick) {
        // Treat as click
        onBlockClick(block, "proposed");
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, blocks, onBlockClick, onBlockMove]);

  const startDrag = (e, idx) => {
    e.preventDefault();
    const b = blocks[idx];
    setDrag({
      idx,
      originX: e.clientX,
      originY: e.clientY,
      startMin: toMin(b.start),
      endMin: toMin(b.end),
      day: b.day,
      didMove: false,
      ghost: null,
    });
  };

  return (
    <div className="border border-soft rounded-lg overflow-hidden bg-surface select-none" data-testid="weekly-preview">
      <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] bg-muted-soft border-b border-soft">
        <div></div>
        {DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold border-l border-soft text-center">
            {d}
          </div>
        ))}
      </div>
      <div ref={gridRef} className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))]" style={{ height: totalHeight }}>
        <div className="border-r border-soft">
          {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i).map((h) => (
            <div key={h} style={{ height: HOUR_HEIGHT }} className="px-1.5 pt-0.5 text-[9px] font-mono text-muted-ohana border-b border-[#EEEAE0]">
              {String(h).padStart(2, "0")}
            </div>
          ))}
        </div>
        {DAYS.map((_, dayIdx) => {
          const proposed = proposedByDay[dayIdx] || [];
          const existing = existingByDay[dayIdx] || [];
          return (
            <div key={dayIdx} className="relative border-l border-soft">
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i).map((i) => (
                <div key={i} style={{ height: HOUR_HEIGHT }} className="border-b border-[#EEEAE0]" />
              ))}

              {/* Existing blocks */}
              {existing.map((b, i) => (
                <button
                  type="button"
                  key={`ex-${i}`}
                  data-testid={`preview-existing-${dayIdx}-${i}`}
                  onClick={() => onBlockClick && onBlockClick(b, "existing")}
                  title={`Existing: ${b.client_name} · ${b.start}-${b.end}`}
                  style={{
                    top: blockTop(b.start),
                    height: blockHeight(b.start, b.end),
                    left: 2,
                    width: proposed.length > 0 ? "calc(50% - 3px)" : "calc(100% - 4px)",
                    backgroundImage: "repeating-linear-gradient(135deg, #DCE3E0 0 6px, #E5EBE8 6px 12px)",
                    borderLeft: "3px solid #A1ACA6",
                  }}
                  className="absolute rounded-sm text-[#586960] text-[9px] px-1 py-0.5 overflow-hidden cursor-pointer hover:ring-2 hover:ring-[#274f38]/20 transition-shadow text-left"
                >
                  <div className="font-mono">{b.start}–{b.end}</div>
                  <div className="truncate text-[8px] uppercase tracking-wider opacity-80">{b.client_name}</div>
                </button>
              ))}

              {/* Proposed blocks */}
              {proposed.map((b) => {
                const idx = b._idx;
                const color = therapistColor[b.therapist_id] || PALETTE[0];
                const isDragging = drag && drag.idx === idx;
                const display = isDragging && drag.ghost && drag.ghost.day === dayIdx
                  ? { start: fromMin(drag.ghost.startMin), end: fromMin(drag.ghost.endMin) }
                  : { start: b.start, end: b.end };
                if (isDragging && drag.ghost && drag.ghost.day !== dayIdx) return null;
                const conflict = conflictByIndex[idx];
                return (
                  <div
                    key={`pr-${idx}`}
                    data-testid={`preview-block-${dayIdx}-${idx}`}
                    onPointerDown={(e) => startDrag(e, idx)}
                    style={{
                      top: blockTop(display.start),
                      height: blockHeight(display.start, display.end),
                      left: existing.length > 0 ? "calc(50% + 1px)" : 2,
                      width: existing.length > 0 ? "calc(50% - 3px)" : "calc(100% - 4px)",
                      backgroundColor: color.bg,
                      borderLeft: `3px solid ${color.border}`,
                      opacity: isDragging ? 0.85 : 1,
                      boxShadow: conflict ? "0 0 0 2px #B85C5C" : (isDragging ? "0 8px 16px rgba(0,0,0,0.15)" : undefined),
                      zIndex: isDragging ? 10 : 1,
                      cursor: isDragging ? "grabbing" : "grab",
                    }}
                    title={conflict ? `Conflicts:\n${conflict.join("\n")}` : "Drag to move · click to edit"}
                    className="absolute rounded-sm text-white text-[10px] px-1.5 py-1 overflow-hidden hover:brightness-110 transition-all touch-none"
                  >
                    <div className="font-mono">{display.start}–{display.end}</div>
                    <div className="truncate text-white/90 text-[9px]">{b.therapist_name}</div>
                    {conflict && (
                      <div className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#B85C5C] ring-2 ring-white"></div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
