import React, { useEffect, useState } from "react";
import { api, formatApiError } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { GitMerge, MapPin, Clock, Award, Users, Heart } from "lucide-react";

function Bar({ value, color }) {
  return (
    <div className="w-full h-1.5 bg-[#F0EFEA] rounded-full overflow-hidden">
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} className="h-full transition-all" />
    </div>
  );
}

export default function MatchingPage() {
  const [clients, setClients] = useState([]);
  const [selected, setSelected] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [clientDetail, setClientDetail] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/clients");
      setClients(data);
    })();
  }, []);

  const run = async () => {
    if (!selected) { toast.error("Select a client first"); return; }
    setLoading(true);
    try {
      const c = clients.find(x => x.id === selected);
      setClientDetail(c);
      const { data } = await api.post("/match", { client_id: selected, max_results: 10 });
      setResults(data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally { setLoading(false); }
  };

  const assign = async (t) => {
    const startDate = window.prompt("Schedule first session — date (YYYY-MM-DD):", new Date().toISOString().slice(0,10));
    if (!startDate) return;
    const startTime = window.prompt("Start time (HH:MM):", "15:00");
    const endTime = window.prompt("End time (HH:MM):", "17:00");
    if (!startTime || !endTime) return;
    try {
      await api.post("/sessions", {
        therapist_id: t.therapist_id,
        client_id: selected,
        date: startDate,
        start_time: startTime,
        end_time: endTime,
      });
      toast.success(`Assigned ${t.therapist_name}`);
    } catch (e) {
      const d = e.response?.data?.detail;
      const msg = typeof d === "object" && d?.errors ? d.errors.join(" ") : formatApiError(d);
      toast.error(msg);
    }
  };

  return (
    <div>
      <PageHeader
        title="Matching engine"
        subtitle="Prioritized therapist candidates by proximity, skill, capacity, and existing relationships."
      />
      <div className="px-10 pb-10 space-y-6">
        <div className="bg-surface border border-soft rounded-lg p-6 card-shadow flex items-end gap-4">
          <div className="flex-1">
            <label className="text-xs tracking-[0.18em] uppercase text-muted-ohana font-semibold">Select client</label>
            <select
              data-testid="match-client-select"
              value={selected}
              onChange={(e)=>setSelected(e.target.value)}
              className="mt-2 w-full h-11 px-4 rounded-md border border-soft bg-white text-sm"
            >
              <option value="">— choose a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name} · {c.age_group} · {c.needed_hours_per_week}hr/wk</option>)}
            </select>
          </div>
          <Button data-testid="run-match-btn" onClick={run} disabled={loading || !selected} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white h-11 px-6">
            <GitMerge size={16} className="mr-2"/> {loading ? "Matching…" : "Run matching"}
          </Button>
        </div>

        {clientDetail && (
          <div className="bg-[#E5EBE8] border border-soft rounded-lg p-5 flex flex-wrap gap-6 text-sm" data-testid="match-client-summary">
            <div><span className="text-muted-ohana">Client:</span> <span className="font-medium">{clientDetail.name}</span></div>
            <div><span className="text-muted-ohana">Needs:</span> <span className="font-mono">{clientDetail.needed_hours_per_week} hr/wk</span></div>
            <div><span className="text-muted-ohana">Skill required:</span> <span className="capitalize">{clientDetail.skill_required}</span></div>
            <div><span className="text-muted-ohana">Gender preference:</span> <span className="capitalize">{(clientDetail.gender_preference||"").replace("_"," ")}</span></div>
            <div className="inline-flex items-center gap-1"><MapPin size={13}/> {clientDetail.home_address}</div>
          </div>
        )}

        <div className="space-y-3">
          {results.map((r, idx) => (
            <div key={r.therapist_id} data-testid={`match-result-${idx}`} className="bg-surface border border-soft rounded-lg p-6 card-shadow hover:shadow-[0_12px_32px_rgba(24,35,30,0.06)] transition-all">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#E5EBE8] text-[#274f38] flex items-center justify-center font-semibold text-sm">#{idx+1}</div>
                    <div>
                      <div className="text-lg font-medium" style={{fontFamily:'Outfit'}}>{r.therapist_name}</div>
                      <div className="text-xs text-muted-ohana capitalize">{r.skill_level} · {r.available_hours} hrs available</div>
                    </div>
                    {r.relationship_boost > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60]">
                        <Heart size={12}/> Existing relationship
                      </span>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="flex items-center gap-1 text-xs text-muted-ohana mb-1"><MapPin size={12}/> Proximity</div>
                      <Bar value={r.proximity_score} color="#274f38"/>
                      <div className="text-[11px] font-mono text-muted-ohana mt-1">
                        {r.drive_minutes !== null ? `${r.drive_minutes} min · ${r.distance_km} km` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-xs text-muted-ohana mb-1"><Award size={12}/> Skill</div>
                      <Bar value={r.skill_score} color="#7B968B"/>
                      <div className="text-[11px] font-mono text-muted-ohana mt-1">{r.skill_score.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-xs text-muted-ohana mb-1"><Users size={12}/> Capacity</div>
                      <Bar value={r.capacity_score} color="#B07C60"/>
                      <div className="text-[11px] font-mono text-muted-ohana mt-1">{r.capacity_score.toFixed(0)}</div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1 text-xs text-muted-ohana mb-1"><Heart size={12}/> Gender fit</div>
                      <Bar value={r.gender_score} color="#477A5E"/>
                      <div className="text-[11px] font-mono text-muted-ohana mt-1">{r.gender_score.toFixed(0)}</div>
                    </div>
                  </div>

                  {r.reasons.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {r.reasons.map(rs => (
                        <span key={rs} className="text-[11px] px-2 py-0.5 rounded-full bg-[#F0EFEA] text-[#586960]">{rs}</span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <div className="text-[11px] tracking-[0.18em] uppercase text-muted-ohana font-semibold">Total score</div>
                  <div className="text-4xl font-medium mt-1 text-[#274f38]" style={{fontFamily:'Outfit'}}>{r.total_score.toFixed(0)}</div>
                  <Button data-testid={`assign-therapist-${idx}`} onClick={()=>assign(r)} className="mt-3 bg-primary-ohana hover:bg-[#1E3D2B] text-white">
                    Schedule first session
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {!loading && results.length === 0 && selected && (
            <div className="text-center text-muted-ohana py-10 text-sm">Run matching to see candidates.</div>
          )}
        </div>
      </div>
    </div>
  );
}
