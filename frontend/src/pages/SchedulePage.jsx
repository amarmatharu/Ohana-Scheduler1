import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError, getToken, backendOrigin } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import { Plus, ChevronLeft, ChevronRight, AlertTriangle, Coffee, Car, Download } from "lucide-react";
import { formatLocalISODate } from "../lib/dates";

const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const HOURS = Array.from({length: 14}, (_, i) => 8 + i); // 8am..9pm
const HOUR_HEIGHT = 52;

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday as start
  date.setDate(date.getDate() + diff);
  date.setHours(0,0,0,0);
  return date;
}

function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate()+n); return c; }
function iso(d) { return formatLocalISODate(d); }

export default function SchedulePage() {
  const [weekStart, setWeekStart] = useState(startOfWeek(new Date()));
  const [therapists, setTherapists] = useState([]);
  const [clients, setClients] = useState([]);
  const [therapistId, setTherapistId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_id: "", date: iso(new Date()), start_time: "15:00", end_time: "17:00", notes: "" });
  const [saving, setSaving] = useState(false);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const loadBase = async () => {
    const [t, c] = await Promise.all([api.get("/therapists"), api.get("/clients")]);
    setTherapists(t.data);
    setClients(c.data);
    if (!therapistId && t.data.length) setTherapistId(t.data[0].id);
  };

  const loadSessions = async () => {
    if (!therapistId) return;
    const { data } = await api.get("/sessions", { params: { therapist_id: therapistId, start_date: iso(weekStart), end_date: iso(weekEnd) } });
    setSessions(data);
  };

  useEffect(() => { loadBase(); }, []);
  useEffect(() => { loadSessions(); }, [therapistId, weekStart]);

  const openNew = (day) => {
    const date = iso(addDays(weekStart, day));
    setForm({ client_id: clients[0]?.id || "", date, start_time: "15:00", end_time: "17:00", notes: "" });
    setOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/sessions", { ...form, therapist_id: therapistId });
      toast.success("Session scheduled");
      setOpen(false); loadSessions();
    } catch (e) {
      const d = e.response?.data?.detail;
      if (typeof d === "object" && d?.errors) {
        toast.error(d.errors.join(" "));
      } else toast.error(formatApiError(d) || e.message);
    } finally { setSaving(false); }
  };

  const deleteSession = async (s) => {
    if (!window.confirm("Delete this session?")) return;
    await api.delete(`/sessions/${s.id}`);
    toast.success("Session removed"); loadSessions();
  };

  const blocksByDay = useMemo(() => {
    const map = {};
    for (let i=0;i<7;i++) map[i] = [];
    sessions.forEach(s => {
      const d = new Date(s.date);
      const diff = Math.floor((d - weekStart) / (1000*60*60*24));
      if (diff >=0 && diff < 7) map[diff].push(s);
    });
    return map;
  }, [sessions, weekStart]);

  const clientName = (id) => clients.find(c=>c.id===id)?.name || "Client";

  return (
    <div>
      <PageHeader
        title="Schedule builder"
        subtitle="Block scheduling with automatic rest, lunch, and travel enforcement."
      />
      <div className="px-10 pb-10 space-y-6">
        <div className="bg-surface border border-soft rounded-lg p-4 flex items-center gap-4 card-shadow">
          <select data-testid="schedule-therapist-select" value={therapistId} onChange={(e)=>setTherapistId(e.target.value)} className="h-10 px-3 rounded-md border border-soft bg-white text-sm min-w-[240px]">
            {therapists.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-2 ml-auto">
            <Button
              data-testid="export-ics-btn"
              variant="outline"
              size="sm"
              onClick={() => {
                const token = getToken();
                const url = `${backendOrigin()}/api/sessions/export.ics?therapist_id=${therapistId}&token=${encodeURIComponent(token || "")}`;
                window.open(url, "_blank");
              }}
              disabled={!therapistId}
            >
              <Download size={14} className="mr-1"/> Export .ics
            </Button>
            <Button variant="outline" size="sm" data-testid="week-prev" onClick={()=>setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={14}/></Button>
            <div className="font-mono text-sm px-2" data-testid="week-label">{iso(weekStart)} → {iso(weekEnd)}</div>
            <Button variant="outline" size="sm" data-testid="week-next" onClick={()=>setWeekStart(addDays(weekStart, 7))}><ChevronRight size={14}/></Button>
            <Button size="sm" data-testid="today-btn" onClick={()=>setWeekStart(startOfWeek(new Date()))}>Today</Button>
          </div>
        </div>

        <div className="bg-surface border border-soft rounded-lg card-shadow overflow-hidden" data-testid="schedule-grid">
          <div className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] border-b border-soft bg-muted-soft">
            <div className="px-3 py-3 text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">Time</div>
            {DAYS.map((d, i) => (
              <div key={i} className="px-3 py-3 text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold border-l border-soft flex items-center justify-between">
                <div>
                  <div>{d}</div>
                  <div className="font-mono text-[11px] normal-case tracking-normal text-[#586960] mt-0.5">{iso(addDays(weekStart, i))}</div>
                </div>
                <button data-testid={`add-session-day-${i}`} onClick={()=>openNew(i)} className="ml-1 text-[#274f38] hover:bg-white rounded-md p-1"><Plus size={14}/></button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[80px_repeat(7,minmax(0,1fr))] relative">
            {/* Hour rows */}
            <div>
              {HOURS.map(h => (
                <div key={h} style={{height:HOUR_HEIGHT}} className="border-b border-soft px-3 pt-1 text-[11px] font-mono text-muted-ohana">{String(h).padStart(2,"0")}:00</div>
              ))}
            </div>
            {DAYS.map((_, dayIdx) => (
              <div key={dayIdx} className="relative border-l border-soft" style={{height: HOURS.length * HOUR_HEIGHT}}>
                {HOURS.map(h => <div key={h} style={{height:HOUR_HEIGHT}} className="border-b border-[#EEEAE0]"/> )}
                {blocksByDay[dayIdx]?.map(s => {
                  const [sh, sm] = s.start_time.split(":").map(Number);
                  const [eh, em] = s.end_time.split(":").map(Number);
                  const top = ((sh - HOURS[0]) + sm/60) * HOUR_HEIGHT;
                  const height = ((eh - sh) + (em - sm)/60) * HOUR_HEIGHT;
                  if (top < 0 || top > HOURS.length*HOUR_HEIGHT) return null;
                  return (
                    <div
                      key={s.id}
                      data-testid={`sch-block-${s.id}`}
                      onDoubleClick={()=>deleteSession(s)}
                      style={{ top, height, left: 6, right: 6 }}
                      className="absolute bg-[#E5EBE8] border-l-4 border-[#274f38] rounded-md p-2 text-xs hover:bg-[#DCE3E0] cursor-pointer transition-colors"
                    >
                      <div className="font-medium text-[#18231E] truncate">{clientName(s.client_id)}</div>
                      <div className="font-mono text-[10px] text-[#586960]">{s.start_time}–{s.end_time}</div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {s.rest_break_required && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-[#FDF4E7] text-[#B07C60]"><AlertTriangle size={8}/> rest</span>}
                        {s.lunch_break_required && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-[#FDF4E7] text-[#B07C60]"><Coffee size={8}/> lunch</span>}
                        {s.travel_minutes_before > 0 && <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0 rounded-full bg-[#DCE3E0] text-[#274f38]"><Car size={8}/> {s.travel_minutes_before}m</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-ohana">Tip: double-click a block to delete it. Click <Plus size={12} className="inline"/> on a day header to add a session.</p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="schedule-dialog">
          <DialogHeader><DialogTitle style={{fontFamily:'Outfit'}}>New session block</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4 pt-2">
            <div>
              <Label>Client</Label>
              <select data-testid="s-client" required value={form.client_id} onChange={(e)=>setForm({...form,client_id:e.target.value})} className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm">
                <option value="">— select —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><Label>Date</Label><Input data-testid="s-date" type="date" required value={form.date} onChange={(e)=>setForm({...form,date:e.target.value})}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start</Label><Input data-testid="s-start" type="time" required value={form.start_time} onChange={(e)=>setForm({...form,start_time:e.target.value})}/></div>
              <div><Label>End</Label><Input data-testid="s-end" type="time" required value={form.end_time} onChange={(e)=>setForm({...form,end_time:e.target.value})}/></div>
            </div>
            <div><Label>Notes (optional)</Label><Input data-testid="s-notes" value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-session-btn" disabled={saving} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white">{saving ? "Saving…" : "Create session"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
