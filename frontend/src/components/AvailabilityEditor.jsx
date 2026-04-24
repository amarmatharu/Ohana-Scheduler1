/**
 * Availability picker: weekly grid of day × time blocks.
 * Value: [{day: 0-6, start: "HH:MM", end: "HH:MM"}]
 */
import React from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function AvailabilityEditor({ value = [], onChange }) {
  const addBlock = () => {
    onChange([...value, { day: 0, start: "09:00", end: "17:00" }]);
  };
  const updateBlock = (i, patch) => {
    const next = value.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const removeBlock = (i) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-2" data-testid="availability-editor">
      {value.map((b, i) => (
        <div key={i} className="flex items-center gap-2" data-testid={`avail-row-${i}`}>
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
          <span className="text-muted-ohana">—</span>
          <input
            type="time"
            value={b.end}
            onChange={(e) => updateBlock(i, { end: e.target.value })}
            className="h-10 px-3 rounded-md border border-soft bg-white text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => removeBlock(i)}
            data-testid={`avail-remove-${i}`}
            className="h-10 px-3 rounded-md border border-soft text-[#B85C5C] text-sm hover:border-[#B85C5C]"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addBlock}
        data-testid="avail-add"
        className="h-10 px-4 rounded-md border border-dashed border-soft text-sm text-[#274f38] hover:border-[#274f38]"
      >
        + Add availability window
      </button>
    </div>
  );
}
