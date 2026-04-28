import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import PageHeader from "../components/PageHeader";
import AvailabilityEditor from "../components/AvailabilityEditor";
import AddressAutocomplete from "../components/AddressAutocomplete";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import { Plus, MapPin, Trash2, Pencil, Calendar } from "lucide-react";
import TherapistSessionsCalendar from "../components/TherapistSessionsCalendar";

const THERAPIST_ROLE_OPTIONS = [
  { value: "bt", label: "BT — Behavior Intervention" },
  { value: "program_manager", label: "Program Manager" },
  { value: "bcba", label: "BCBA" },
];

const roleLabel = (v) => THERAPIST_ROLE_OPTIONS.find((o) => o.value === v)?.label || v;

const empty = {
  name: "", email: "", phone: "", gender: "no_preference",
  therapist_role: "bt",
  skill_level: "intermediate", skills: [], home_address: "",
  capacity_hours_per_week: 30, availability: [], weekend_available: false, notes: "",
};

export default function TherapistsPage() {
  const [therapists, setTherapists] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [calendarTherapist, setCalendarTherapist] = useState(null);

  const load = async () => {
    try {
      const [tRes, cRes] = await Promise.all([api.get("/therapists"), api.get("/clients")]);
      setTherapists(tRes.data);
      setClients(cRes.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };
  useEffect(() => { load(); }, []);

  const clientLookup = useMemo(() => {
    const m = {};
    (clients || []).forEach((c) => {
      m[c.id] = c.name;
    });
    return m;
  }, [clients]);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (t) => { setEditing(t); setForm({ ...empty, ...t, skills: t.skills || [] }); setOpen(true); };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        capacity_hours_per_week: parseFloat(form.capacity_hours_per_week) || 0,
        skills: typeof form.skills === "string" ? form.skills.split(",").map(s => s.trim()).filter(Boolean) : form.skills,
      };
      if (editing) await api.put(`/therapists/${editing.id}`, payload);
      else await api.post("/therapists", payload);
      toast.success(editing ? "Therapist updated" : "Therapist created");
      setOpen(false);
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally { setSaving(false); }
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete ${t.name}?`)) return;
    await api.delete(`/therapists/${t.id}`);
    toast.success("Therapist removed");
    load();
  };

  return (
    <div>
      <PageHeader
        title="Therapists"
        subtitle="Manage therapist profiles, skills, and availability."
        action={
          <Button data-testid="new-therapist-btn" onClick={openNew} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white">
            <Plus size={16} className="mr-1" /> New therapist
          </Button>
        }
      />
      <div className="px-10 pb-10">
        <div className="bg-surface border border-soft rounded-lg card-shadow overflow-hidden" data-testid="therapists-table">
          <table className="w-full">
            <thead className="bg-muted-soft">
              <tr className="text-left text-xs tracking-[0.18em] uppercase text-muted-ohana">
                <th className="px-6 py-3 font-semibold">Name</th>
                <th className="px-6 py-3 font-semibold">Role</th>
                <th className="px-6 py-3 font-semibold">Skill</th>
                <th className="px-6 py-3 font-semibold">Capacity</th>
                <th className="px-6 py-3 font-semibold">Location</th>
                <th className="px-6 py-3 font-semibold">Weekend</th>
                <th className="px-6 py-3 font-semibold">Sessions</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DFD5]">
              {therapists.map((t) => (
                <tr key={t.id} data-testid={`therapist-row-${t.id}`} className="text-sm">
                  <td className="px-6 py-4">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-ohana">{t.email}</div>
                  </td>
                  <td className="px-6 py-4 text-xs">
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-[#E5EBE8] text-[#274f38] font-medium">
                      {roleLabel(t.therapist_role || "bt")}
                    </span>
                  </td>
                  <td className="px-6 py-4 capitalize">{t.skill_level}</td>
                  <td className="px-6 py-4 font-mono text-xs">
                    {t.current_caseload_hours}/{t.capacity_hours_per_week} hr
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-ohana">
                    <span className="inline-flex items-center gap-1"><MapPin size={12}/>{t.home_address?.slice(0, 40)}{t.home_address?.length > 40 ? "…" : ""}</span>
                  </td>
                  <td className="px-6 py-4">
                    {t.weekend_available ? <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8F0EA] text-[#274f38]">Yes</span> : <span className="text-xs text-muted-ohana">No</span>}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      data-testid={`therapist-calendar-${t.id}`}
                      onClick={() => setCalendarTherapist(t)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-soft text-[#274f38] hover:bg-[#E5EBE8]"
                    >
                      <Calendar size={14} /> Week view
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={() => openEdit(t)} data-testid={`edit-therapist-${t.id}`} className="p-2 hover:bg-muted-soft rounded-md"><Pencil size={14}/></button>
                    <button onClick={() => remove(t)} data-testid={`delete-therapist-${t.id}`} className="p-2 hover:bg-muted-soft rounded-md text-[#B85C5C]"><Trash2 size={14}/></button>
                  </td>
                </tr>
              ))}
              {therapists.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-muted-ohana text-sm">No therapists yet. Click "New therapist" to add one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-white" data-testid="therapist-dialog">
          <DialogHeader>
            <DialogTitle style={{fontFamily:'Outfit'}}>{editing ? "Edit therapist" : "New therapist"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Name</Label><Input data-testid="t-name" required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></div>
              <div><Label>Email</Label><Input data-testid="t-email" type="email" required value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/></div>
              <div><Label>Phone</Label><Input data-testid="t-phone" value={form.phone || ""} onChange={(e)=>setForm({...form,phone:e.target.value})}/></div>
              <div>
                <Label>Gender</Label>
                <select data-testid="t-gender" value={form.gender} onChange={(e)=>setForm({...form,gender:e.target.value})} className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm">
                  <option value="no_preference">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="nonbinary">Non-binary</option>
                </select>
              </div>
              <div>
                <Label>Therapist role</Label>
                <select
                  data-testid="t-therapist-role"
                  value={form.therapist_role || "bt"}
                  onChange={(e) => setForm({ ...form, therapist_role: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm"
                >
                  {THERAPIST_ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Skill level</Label>
                <select data-testid="t-skill-level" value={form.skill_level} onChange={(e)=>setForm({...form,skill_level:e.target.value})} className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm">
                  <option value="entry">Entry-level</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="experienced">Experienced</option>
                </select>
              </div>
              <div><Label>Capacity (hrs/week)</Label><Input data-testid="t-capacity" type="number" step="0.5" value={form.capacity_hours_per_week} onChange={(e)=>setForm({...form,capacity_hours_per_week:e.target.value})}/></div>
            </div>
            <div><Label>Skills (comma separated)</Label><Input data-testid="t-skills" value={Array.isArray(form.skills) ? form.skills.join(", ") : form.skills} onChange={(e)=>setForm({...form,skills:e.target.value})} placeholder="ABA, Autism, Speech, Trauma"/></div>
            <div><Label>Home address</Label><AddressAutocomplete testId="t-address" value={form.home_address} onChange={(v)=>setForm({...form,home_address:v})} required placeholder="Start typing an address…"/></div>
            <div className="flex items-center gap-2"><input id="t-weekend" data-testid="t-weekend" type="checkbox" checked={form.weekend_available} onChange={(e)=>setForm({...form,weekend_available:e.target.checked})} className="w-4 h-4 rounded border-soft"/><Label htmlFor="t-weekend" className="cursor-pointer">Available on weekends</Label></div>
            <div><Label>Weekly availability</Label><AvailabilityEditor value={form.availability} onChange={(v)=>setForm({...form,availability:v})}/></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-therapist-btn" disabled={saving} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white">{saving ? "Saving…" : "Save therapist"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!calendarTherapist} onOpenChange={(o) => !o && setCalendarTherapist(null)}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto bg-white" data-testid="therapist-calendar-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>
              Sessions · {calendarTherapist?.name || ""}
            </DialogTitle>
          </DialogHeader>
          {calendarTherapist && (
            <TherapistSessionsCalendar therapistId={calendarTherapist.id} clientLookup={clientLookup} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
