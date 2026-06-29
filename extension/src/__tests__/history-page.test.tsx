import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "../history-page/App";

vi.mock("../api/client", () => ({
  getTokens: vi.fn(),
  fetchHistory: vi.fn(),
  deleteHistoryEntry: vi.fn().mockResolvedValue(undefined),
}));

import { getTokens, fetchHistory, deleteHistoryEntry } from "../api/client";

const SAMPLE_ENTRIES = [
  {
    id: "id-1",
    url: "https://rust-lang.org",
    title: "Rust Language",
    visit_time: "2024-01-02T10:00:00Z",
    device_id: "dev-1",
  },
  {
    id: "id-2",
    url: "https://python.org",
    title: "Python",
    visit_time: "2024-01-01T09:00:00Z",
    device_id: "dev-1",
  },
];

describe("History Page", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "valid-token",
      refreshToken: "ref",
    });
    vi.mocked(fetchHistory).mockResolvedValue(SAMPLE_ENTRIES);
  });

  it("shows not-logged-in message when no token", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: undefined,
      refreshToken: undefined,
    });
    vi.mocked(fetchHistory).mockRejectedValue(new Error("not authenticated"));

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Not logged in")).toBeInTheDocument()
    );
  });

  it("renders history entries", async () => {
    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("Rust Language")).toBeInTheDocument()
    );
    expect(screen.getByText("Python")).toBeInTheDocument();
  });

  it("calls fetchHistory with search query after debounce", async () => {
    render(<App />);

    // Wait for initial data to fully render before counting calls
    await screen.findByText("Rust Language", {}, { timeout: 2000 });

    const searchInput = screen.getByRole("searchbox");
    const callsBefore = vi.mocked(fetchHistory).mock.calls.length;

    await userEvent.type(searchInput, "rust");

    // Debounce is 300ms; waitFor retries until the debounced call lands
    await waitFor(
      () => expect(fetchHistory).toHaveBeenCalledTimes(callsBefore + 1),
      { timeout: 1000 }
    );
    expect(fetchHistory).toHaveBeenLastCalledWith("rust", 50, 0);
  }, 3000);

  it("deletes an entry when delete button clicked", async () => {
    render(<App />);
    await waitFor(() => screen.getByText("Rust Language"));

    // Delete buttons are hidden until hover; find by title
    const deleteButtons = document.querySelectorAll(".delete-btn");
    expect(deleteButtons.length).toBe(2);

    await userEvent.click(deleteButtons[0]);

    expect(deleteHistoryEntry).toHaveBeenCalledWith("id-1");
    await waitFor(() =>
      expect(screen.queryByText("Rust Language")).not.toBeInTheDocument()
    );
  });

  it("appends entries received via WebSocket message", async () => {
    render(<App />);
    await waitFor(() => screen.getByText("Rust Language"));

    const newEntry = {
      id: "id-3",
      url: "https://new-site.com",
      title: "New Site",
      visit_time: new Date().toISOString(),
      device_id: "dev-2",
    };

    // Simulate background → page message
    const addListener = vi.mocked(chrome.runtime.onMessage.addListener);
    const handler = addListener.mock.calls[0]?.[0] as (
      msg: unknown
    ) => void;
    handler({ type: "history_sync", entries: [newEntry] });

    await waitFor(() =>
      expect(screen.getByText("New Site")).toBeInTheDocument()
    );
  });

  it("shows empty state when no history", async () => {
    vi.mocked(fetchHistory).mockResolvedValue([]);

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("No history found.")).toBeInTheDocument()
    );
  });
});
