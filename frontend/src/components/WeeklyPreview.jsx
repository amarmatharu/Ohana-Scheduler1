/**
 * Mini weekly preview — visualizes proposed_blocks across a Mon-Sun grid.
 * Optional `existingBlocks` are rendered in a muted, striped style behind/alongside proposed blocks
 * so the admin sees the therapist's full week context.
 */
import React from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_HEIGHT = 28;
const PALETTE = [
  { bg: "#274f38", border: "#1E3D2B" },
  { bg: "#B07C60", border: "#946750" },
  { bg: "#7B968B", border: "#5e7a70" },
];

function blockTop(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return ((h - HOUR_START) + m / 60) * HOUR_HEIGHT;
}
function blockHeight(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return ((eh - sh) + (em - sm) / 60) * HOUR_HEIGHT;
}

export default function WeeklyPreview({ blocks = [], existingBlocks = [], therapists = [] }) {
  const therapistColor = {};
  therapists.forEach((t, i) => {
    therapistColor[t.therapist_id] = PALETTE[i % PALETTE.length];
  });

  const proposedByDay = {};
  const existingByDay = {};
  for (let i = 0; i < 7; i++) { proposedByDay[i] = []; existingByDay[i] = []; }
  blocks.forEach((b) => proposedByDay[b.day].push(b));
  existingBlocks.forEach((b) => existingByDay[b.day].push(b));

  const totalHeight = (HOUR_END - HOUR_START) * HOUR_HEIGHT;

  return (
    <div className="border border-soft rounded-lg overflow-hidden bg-surface" data-testid="weekly-preview">
      <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] bg-muted-soft border-b border-soft">
        <div></div>
        {DAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold border-l border-soft text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[44px_repeat(7,minmax(0,1fr))]" style={{ height: totalHeight }}>
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
          // Proposed blocks take the right half, existing the left half if both present on same day
          return (
            <div key={dayIdx} className="relative border-l border-soft">
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => i).map((i) => (
                <div key={i} style={{ height: HOUR_HEIGHT }} className="border-b border-[#EEEAE0]" />
              ))}

              {/* Existing blocks (muted, striped) */}
              {existing.map((b, i) => (
                <div
                  key={`ex-${i}`}
                  data-testid={`preview-existing-${dayIdx}-${i}`}
                  title={`Existing: ${b.client_name} · ${b.start}-${b.end}`}
                  style={{
                    top: blockTop(b.start),
                    height: blockHeight(b.start, b.end),
                    left: 2,
                    width: proposed.length > 0 ? "calc(50% - 3px)" : "calc(100% - 4px)",
                    backgroundImage: "repeating-linear-gradient(135deg, #DCE3E0 0 6px, #E5EBE8 6px 12px)",
                    borderLeft: "3px solid #A1ACA6",
                  }}
                  className="absolute rounded-sm text-[#586960] text-[9px] px-1 py-0.5 overflow-hidden"
                >
                  <div className="font-mono">{b.start}–{b.end}</div>
                  <div className="truncate text-[8px] uppercase tracking-wider opacity-80">{b.client_name}</div>
                </div>
              ))}

              {/* Proposed blocks */}
              {proposed.map((b, i) => {
                const color = therapistColor[b.therapist_id] || PALETTE[0];
                return (
                  <div
                    key={`pr-${i}`}
                    data-testid={`preview-block-${dayIdx}-${i}`}
                    style={{
                      top: blockTop(b.start),
                      height: blockHeight(b.start, b.end),
                      left: existing.length > 0 ? "calc(50% + 1px)" : 2,
                      width: existing.length > 0 ? "calc(50% - 3px)" : "calc(100% - 4px)",
                      backgroundColor: color.bg,
                      borderLeft: `3px solid ${color.border}`,
                    }}
                    className="absolute rounded-sm text-white text-[10px] px-1.5 py-1 overflow-hidden shadow-sm"
                  >
                    <div className="font-mono">{b.start}–{b.end}</div>
                    <div className="truncate text-white/90 text-[9px]">{b.therapist_name}</div>
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
