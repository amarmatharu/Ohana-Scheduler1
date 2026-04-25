import React, { useEffect, useState, useMemo } from "react";
import { api, formatApiError } from "../lib/api";
import PageHeader from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { toast } from "sonner";
import { Link2, Link2Off, Users as UsersIcon, Search, UserPlus, Trash2 } from "lucide-react";

const ROLE_BADGE = {
  admin: "bg-[#274f38] text-white",
  therapist: "bg-[#E5EBE8] text-[#274f38]",
  client: "bg-[#FDF4E7] text-[#B07C60]",
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [therapists, setTherapists] = useState([]);
  const [clients, setClients] = useState([]);
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState({}); // user_id -> selected profile_id
  const [savingId, setSavingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", password: "", name: "", role: "therapist", linked_profile_id: "" });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const [u, t, c] = await Promise.all([
        api.get("/users"),
        api.get("/therapists"),
        api.get("/clients"),
      ]);
      setUsers(u.data);
      setTherapists(t.data);
      setClients(c.data);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    }
  };

  useEffect(() => { load(); }, []);

  const profilesByRole = { therapist: therapists, client: clients };
  const profileNameById = useMemo(() => {
    const m = {};
    therapists.forEach(t => m[t.id] = t.name);
    clients.forEach(c => m[c.id] = c.name);
    return m;
  }, [therapists, clients]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.role.includes(q)
    );
  }, [users, filter]);

  const linkUser = async (user, profileId) => {
    setSavingId(user.id);
    try {
      const profile_type = user.role === "therapist" ? "therapist" : "client";
      await api.post(`/users/${user.id}/link-profile`, {
        profile_id: profileId || null,
        profile_type: profileId ? profile_type : null,
      });
      toast.success(profileId ? "Profile linked" : "Profile unlinked");
      setDrafts({ ...drafts, [user.id]: undefined });
      await load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const openCreate = () => {
    setCreateForm({ email: "", password: "", name: "", role: "therapist", linked_profile_id: "" });
    setCreateOpen(true);
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const payload = {
        email: createForm.email,
        password: createForm.password,
        name: createForm.name,
        role: createForm.role,
        linked_profile_id: createForm.linked_profile_id || null,
      };
      await api.post("/users", payload);
      toast.success(`Account created for ${createForm.email}`);
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setCreating(false);
    }
  };

  const availableProfiles = createForm.role === "therapist" ? therapists : createForm.role === "client" ? clients : [];

  return (
    <div>
      <PageHeader
        title="Users & profile links"
        subtitle="Connect login accounts to therapist or client records so they can sign in and see their schedule."
        action={
          <Button data-testid="new-user-btn" onClick={openCreate} className="bg-primary-ohana hover:bg-[#1E3D2B] text-white">
            <UserPlus size={16} className="mr-1.5" /> Create user account
          </Button>
        }
      />
      <div className="px-10 pb-10 space-y-4">
        <div className="bg-surface border border-soft rounded-lg p-4 card-shadow flex items-center gap-3">
          <Search size={16} className="text-muted-ohana" />
          <Input
            data-testid="users-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, email, or role…"
            className="border-0 focus-visible:ring-0 px-0"
          />
          <span className="text-xs text-muted-ohana font-mono whitespace-nowrap">
            {filtered.length} / {users.length} users
          </span>
        </div>

        <div className="bg-surface border border-soft rounded-lg card-shadow overflow-hidden" data-testid="users-table">
          <table className="w-full">
            <thead className="bg-muted-soft">
              <tr className="text-left text-xs tracking-[0.18em] uppercase text-muted-ohana">
                <th className="px-6 py-3 font-semibold">User</th>
                <th className="px-6 py-3 font-semibold">Role</th>
                <th className="px-6 py-3 font-semibold">Linked profile</th>
                <th className="px-6 py-3 font-semibold w-[420px]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3DFD5]">
              {filtered.map((u) => {
                const linkable = u.role === "therapist" || u.role === "client";
                const draft = drafts[u.id];
                const profiles = linkable ? profilesByRole[u.role] : [];
                const linkedName = u.linked_profile_id ? profileNameById[u.linked_profile_id] : null;
                return (
                  <tr key={u.id} data-testid={`user-row-${u.id}`} className="text-sm">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#E5EBE8] text-[#274f38] flex items-center justify-center text-xs font-medium">
                          {u.name.split(" ").map(p => p[0]).slice(0, 2).join("")}
                        </div>
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted-ohana font-mono">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${ROLE_BADGE[u.role] || "bg-muted-soft"}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {linkedName ? (
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <Link2 size={13} className="text-[#274f38]" /> {linkedName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-ohana">
                          <Link2Off size={13} /> Not linked
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {!linkable ? (
                        <span className="text-xs text-muted-ohana">Admins don't need a linked profile.</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            data-testid={`profile-select-${u.id}`}
                            value={draft ?? u.linked_profile_id ?? ""}
                            onChange={(e) => setDrafts({ ...drafts, [u.id]: e.target.value })}
                            className="flex-1 h-9 px-3 rounded-md border border-soft bg-white text-sm"
                          >
                            <option value="">— select {u.role} profile —</option>
                            {profiles.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          {(draft !== undefined && draft !== (u.linked_profile_id || "")) && (
                            <Button
                              size="sm"
                              data-testid={`link-btn-${u.id}`}
                              onClick={() => linkUser(u, draft)}
                              disabled={savingId === u.id}
                              className="bg-primary-ohana hover:bg-[#1E3D2B] text-white"
                            >
                              {savingId === u.id ? "Saving…" : (draft ? "Link" : "Unlink")}
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-ohana">
                    <UsersIcon size={28} className="mx-auto mb-2 text-[#A1ACA6]" />
                    No users match your filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-ohana">
          When a therapist or client signs in, the platform fetches sessions tied to their <span className="font-mono">linked_profile_id</span>.
          Until you link them, their portal will show an empty schedule with an onboarding notice.
        </p>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md bg-white" data-testid="create-user-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>Create user account</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitCreate} className="space-y-4 pt-2">
            <div>
              <Label>Full name</Label>
              <Input
                data-testid="create-user-name"
                required
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                data-testid="create-user-email"
                type="email"
                required
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </div>
            <div>
              <Label>Temporary password</Label>
              <Input
                data-testid="create-user-password"
                type="text"
                required
                minLength={8}
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                placeholder="At least 8 characters"
              />
              <p className="text-xs text-muted-ohana mt-1">Share this securely with the user. They can change it after signing in.</p>
            </div>
            <div>
              <Label>Role</Label>
              <select
                data-testid="create-user-role"
                value={createForm.role}
                onChange={(e) => setCreateForm({ ...createForm, role: e.target.value, linked_profile_id: "" })}
                className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm"
              >
                <option value="therapist">Therapist</option>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {createForm.role !== "admin" && (
              <div>
                <Label>Link to {createForm.role} profile (optional)</Label>
                <select
                  data-testid="create-user-profile"
                  value={createForm.linked_profile_id}
                  onChange={(e) => setCreateForm({ ...createForm, linked_profile_id: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm"
                >
                  <option value="">— skip for now —</option>
                  {availableProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <p className="text-xs text-muted-ohana mt-1">
                  {availableProfiles.length === 0
                    ? `No ${createForm.role} profiles yet — create one in ${createForm.role === "therapist" ? "Therapists" : "Clients"} first.`
                    : "Auto-links the new account to the selected profile so the portal works immediately."}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                data-testid="submit-create-user"
                disabled={creating}
                className="bg-primary-ohana hover:bg-[#1E3D2B] text-white"
              >
                {creating ? "Creating…" : "Create account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
