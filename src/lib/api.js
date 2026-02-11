import { auth } from "../firebase";

const BASE = import.meta.env.VITE_API_BASE_URL;

export async function apiFetch(path, { method = "GET", body, headers } = {}) {
  if (!BASE) throw new Error("VITE_API_BASE_URL não configurado.");

  const u = auth.currentUser;
  const token = u ? await u.getIdToken() : null;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}
