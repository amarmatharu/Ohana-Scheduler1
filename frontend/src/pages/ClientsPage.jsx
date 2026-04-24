import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import PageHeader from "../components/PageHeader";
import AvailabilityEditor from "../components/AvailabilityEditor";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import { Plus, MapPin, Trash2, Pencil, ShieldCheck } from "lucide-react";

const empty = {
  name: "", email: "", phone: "", date_of_birth: "", age_group: "child",
  gender_preference: "no_preference", skill_required: "intermediate",
  home_address: "", availability: [], weekend_available: false,
  other_services: [], insurance: { plan: "", authorized_hours_per_week: 0, authorization_start: "", authorization_end: "" },
  needed_hours_per_week: 10, notes: "",
};

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/clients");
      setClients(data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(empty); setOpen(true); };
  const openEdit = (c) => {
    setEditing(c);
    setForm({
      ...empty, ...c,
      other_services: c.other_services || [],
      insurance: c.insurance || empty.insurance,
    });
    setOpen(true);
  };

  const toggleService = (svc) => {
    const cur = form.other_services || [];
    const next = cur.includes(svc) ? cur.filter(s=>s!==svc) : [...cur, svc];
    setForm({ ...form, other_services: next });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        needed_hours_per_week: parseFloat(form.needed_hours_per_week) || 0,
        insurance: {
          ...form.insurance,
          authorized_hours_per_week: parseFloat(form.insurance?.authorized_hours_per_week) || 0,
        },
      };
      if (editing) await api.put(`/clients/${editing.id}`, payload);
      else await api.post("/clients", payload);
      toast.success(editing ? "Client updated" : "Client created");
      setOpen(false); load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally { setSaving(false); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    await api.delete(`/clients/${c.id}`);
    toast.success("Client removed"); load();
  };

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Intake records, availability, insurance, and preferences."
        action={
          <Button data-testid="new-client-btn" onClick={openNew} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white">
            <Plus size={16} className="mr-1"/> New client
          </Button>
        }
      />
      <div className="px-10 pb-10">
        <div className="bg-surface border border-soft rounded-lg card-shadow overflow-hidden" data-testid="clients-table">
          <table className="w-full">
            <thead className="bg-muted-soft">
              <tr className="text-left text-xs tracking-[0.18em] uppercase text-muted-ohana">
                <th className="px-6 py-3 font-semibold">Client</th>
                <th className="px-6 py-3 font-semibold">Age group</th>
                <th className="px-6 py-3 font-semibold">Needed / Scheduled</th>
                <th className="px-6 py-3 font-semibold">Insurance</th>
                <th className="px-6 py-3 font-semibold">Location</th>
                <th className="px-6 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DFD5]">
              {clients.map(c => (
                <tr key={c.id} className="text-sm" data-testid={`client-row-${c.id}`}>
                  <td className="px-6 py-4">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-muted-ohana">{c.email || "—"}</div>
                  </td>
                  <td className="px-6 py-4 capitalize">{c.age_group}</td>
                  <td className="px-6 py-4 font-mono text-xs">{c.scheduled_hours_per_week || 0}/{c.needed_hours_per_week} hr</td>
                  <td className="px-6 py-4 text-xs">
                    {c.insurance?.plan ? (
                      <span className="inline-flex items-center gap-1"><ShieldCheck size={12}/> {c.insurance.plan} · {c.insurance.authorized_hours_per_week}hr auth</span>
                    ) : <span className="text-muted-ohana">None</span>}
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-ohana">
                    <span className="inline-flex items-center gap-1"><MapPin size={12}/>{c.home_address?.slice(0,40)}{c.home_address?.length > 40 ? "…" : ""}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button onClick={()=>openEdit(c)} data-testid={`edit-client-${c.id}`} className="p-2 hover:bg-muted-soft rounded-md"><Pencil size={14}/></button>
                    <button onClick={()=>remove(c)} data-testid={`delete-client-${c.id}`} className="p-2 hover:bg-muted-soft rounded-md text-[#B85C5C]"><Trash2 size={14}/></button>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-ohana text-sm">No clients yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto bg-white" data-testid="client-dialog">
          <DialogHeader>
            <DialogTitle style={{fontFamily:'Outfit'}}>{editing ? "Edit client" : "New client intake"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Full name</Label><Input data-testid="c-name" required value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/></div>
              <div><Label>Email</Label><Input data-testid="c-email" type="email" value={form.email || ""} onChange={(e)=>setForm({...form,email:e.target.value})}/></div>
              <div><Label>Phone</Label><Input data-testid="c-phone" value={form.phone || ""} onChange={(e)=>setForm({...form,phone:e.target.value})}/></div>
              <div><Label>Date of birth</Label><Input data-testid="c-dob" type="date" value={form.date_of_birth || ""} onChange={(e)=>setForm({...form,date_of_birth:e.target.value})}/></div>
              <div>
                <Label>Age group</Label>
                <select data-testid="c-age-group" value={form.age_group} onChange={(e)=>setForm({...form,age_group:e.target.value})} className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm">
                  <option value="child">Child</option><option value="adolescent">Adolescent</option>
                  <option value="adult">Adult</option><option value="senior">Senior</option>
                </select>
              </div>
              <div>
                <Label>Gender preference</Label>
                <select data-testid="c-gender-pref" value={form.gender_preference} onChange={(e)=>setForm({...form,gender_preference:e.target.value})} className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm">
                  <option value="no_preference">No preference</option>
                  <option value="female">Female therapist</option>
                  <option value="male">Male therapist</option>
                  <option value="nonbinary">Non-binary therapist</option>
                </select>
              </div>
              <div>
                <Label>Therapist skill required</Label>
                <select data-testid="c-skill-req" value={form.skill_required} onChange={(e)=>setForm({...form,skill_required:e.target.value})} className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm">
                  <option value="entry">Entry-level</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="experienced">Experienced</option>
                </select>
              </div>
              <div><Label>Needed hours / week</Label><Input data-testid="c-needed-hours" type="number" step="0.5" value={form.needed_hours_per_week} onChange={(e)=>setForm({...form,needed_hours_per_week:e.target.value})}/></div>
            </div>
            <div><Label>Home address</Label><Input data-testid="c-address" required value={form.home_address} onChange={(e)=>setForm({...form,home_address:e.target.value})} placeholder="456 Oak Ave, Los Angeles, CA"/></div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input data-testid="c-weekend" type="checkbox" checked={form.weekend_available} onChange={(e)=>setForm({...form,weekend_available:e.target.checked})} className="w-4 h-4"/>
                <span className="text-sm">Weekend availability</span>
              </label>
            </div>

            <div>
              <Label>Other concurrent services</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {["speech","occupational","physical","behavioral"].map(svc => (
                  <button type="button" key={svc} data-testid={`c-svc-${svc}`} onClick={()=>toggleService(svc)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${(form.other_services||[]).includes(svc) ? "bg-[#274f38] border-[#274f38] text-white" : "bg-white border-soft text-[#586960]"}`}>
                    {svc.charAt(0).toUpperCase()+svc.slice(1)} therapy
                  </button>
                ))}
              </div>
            </div>

            <div><Label>Weekly availability</Label><AvailabilityEditor value={form.availability} onChange={(v)=>setForm({...form,availability:v})}/></div>

            <div className="border border-soft rounded-md p-4 bg-muted-soft space-y-3">
              <div className="text-sm font-medium flex items-center gap-2"><ShieldCheck size={14}/> Insurance authorization</div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Plan</Label><Input data-testid="c-ins-plan" value={form.insurance?.plan || ""} onChange={(e)=>setForm({...form,insurance:{...form.insurance,plan:e.target.value}})}/></div>
                <div><Label>Authorized hrs/week</Label><Input data-testid="c-ins-hours" type="number" step="0.5" value={form.insurance?.authorized_hours_per_week || 0} onChange={(e)=>setForm({...form,insurance:{...form.insurance,authorized_hours_per_week:e.target.value}})}/></div>
                <div><Label>Auth start</Label><Input data-testid="c-ins-start" type="date" value={form.insurance?.authorization_start || ""} onChange={(e)=>setForm({...form,insurance:{...form.insurance,authorization_start:e.target.value}})}/></div>
                <div><Label>Auth end</Label><Input data-testid="c-ins-end" type="date" value={form.insurance?.authorization_end || ""} onChange={(e)=>setForm({...form,insurance:{...form.insurance,authorization_end:e.target.value}})}/></div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={()=>setOpen(false)}>Cancel</Button>
              <Button type="submit" data-testid="save-client-btn" disabled={saving} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white">{saving ? "Saving…" : "Save client"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
