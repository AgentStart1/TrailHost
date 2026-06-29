const BASE_URL_KEY = "trailhost_base_url";
const ACCESS_TOKEN_KEY = "trailhost_access_token";
const REFRESH_TOKEN_KEY = "trailhost_refresh_token";

export async function getBaseUrl(): Promise<string> {
  const r = await chrome.storage.local.get(BASE_URL_KEY);
  return (r[BASE_URL_KEY] as string) ?? "";
}

export async function setBaseUrl(url: string): Promise<void> {
  await chrome.storage.local.set({ [BASE_URL_KEY]: url.replace(/\/$/, "") });
}

export async function getTokens() {
  const r = await chrome.storage.local.get([
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
  ]);
  return {
    accessToken: r[ACCESS_TOKEN_KEY] as string | undefined,
    refreshToken: r[REFRESH_TOKEN_KEY] as string | undefined,
  };
}

export async function saveTokens(accessToken: string, refreshToken: string) {
  await chrome.storage.local.set({
    [ACCESS_TOKEN_KEY]: accessToken,
    [REFRESH_TOKEN_KEY]: refreshToken,
  });
}

export async function clearTokens() {
  await chrome.storage.local.remove([ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]);
}

export async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return null;
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  await saveTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const base = await getBaseUrl();
  let { accessToken } = await getTokens();

  const doFetch = (token: string) =>
    fetch(`${base}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });

  if (!accessToken) throw new Error("not authenticated");

  let res = await doFetch(accessToken);
  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) throw new Error("session expired");
    res = await doFetch(newToken);
  }
  return res;
}

export interface AuthResult {
  access_token: string;
  refresh_token: string;
  user_id: string;
}

export async function register(
  email: string,
  password: string
): Promise<AuthResult> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(res.status === 409 ? "Email already registered" : text);
  }
  return res.json();
}

export async function login(
  email: string,
  password: string
): Promise<AuthResult> {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  return res.json();
}

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  visit_time: string;
  device_id: string;
}

export async function fetchHistory(
  q?: string,
  limit = 50,
  offset = 0
): Promise<HistoryEntry[]> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (q) params.set("q", q);
  const res = await apiFetch(`/api/history?${params}`);
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const res = await apiFetch(`/api/history/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete entry");
}
