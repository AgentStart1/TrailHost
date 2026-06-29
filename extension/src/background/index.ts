import { apiFetch, getTokens, refreshAccessToken } from "../api/client";

const DEVICE_ID_KEY = "trailhost_device_id";
const BATCH_KEY = "trailhost_pending_batch";
const FLUSH_ALARM = "trailhost_flush";
const WS_RECONNECT_DELAY_MS = 5000;

let ws: WebSocket | null = null;

// ── Device ID ──────────────────────────────────────────────────────────────

async function getDeviceId(): Promise<string> {
  const r = await chrome.storage.local.get(DEVICE_ID_KEY) as Record<string, string>;
  if (r[DEVICE_ID_KEY]) return r[DEVICE_ID_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

// ── Pending batch ──────────────────────────────────────────────────────────

interface PendingEntry {
  url: string;
  title: string;
  visit_time: string;
}

async function enqueuEntry(entry: PendingEntry) {
  const r = await chrome.storage.local.get(BATCH_KEY) as Record<string, PendingEntry[]>;
  const batch: PendingEntry[] = r[BATCH_KEY] ?? [];
  batch.push(entry);
  await chrome.storage.local.set({ [BATCH_KEY]: batch });
}

async function flushBatch() {
  const { accessToken } = await getTokens();
  if (!accessToken) return;

  const r = await chrome.storage.local.get([BATCH_KEY, DEVICE_ID_KEY]) as Record<string, unknown>;
  const batch: PendingEntry[] = (r[BATCH_KEY] as PendingEntry[]) ?? [];
  if (batch.length === 0) return;

  try {
    const deviceId = r[DEVICE_ID_KEY] as string;
    const dnResult = await chrome.storage.local.get("device_name") as Record<string, string>;
    const res = await apiFetch("/api/history/batch", {
      method: "POST",
      body: JSON.stringify({
        device_id: deviceId,
        device_name: dnResult["device_name"] ?? "Browser",
        entries: batch.map((e) => ({
          url: e.url,
          title: e.title,
          visit_time: e.visit_time,
        })),
      }),
    });
    if (res.ok) {
      // Remove only the confirmed-sent entries; keep any added during the request
      const sent = new Set(batch.map((e) => `${e.url}|${e.visit_time}`));
      const after = await chrome.storage.local.get(BATCH_KEY) as Record<string, PendingEntry[]>;
      const remaining = (after[BATCH_KEY] ?? []).filter(
        (e) => !sent.has(`${e.url}|${e.visit_time}`)
      );
      if (remaining.length > 0) {
        await chrome.storage.local.set({ [BATCH_KEY]: remaining });
      } else {
        await chrome.storage.local.remove(BATCH_KEY);
      }
    }
    // On non-ok response, leave batch in storage for next flush
  } catch {
    // Network error: leave batch in storage for next flush
  }
}

// ── WebSocket ──────────────────────────────────────────────────────────────

async function connectWs() {
  let { accessToken } = await getTokens();
  if (!accessToken) return;

  // Refresh the token proactively if it is expired or within 60 s of expiry
  try {
    const exp = JSON.parse(atob(accessToken.split(".")[1])).exp as number;
    if (exp * 1000 - Date.now() < 60_000) {
      const fresh = await refreshAccessToken();
      if (!fresh) return;
      accessToken = fresh;
    }
  } catch {
    // Malformed JWT — proceed with the existing token
  }

  const r = await chrome.storage.local.get("trailhost_base_url") as Record<string, string>;
  const base: string = r["trailhost_base_url"] ?? "";
  if (!base) return;

  const wsUrl = base.replace(/^http/, "ws") + `/api/ws?token=${accessToken}`;
  ws = new WebSocket(wsUrl);

  ws.onmessage = async (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "history_sync") {
        // Notify any open history pages
        chrome.runtime.sendMessage({ type: "history_sync", entries: data.entries })
          .catch(() => {});
      }
    } catch {}
  };

  ws.onclose = () => {
    ws = null;
    setTimeout(connectWs, WS_RECONNECT_DELAY_MS);
  };

  ws.onerror = () => ws?.close();
}

// ── Init sync from existing browser history ────────────────────────────────

async function syncExistingHistory() {
  const items = await chrome.history.search({
    text: "",
    startTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
    maxResults: 500,
  });

  for (const item of items) {
    if (!item.url) continue;
    await enqueuEntry({
      url: item.url,
      title: item.title ?? "",
      visit_time: new Date(item.lastVisitTime ?? Date.now()).toISOString(),
    });
  }
  await flushBatch();
}

// ── Event listeners ────────────────────────────────────────────────────────

chrome.history.onVisited.addListener(async (result) => {
  if (!result.url) return;
  await enqueuEntry({
    url: result.url,
    title: result.title ?? "",
    visit_time: new Date(result.lastVisitTime ?? Date.now()).toISOString(),
  });
});

chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) flushBatch();
});

chrome.runtime.onInstalled.addListener(async () => {
  await getDeviceId();
  // Only sync if already authenticated; auth_changed will trigger sync on first login
  const { accessToken } = await getTokens();
  if (accessToken) {
    await syncExistingHistory();
  }
  await connectWs();
});

chrome.runtime.onStartup.addListener(async () => {
  await connectWs();
  await flushBatch();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "auth_changed") {
    if (msg.loggedIn) {
      connectWs();
      syncExistingHistory();
    } else {
      ws?.close();
    }
  }
});
