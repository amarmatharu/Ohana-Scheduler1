import React from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard, Users, UserCog, GitMerge, CalendarClock,
  ShieldCheck, LogOut, CalendarDays, Stethoscope, Map as MapIcon
} from "lucide-react";

const navByRole = {
  admin: [
    { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/admin/clients", label: "Clients", icon: Users },
    { to: "/admin/therapists", label: "Therapists", icon: UserCog },
    { to: "/admin/matching", label: "Matching", icon: GitMerge },
    { to: "/admin/schedule", label: "Schedule", icon: CalendarClock },
    { to: "/admin/map", label: "Map", icon: MapIcon },
    { to: "/admin/insurance", label: "Insurance", icon: ShieldCheck },
  ],
  therapist: [
    { to: "/therapist", label: "My Schedule", icon: CalendarDays, end: true },
  ],
  client: [
    { to: "/client", label: "My Appointments", icon: Stethoscope, end: true },
  ],
};

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const items = navByRole[user?.role] || [];

  return (
    <div className="min-h-screen bg-base flex" data-testid="app-layout">
      <aside className="w-64 bg-surface border-r border-soft flex flex-col" data-testid="sidebar">
        <div className="px-6 py-6 border-b border-soft">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary-ohana flex items-center justify-center">
              <span className="text-white font-semibold text-lg">O</span>
            </div>
            <div>
              <div className="font-semibold text-[17px] tracking-tight" style={{fontFamily:'Outfit'}}>Ohana</div>
              <div className="text-xs text-muted-ohana -mt-0.5">Scheduler</div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              data-testid={`nav-${it.label.toLowerCase().replace(/\s/g, "-")}`}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-[#E5EBE8] text-[#274f38] font-medium"
                    : "text-[#586960] hover:bg-[#F0EFEA]"
                }`
              }
            >
              <it.icon size={18} strokeWidth={1.6} />
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-soft">
          <div className="px-3 py-2 mb-2">
            <div className="text-sm font-medium text-[#18231E]" data-testid="current-user-name">{user?.name}</div>
            <div className="text-xs text-muted-ohana capitalize">{user?.role}</div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={async () => { await logout(); navigate("/login"); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-[#B85C5C] hover:bg-[#F0EFEA] transition-colors"
          >
            <LogOut size={18} strokeWidth={1.6} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden">
        <Outlet />
      </main>
    </div>
  );
}
