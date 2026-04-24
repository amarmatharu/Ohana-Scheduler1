import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { Users, UserCog, CalendarClock, AlertCircle, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

function Stat({ icon: Icon, label, value, accent, testId }) {
  return (
    <div data-testid={testId} className="bg-surface border border-soft rounded-lg p-6 card-shadow transition-all hover:shadow-[0_12px_32px_rgba(24,35,30,0.06)] hover:-translate-y-0.5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs tracking-[0.18em] uppercase text-muted-ohana font-semibold">{label}</div>
          <div className="mt-3 text-4xl font-medium tracking-tight" style={{fontFamily:'Outfit'}}>{value}</div>
        </div>
        <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{backgroundColor: accent}}>
          <Icon size={20} strokeWidth={1.6} className="text-[#274f38]" />
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({ therapists: 0, clients: 0, upcoming_sessions: 0, unassigned_clients: 0 });
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [s, sess] = await Promise.all([
          api.get("/dashboard/stats"),
          api.get("/sessions"),
        ]);
        setStats(s.data);
        setSessions(sess.data.slice(0, 8));
      } catch {}
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Operational overview of your clinical scheduling."
      />
      <div className="px-10 pb-10 space-y-8">
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Stat icon={Users} label="Active clients" value={stats.clients} accent="#E5EBE8" testId="stat-clients" />
          <Stat icon={UserCog} label="Therapists" value={stats.therapists} accent="#DCE3E0" testId="stat-therapists" />
          <Stat icon={CalendarClock} label="Upcoming sessions" value={stats.upcoming_sessions} accent="#F0EFEA" testId="stat-upcoming" />
          <Stat icon={AlertCircle} label="Unassigned clients" value={stats.unassigned_clients} accent="#FDF4E7" testId="stat-unassigned" />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-surface border border-soft rounded-lg card-shadow">
            <div className="flex items-center justify-between px-6 py-4 border-b border-soft">
              <h3 className="text-lg font-medium" style={{fontFamily:'Outfit'}}>Upcoming sessions</h3>
              <Link to="/admin/schedule" className="text-sm text-[#274f38] hover:text-[#1E3D2B] inline-flex items-center gap-1" data-testid="view-schedule-link">
                View schedule <ArrowUpRight size={14}/>
              </Link>
            </div>
            <div className="divide-y divide-[#E3DFD5]">
              {sessions.length === 0 && (
                <div className="p-8 text-center text-muted-ohana text-sm">No sessions scheduled yet.</div>
              )}
              {sessions.map((s) => (
                <div key={s.id} className="px-6 py-3 flex items-center justify-between" data-testid={`session-row-${s.id}`}>
                  <div>
                    <div className="font-medium text-sm">{s.date}</div>
                    <div className="font-mono text-xs text-muted-ohana mt-0.5">{s.start_time} – {s.end_time}</div>
                  </div>
                  <div className="flex gap-2">
                    {s.rest_break_required && <span className="text-xs px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60]">Rest break</span>}
                    {s.lunch_break_required && <span className="text-xs px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60]">Lunch break</span>}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8F0EA] text-[#274f38] capitalize">{s.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface border border-soft rounded-lg p-6 card-shadow">
            <h3 className="text-lg font-medium mb-1" style={{fontFamily:'Outfit'}}>Quick actions</h3>
            <p className="text-sm text-muted-ohana mb-5">Jump to common workflows.</p>
            <div className="space-y-2">
              <Link to="/admin/clients" className="block px-4 py-3 rounded-md border border-soft hover:border-[#274f38] transition-colors" data-testid="action-add-client">
                <div className="text-sm font-medium">Add a client</div>
                <div className="text-xs text-muted-ohana">Create intake with availability, insurance, and preferences.</div>
              </Link>
              <Link to="/admin/therapists" className="block px-4 py-3 rounded-md border border-soft hover:border-[#274f38] transition-colors" data-testid="action-add-therapist">
                <div className="text-sm font-medium">Add a therapist</div>
                <div className="text-xs text-muted-ohana">Capture skills, availability, and home address.</div>
              </Link>
              <Link to="/admin/matching" className="block px-4 py-3 rounded-md border border-soft hover:border-[#274f38] transition-colors" data-testid="action-matching">
                <div className="text-sm font-medium">Run matching</div>
                <div className="text-xs text-muted-ohana">Get prioritized therapist candidates for a client.</div>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
