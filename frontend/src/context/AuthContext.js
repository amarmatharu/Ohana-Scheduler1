import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatApiError } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null while loading, false if unauth
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
      return { ok: true, user: data };
    } catch (e) {
      return { ok: false, error: formatApiError(e.response?.data?.detail) || e.message };
    }
  };

  const register = async (payload) => {
    try {
      const { data } = await api.post("/auth/register", payload);
      setUser(data);
      return { ok: true, user: data };
    } catch (e) {
      return { ok: false, error: formatApiError(e.response?.data?.detail) || e.message };
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
