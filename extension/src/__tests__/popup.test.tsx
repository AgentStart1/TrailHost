import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "../popup/App";

vi.mock("../api/client", () => ({
  getTokens: vi.fn(),
  clearTokens: vi.fn().mockResolvedValue(undefined),
}));

import { getTokens, clearTokens } from "../api/client";

describe("Popup App", () => {
  it("shows login button when not authenticated", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: undefined,
      refreshToken: undefined,
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("登录 / 注册")).toBeInTheDocument()
    );
  });

  it("shows logged-in state when token exists", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "valid-token",
      refreshToken: "refresh",
    });

    render(<App />);

    await waitFor(() =>
      expect(screen.getByText("查看历史")).toBeInTheDocument()
    );
    expect(screen.getByText("退出登录")).toBeInTheDocument();
  });

  it("opens auth page tab when login button clicked", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: undefined,
      refreshToken: undefined,
    });

    render(<App />);
    await waitFor(() => screen.getByText("登录 / 注册"));
    await userEvent.click(screen.getByText("登录 / 注册"));

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining("auth-page"),
    });
  });

  it("clears tokens and sends message on logout", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
    });

    render(<App />);
    await waitFor(() => screen.getByText("退出登录"));
    await userEvent.click(screen.getByText("退出登录"));

    expect(clearTokens).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "auth_changed",
      loggedIn: false,
    });
  });

  it("shows login button again after logout", async () => {
    vi.mocked(getTokens)
      .mockResolvedValueOnce({ accessToken: "token", refreshToken: "ref" })
      .mockResolvedValue({ accessToken: undefined, refreshToken: undefined });

    render(<App />);
    await waitFor(() => screen.getByText("退出登录"));
    await userEvent.click(screen.getByText("退出登录"));

    await waitFor(() =>
      expect(screen.getByText("登录 / 注册")).toBeInTheDocument()
    );
  });

  it("opens history tab when 查看历史 clicked", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "token",
      refreshToken: "ref",
    });

    render(<App />);
    await waitFor(() => screen.getByText("查看历史"));
    await userEvent.click(screen.getByText("查看历史"));

    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: expect.stringContaining("history-page"),
    });
  });
});
