import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const TOKEN_KEY = "ohana_access_token";

export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export const api = axios.create({
  baseURL: API,
});

// Inject Bearer token on every request
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Capture X-Access-Token from auth responses (login/register)
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
