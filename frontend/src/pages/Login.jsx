import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { toast } from "sonner";

const roleRedirect = { admin: "/admin", therapist: "/therapist", client: "/client" };

export default function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "client" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (user) return <Navigate to={roleRedirect[user.role] || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const fn = tab === "login" ? login(form.email, form.password) : register(form);
    const res = await fn;
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    toast.success(`Welcome, ${res.user.name}`);
    navigate(roleRedirect[res.user.role] || "/");
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-base">
      <div className="hidden md:block relative overflow-hidden">
        <div className="absolute inset-0 bg-primary-ohana"></div>
        <img
          alt="Clinical workspace"
          src="https://images.pexels.com/photos/7789604/pexels-photo-7789604.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=1080&w=900"
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity"
        />
        <div className="relative z-10 h-full flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-white/15 backdrop-blur-sm flex items-center justify-center">
              <span className="font-semibold text-xl">O</span>
            </div>
            <div>
              <div className="text-lg font-semibold" style={{fontFamily:'Outfit'}}>Ohana Scheduler</div>
              <div className="text-xs text-white/70 -mt-0.5">Clinical staff matching platform</div>
            </div>
          </div>
          <div className="space-y-4 max-w-md">
            <p className="text-xs tracking-[0.2em] uppercase text-white/60">A calmer clinical workflow</p>
            <h1 className="text-4xl md:text-5xl font-medium leading-tight tracking-tight" style={{fontFamily:'Outfit'}}>
              Match care teams to clients with clinical precision.
            </h1>
            <p className="text-white/80 leading-relaxed">
              Proximity, skill, capacity, and existing relationships — all scored in seconds.
              Enforce mandatory rest breaks, lunch windows, and travel buffers automatically.
            </p>
          </div>
          <div className="text-xs text-white/60">HIPAA-conscious · Role-based access · Audit-logged</div>
        </div>
      </div>

      <div className="flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <h2 className="text-3xl font-medium tracking-tight mb-1" style={{fontFamily:'Outfit'}}>Welcome back</h2>
          <p className="text-muted-ohana text-sm mb-8">Sign in to your Ohana Scheduler workspace.</p>

          <Tabs value={tab} onValueChange={setTab} data-testid="auth-tabs">
            <TabsList className="grid grid-cols-2 mb-6 bg-muted-soft">
              <TabsTrigger value="login" data-testid="tab-login">Sign in</TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">Create account</TabsTrigger>
            </TabsList>

            <form onSubmit={submit} className="space-y-4">
              {tab === "register" && (
                <>
                  <div>
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      data-testid="register-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label>Role</Label>
                    <select
                      data-testid="register-role"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                      className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm focus:outline-none focus:ring-1 focus:ring-[#274f38]"
                    >
                      <option value="client">Client</option>
                      <option value="therapist">Therapist</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  data-testid={`${tab}-email`}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid={`${tab}-password`}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={8}
                />
              </div>

              {error && (
                <div data-testid="auth-error" className="text-sm text-[#B85C5C] bg-[#FCEBEB] border border-[#F4D6D6] rounded-md p-3">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                data-testid={`${tab}-submit`}
                className="w-full bg-primary-ohana hover:bg-[#1E3D2B] text-white"
              >
                {loading ? "Please wait…" : tab === "login" ? "Sign in" : "Create account"}
              </Button>

              {tab === "login" && (
                <p className="text-xs text-muted-ohana text-center pt-2">
                  Default admin: <span className="font-mono">admin@ohana.health</span>
                </p>
              )}
            </form>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
