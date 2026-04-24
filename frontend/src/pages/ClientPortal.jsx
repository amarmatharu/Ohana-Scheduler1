import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { useAuth } from "../context/AuthContext";

export default function ClientPortal() {
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

  return (
    <div>
      <PageHeader title="My appointments" subtitle={`Welcome, ${user?.name}`} />
      <div className="px-10 pb-10 space-y-4">
        {!user?.linked_profile_id && (
          <div className="bg-[#FDF4E7] border border-[#E3C68B] rounded-md p-4 text-sm text-[#7A5B2E]" data-testid="no-profile-warning">
            Your account hasn't been linked to a client record yet. An administrator will complete this shortly.
          </div>
        )}
        {sessions.length === 0 && (
          <div className="text-center text-muted-ohana py-10" data-testid="client-empty-state">No appointments scheduled.</div>
        )}
        {sessions.map(s => (
          <div key={s.id} data-testid={`c-session-${s.id}`} className="bg-surface border border-soft rounded-lg p-5 card-shadow flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-ohana">{s.date}</div>
              <div className="font-mono mt-1">{s.start_time} – {s.end_time}</div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#E8F0EA] text-[#274f38] capitalize">{s.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
