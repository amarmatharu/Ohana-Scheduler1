import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatApiError, getToken, setToken } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null=loading, false=unauth, object=user
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(false);
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setToken(null);
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
      const noResponse = !e.response;
      const networkish =
        noResponse &&
        (e.message === "Network Error" || e.code === "ERR_NETWORK" || e.code === "ECONNABORTED");
      const fallback =
        networkish &&
        "Cannot reach the API. Start the backend on port 8001 and run the app from frontend/ (dev proxy).";
      return {
        ok: false,
        error: formatApiError(e.response?.data?.detail) || fallback || e.message,
      };
    }
  };

  const register = async (payload) => {
    try {
      const { data } = await api.post("/auth/register", payload);
      setUser(data);
      return { ok: true, user: data };
    } catch (e) {
      const noResponse = !e.response;
      const networkish =
        noResponse &&
        (e.message === "Network Error" || e.code === "ERR_NETWORK" || e.code === "ECONNABORTED");
      const fallback =
        networkish &&
        "Cannot reach the API. Start the backend on port 8001 and run the app from frontend/ (dev proxy).";
      return {
        ok: false,
        error: formatApiError(e.response?.data?.detail) || fallback || e.message,
      };
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    setToken(null);
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
