import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { getToken } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import { Download } from "lucide-react";

export default function TherapistPortal() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/sessions");
        setSessions(data);
      } catch {}
    })();
  }, []);

  const grouped = sessions.reduce((acc, s) => { (acc[s.date] = acc[s.date] || []).push(s); return acc; }, {});
  const dates = Object.keys(grouped).sort();

  const exportIcs = () => {
    const token = getToken();
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/sessions/export.ics?token=${encodeURIComponent(token || "")}`;
    window.open(url, "_blank");
  };

  return (
    <div>
      <PageHeader
        title="My schedule"
        subtitle={`Upcoming sessions for ${user?.name}`}
        action={
          <Button data-testid="therapist-export-ics" variant="outline" onClick={exportIcs}>
            <Download size={14} className="mr-1.5"/> Export to calendar (.ics)
          </Button>
        }
      />
      <div className="px-10 pb-10 space-y-6">
        {!user?.linked_profile_id && (
          <div className="bg-[#FDF4E7] border border-[#E3C68B] rounded-md p-4 text-sm text-[#7A5B2E]" data-testid="no-profile-warning">
            Your account hasn't been linked to a therapist profile yet. Ask an administrator to link your account.
          </div>
        )}
        {dates.length === 0 && (
          <div className="text-center text-muted-ohana py-10" data-testid="therapist-empty-state">No sessions scheduled.</div>
        )}
        {dates.map(d => (
          <div key={d} className="bg-surface border border-soft rounded-lg card-shadow" data-testid={`t-day-${d}`}>
            <div className="px-6 py-3 border-b border-soft bg-muted-soft">
              <div className="font-medium">{d}</div>
            </div>
            <div className="divide-y divide-[#E3DFD5]">
              {grouped[d].map(s => (
                <div key={s.id} className="px-6 py-4 flex items-center justify-between text-sm" data-testid={`t-session-${s.id}`}>
                  <div>
                    <div className="font-mono">{s.start_time} – {s.end_time}</div>
                    {s.notes && <div className="text-xs text-muted-ohana mt-1">{s.notes}</div>}
                  </div>
                  <div className="flex gap-2">
                    {s.rest_break_required && <span className="text-xs px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60]">Rest break</span>}
                    {s.lunch_break_required && <span className="text-xs px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60]">Lunch</span>}
                    {s.travel_minutes_before > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-[#DCE3E0] text-[#274f38]">{s.travel_minutes_before}m travel</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
