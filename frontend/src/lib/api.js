import axios from "axios";

function resolveBackendUrl() {
  const raw = process.env.REACT_APP_BACKEND_URL;
  const explicit = raw != null && String(raw).trim() !== "";

  if (process.env.NODE_ENV === "development") {
    // Always use same-origin /api + package.json "proxy" unless you explicitly
    // opt into a direct API URL (avoids CORS when .env.local still points at :8001).
    const direct =
      process.env.REACT_APP_BACKEND_DIRECT === "true" ||
      process.env.REACT_APP_BACKEND_DIRECT === "1";
    if (!direct) return "";
    if (!explicit) return "";
    return String(raw).trim().replace(/\/$/, "");
  }

  if (explicit) return String(raw).trim().replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

export const BACKEND_URL = resolveBackendUrl();
export const API = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

/** Absolute origin for window.open (e.g. .ics); matches SPA origin when using dev proxy. */
export function backendOrigin() {
  if (BACKEND_URL) return BACKEND_URL;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "";
}

const TOKEN_KEY = "ohana_access_token";
const CSRF_COOKIE = "csrf_token";
const UNSAFE_METHODS = new Set(["post", "put", "patch", "delete"]);

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export const api = axios.create({
  baseURL: API,
  // Required so the browser sends the httpOnly auth cookies cross-origin.
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  config.headers = config.headers || {};
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Double-submit CSRF: echo the non-httpOnly csrf_token cookie as a header on
  // any state-changing call. Backend middleware constant-time compares them.
  const method = (config.method || "get").toLowerCase();
  if (UNSAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) config.headers["X-CSRF-Token"] = csrf;
  }
  return config;
});

api.interceptors.response.use((res) => {
  const newToken = res.headers?.["x-access-token"];
  if (newToken) setToken(newToken);
  return res;
});

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e?.msg ? e.msg : JSON.stringify(e))).join(" ");
  if (detail?.errors) return detail.errors.join(" ");
  if (detail?.msg) return detail.msg;
  return JSON.stringify(detail);
}
