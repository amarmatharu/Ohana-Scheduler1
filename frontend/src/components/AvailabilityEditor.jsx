/**
 * Availability picker: weekly grid of day × time blocks.
 * Value: [{day: 0-6, start: "HH:MM", end: "HH:MM", hours?: number}]
 *
 * `showHours` prop: when true, shows a per-row "hours" input (used for client intake
 * where availability window may be wider than therapy hours actually wanted that day).
 */
import React from "react";
import { Clock } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function durationHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  return Math.max(0, mins / 60);
}

export default function AvailabilityEditor({ value = [], onChange, showHours = false }) {
  const addBlock = () => {
    const day = 0;
    const start = "15:00";
    const end = "17:00";
    const hours = showHours ? durationHours(start, end) : undefined;
    const next = { day, start, end };
    if (showHours) next.hours = hours;
    onChange([...value, next]);
  };
  const updateBlock = (i, patch) => {
    const next = value.slice();
    const merged = { ...next[i], ...patch };
    // If start/end changed and hours wasn't manually edited, default hours to window duration
    if (showHours && (patch.start !== undefined || patch.end !== undefined) && patch.hours === undefined) {
      const winDur = durationHours(merged.start, merged.end);
      // Cap hours to new window duration
      if (merged.hours == null || merged.hours > winDur) {
        merged.hours = winDur;
      }
    }
    next[i] = merged;
    onChange(next);
  };
  const removeBlock = (i) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  const totalHours = showHours
    ? value.reduce((sum, b) => sum + (parseFloat(b.hours) || 0), 0)
    : 0;

  return (
    <div className="space-y-2" data-testid="availability-editor">
      {showHours && value.length > 0 && (
        <div className="grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_110px_90px] gap-2 px-1 text-[10px] uppercase tracking-[0.18em] text-muted-ohana font-semibold">
          <div>Day</div>
          <div>Window start</div>
          <div>Window end</div>
          <div>Hours / day</div>
          <div></div>
        </div>
      )}
      {value.map((b, i) => {
        const winDur = durationHours(b.start, b.end);
        const hoursVal = b.hours ?? winDur;
        const overWindow = showHours && hoursVal > winDur + 0.01;
        return (
          <div
            key={i}
            className={`${showHours ? "grid grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_110px_90px]" : "flex"} gap-2 items-center`}
            data-testid={`avail-row-${i}`}
          >
            <select
              value={b.day}
              onChange={(e) => updateBlock(i, { day: parseInt(e.target.value) })}
              className="h-10 px-3 rounded-md border border-soft bg-white text-sm"
            >
              {DAYS.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
            </select>
            <input
              type="time"
              value={b.start}
              onChange={(e) => updateBlock(i, { start: e.target.value })}
              className="h-10 px-3 rounded-md border border-soft bg-white text-sm font-mono"
            />
            {!showHours && <span className="text-muted-ohana">—</span>}
            <input
              type="time"
              value={b.end}
              onChange={(e) => updateBlock(i, { end: e.target.value })}
              className="h-10 px-3 rounded-md border border-soft bg-white text-sm font-mono"
            />
            {showHours && (
              <input
                type="number"
                step="0.5"
                min="0"
                max={winDur}
                value={hoursVal}
                onChange={(e) => updateBlock(i, { hours: parseFloat(e.target.value) || 0 })}
                data-testid={`avail-hours-${i}`}
                className={`h-10 px-3 rounded-md border bg-white text-sm font-mono ${overWindow ? "border-[#B85C5C] text-[#B85C5C]" : "border-soft"}`}
                title={`Window allows up to ${winDur} hr`}
              />
            )}
            <button
              type="button"
              onClick={() => removeBlock(i)}
              data-testid={`avail-remove-${i}`}
              className="h-10 px-3 rounded-md border border-soft text-[#B85C5C] text-sm hover:border-[#B85C5C]"
            >
              Remove
            </button>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addBlock}
          data-testid="avail-add"
          className="h-10 px-4 rounded-md border border-dashed border-soft text-sm text-[#274f38] hover:border-[#274f38]"
        >
          + Add availability window
        </button>
        {showHours && value.length > 0 && (
          <div data-testid="avail-total" className="inline-flex items-center gap-2 text-sm bg-[#E5EBE8] text-[#274f38] px-3 py-1.5 rounded-md">
            <Clock size={14} />
            <span className="font-mono">{totalHours.toFixed(1)} hr / week</span>
          </div>
        )}
      </div>
      {showHours && (
        <p className="text-xs text-muted-ohana mt-1">
          Set how many therapy hours are wanted on each day (may be less than the window itself).
          Total hours below should match the client's needed weekly hours.
        </p>
      )}
    </div>
  );
}
