import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { fetchHistory, deleteHistoryEntry, getTokens } from "../api/client";
import type { HistoryEntry } from "../api/client";

const PAGE_SIZE = 50;

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDomain(url: string) {
  try { return new URL(url).hostname; } catch { return url; }
}

function groupByDate(entries: HistoryEntry[]) {
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    const key = new Date(e.visit_time).toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const group = groups.get(key) ?? [];
    group.push(e);
    groups.set(key, group);
  }
  return groups;
}

export function App() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    getTokens().then(({ accessToken }) => setAuthed(!!accessToken));
  }, []);

  useEffect(() => {
    if (!authed) return;
    setEntries([]);
    setOffset(0);
    setHasMore(true);
    loadPage(query, 0, true);
  }, [query, authed]);

  // Listen for real-time sync from background
  useEffect(() => {
    const handler = (msg: { type: string; entries?: HistoryEntry[] }) => {
      if (msg.type === "history_sync" && msg.entries) {
        setEntries((prev) => {
          const ids = new Set(prev.map((e) => e.id));
          const newOnes = msg.entries!.filter((e) => !ids.has(e.id));
          return [...newOnes, ...prev];
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const loadPage = useCallback(async (q: string, off: number, replace = false) => {
    setLoading(true);
    try {
      const data = await fetchHistory(q || undefined, PAGE_SIZE, off);
      setEntries((prev) => replace ? data : [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
      setOffset(off + data.length);
    } catch {
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSearch(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQuery(val), 300);
  }

  async function handleDelete(id: string) {
    await deleteHistoryEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  if (authed === null) return <div class="splash">Loading…</div>;

  if (!authed) {
    return (
      <div class="splash">
        <h2>Not logged in</h2>
        <p>Click the TrailHost extension icon to log in.</p>
      </div>
    );
  }

  const groups = groupByDate(entries);

  return (
    <div class="page">
      <header>
        <h1>TrailHost History</h1>
        <input
          class="search"
          type="search"
          placeholder="Search history…"
          onInput={handleSearch}
        />
      </header>

      <main>
        {entries.length === 0 && !loading && (
          <p class="empty">No history found.</p>
        )}

        {[...groups.entries()].map(([date, items]) => (
          <section key={date}>
            <h2 class="date-header">{date}</h2>
            <ul>
              {items.map((entry) => (
                <li key={entry.id} class="entry">
                  <img
                    class="favicon"
                    src={`https://www.google.com/s2/favicons?domain=${getDomain(entry.url)}&sz=16`}
                    alt=""
                  />
                  <div class="entry-body">
                    <a href={entry.url} class="entry-title" target="_blank" rel="noreferrer">
                      {entry.title || entry.url}
                    </a>
                    <span class="entry-url">{entry.url}</span>
                  </div>
                  <span class="entry-time">{formatDate(entry.visit_time)}</span>
                  <button
                    class="delete-btn"
                    title="Delete"
                    onClick={() => handleDelete(entry.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {hasMore && !loading && (
          <button class="load-more" onClick={() => loadPage(query, offset)}>
            Load more
          </button>
        )}
        {loading && <p class="loading-text">Loading…</p>}
      </main>
    </div>
  );
}
