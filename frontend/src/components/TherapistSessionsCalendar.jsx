import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import { Button } from "./ui/button";
import { ChevronLeft, ChevronRight, AlertTriangle, Coffee, Car } from "lucide-react";
import { toast } from "sonner";
import { formatLocalISODate } from "../lib/dates";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 14 }, (_, i) => 8 + i);
const HOUR_HEIGHT = 52;

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function iso(d) {
  return formatLocalISODate(d);
}

/**
 * Read-only week grid of sessions for one therapist (admin view under Therapists).
 */
export default function TherapistSessionsCalendar({ therapistId, clientLookup = {} }) {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [sessions, setSessions] = useState([]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  useEffect(() => {
    if (!therapistId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/sessions", {
          params: {
            therapist_id: therapistId,
            start_date: iso(weekStart),
            end_date: iso(weekEnd),
          },
        });
        if (!cancelled) setSessions(data.filter((s) => s.status !== "cancelled"));
      } catch (e) {
        if (!cancelled) toast.error(formatApiError(e.response?.data?.detail) || e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [therapistId, weekStart]);

  const blocksByDay = useMemo(() => {
    const map = {};
    for (let i = 0; i < 7; i++) map[i] = [];
    sessions.forEach((s) => {
      const d = new Date(s.date + "T12:00:00");
      const diff = Math.floor((d - weekStart) / (1000 * 60 * 60 * 24));
      if (diff >= 0 && diff < 7) map[diff].push(s);
    });
    return map;
  }, [sessions, weekStart]);

  const clientName = (id) => clientLookup[id] || "Client";

  if (!therapistId) return null;

  return (
    <div className="space-y-3" data-testid="therapist-sessions-calendar">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft size={14} />
        </Button>
        <div className="font-mono text-sm px-2">
          {iso(weekStart)} → {iso(weekEnd)}
        </div>
        <Button variant="outline" size="sm" type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight size={14} />
        </Button>
        <Button size="sm" type="button" variant="secondary" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          This week
        </Button>
      </div>

      <div className="border border-soft rounded-lg overflow-hidden bg-surface max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] border-b border-soft bg-muted-soft sticky top-0 z-[1]">
          <div className="px-3 py-3 text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">Time</div>
          {DAYS.map((d, i) => (
            <div key={i} className="px-3 py-3 text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold border-l border-soft">
              <div>{d}</div>
              <div className="font-mono text-[11px] normal-case tracking-normal text-[#586960] mt-0.5">{iso(addDays(weekStart, i))}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] relative">
          <div>
            {HOURS.map((h) => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-soft px-3 pt-1 text-[11px] font-mono text-muted-ohana">
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {DAYS.map((_, dayIdx) => (
            <div key={dayIdx} className="relative border-l border-soft" style={{ height: HOURS.length * HOUR_HEIGHT }}>
              {HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_HEIGHT }} className="border-b border-[#EEEAE0]" />
              ))}
              {blocksByDay[dayIdx]?.map((s) => {
                const [sh, sm] = s.start_time.split(":").map(Number);
                const [eh, em] = s.end_time.split(":").map(Number);
                const top = (sh - HOURS[0] + sm / 60) * HOUR_HEIGHT;
                const height = (eh - sh + (em - sm) / 60) * HOUR_HEIGHT;
                if (top < 0 || top > HOURS.length * HOUR_HEIGHT) return null;
                return (
                  <div
                    key={s.id}
                    style={{ top, height, left: 6, right: 6 }}
                    className="absolute bg-[#E5EBE8] border-l-4 border-[#274f38] rounded-md p-2 text-xs"
                  >
                    <div className="font-medium text-[#18231E] truncate">{clientName(s.client_id)}</div>
                    <div className="font-mono text-[10px] text-[#586960]">
                      {s.start_time}–{s.end_time}
                    </div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {s.rest_break_required && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-[#FDF4E7] text-[#B07C60]">
                          <AlertTriangle size={8} /> rest
                        </span>
                      )}
                      {s.lunch_break_required && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-[#FDF4E7] text-[#B07C60]">
                          <Coffee size={8} /> lunch
                        </span>
                      )}
                      {s.travel_minutes_before > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-[#DCE3E0] text-[#274f38]">
                          <Car size={8} /> {s.travel_minutes_before}m
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
