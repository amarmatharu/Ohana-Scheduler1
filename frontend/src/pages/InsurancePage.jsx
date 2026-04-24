import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { ShieldCheck, AlertTriangle } from "lucide-react";

export default function InsurancePage() {
  const [clients, setClients] = useState([]);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/clients");
      setClients(data);
    })();
  }, []);

  return (
    <div>
      <PageHeader
        title="Insurance authorization"
        subtitle="Track authorized hours vs scheduled hours per client."
      />
      <div className="px-10 pb-10">
        <div className="bg-surface border border-soft rounded-lg card-shadow overflow-hidden" data-testid="insurance-table">
          <table className="w-full">
            <thead className="bg-muted-soft">
              <tr className="text-left text-xs tracking-[0.18em] uppercase text-muted-ohana">
                <th className="px-6 py-3 font-semibold">Client</th>
                <th className="px-6 py-3 font-semibold">Plan</th>
                <th className="px-6 py-3 font-semibold">Authorized</th>
                <th className="px-6 py-3 font-semibold">Scheduled</th>
                <th className="px-6 py-3 font-semibold">Utilization</th>
                <th className="px-6 py-3 font-semibold">Auth window</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DFD5]">
              {clients.map(c => {
                const auth = c.insurance?.authorized_hours_per_week || 0;
                const sched = c.scheduled_hours_per_week || 0;
                const pct = auth > 0 ? Math.round((sched/auth)*100) : 0;
                const over = pct > 100;
                return (
                  <tr key={c.id} data-testid={`ins-row-${c.id}`} className="text-sm">
                    <td className="px-6 py-4 font-medium">{c.name}</td>
                    <td className="px-6 py-4">
                      {c.insurance?.plan ? (
                        <span className="inline-flex items-center gap-1"><ShieldCheck size={14}/>{c.insurance.plan}</span>
                      ) : <span className="text-muted-ohana">None</span>}
                    </td>
                    <td className="px-6 py-4 font-mono">{auth} hr/wk</td>
                    <td className="px-6 py-4 font-mono">{sched} hr/wk</td>
                    <td className="px-6 py-4 w-64">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-[#F0EFEA] rounded-full overflow-hidden">
                          <div style={{width:`${Math.min(100,pct)}%`, backgroundColor: over ? "#B85C5C" : "#274f38"}} className="h-full"/>
                        </div>
                        <span className="text-xs font-mono w-12 text-right">{pct}%</span>
                        {over && <AlertTriangle size={14} className="text-[#B85C5C]"/>}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-ohana font-mono">
                      {c.insurance?.authorization_start || "—"} → {c.insurance?.authorization_end || "—"}
                    </td>
                  </tr>
                );
              })}
              {clients.length === 0 && (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-muted-ohana">No clients with insurance data yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
