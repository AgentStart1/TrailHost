import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { App } from "../auth-page/App";

vi.mock("../api/client", () => ({
  getTokens: vi.fn(),
  getBaseUrl: vi.fn(),
  setBaseUrl: vi.fn().mockResolvedValue(undefined),
  saveTokens: vi.fn().mockResolvedValue(undefined),
  login: vi.fn(),
  register: vi.fn(),
}));

import {
  getTokens,
  getBaseUrl,
  setBaseUrl,
  saveTokens,
  login,
  register,
} from "../api/client";

// window.close is already stubbed in setup.ts; just grab a reference for assertions
const closeSpy = vi.mocked(window.close as ReturnType<typeof vi.fn>);

beforeEach(() => {
  closeSpy.mockClear();
});

describe("Auth Page — already logged in", () => {
  it("calls window.close immediately if token exists", async () => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: "existing-token",
      refreshToken: "ref",
    });
    vi.mocked(getBaseUrl).mockResolvedValue("https://example.com");

    render(<App />);

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
  });
});

describe("Auth Page — server setup step", () => {
  beforeEach(() => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: undefined,
      refreshToken: undefined,
    });
    vi.mocked(getBaseUrl).mockResolvedValue("");
  });

  it("shows setup form when no server URL configured", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("https://your-domain.com")).toBeInTheDocument()
    );
  });

  it("rejects non-http URLs", async () => {
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("https://your-domain.com"));

    await userEvent.type(
      screen.getByPlaceholderText("https://your-domain.com"),
      "ftp://bad-url.com"
    );
    await userEvent.click(screen.getByText("继续"));

    expect(
      screen.getByText(/URL 必须以 http/)
    ).toBeInTheDocument();
    expect(setBaseUrl).not.toHaveBeenCalled();
  });

  it("saves URL and proceeds to auth on valid submit", async () => {
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText("https://your-domain.com"));

    await userEvent.type(
      screen.getByPlaceholderText("https://your-domain.com"),
      "https://my-server.com"
    );
    await userEvent.click(screen.getByText("继续"));

    expect(setBaseUrl).toHaveBeenCalledWith("https://my-server.com");
    // "更换服务器" is unique to the auth form step
    await waitFor(() =>
      expect(screen.getByText("更换服务器")).toBeInTheDocument()
    );
  });
});

describe("Auth Page — login/register", () => {
  beforeEach(() => {
    vi.mocked(getTokens).mockResolvedValue({
      accessToken: undefined,
      refreshToken: undefined,
    });
    vi.mocked(getBaseUrl).mockResolvedValue("https://example.com");
  });

  it("shows login and register tabs", async () => {
    render(<App />);
    // "更换服务器" only appears on the auth step, confirming we're past setup
    await waitFor(() => screen.getByText("更换服务器"));
    expect(screen.getByText("注册")).toBeInTheDocument();
  });

  it("logs in successfully and closes the tab", async () => {
    vi.mocked(login).mockResolvedValue({
      access_token: "new-acc",
      refresh_token: "new-ref",
      user_id: "uid",
    });

    render(<App />);
    await waitFor(() => screen.getByText("更换服务器"));

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "a@b.com");
    await userEvent.type(
      document.querySelector('input[type="password"]')!,
      "password123"
    );
    // Submit the form directly to avoid ambiguity between tab and submit button
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() => {
      expect(saveTokens).toHaveBeenCalledWith("new-acc", "new-ref");
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: "auth_changed",
        loggedIn: true,
      });
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  it("shows error on login failure", async () => {
    vi.mocked(login).mockRejectedValue(new Error("Invalid credentials"));

    render(<App />);
    await waitFor(() => screen.getByText("更换服务器"));

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "a@b.com");
    await userEvent.type(
      document.querySelector('input[type="password"]')!,
      "wrongpass"
    );
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() =>
      expect(screen.getByText("Invalid credentials")).toBeInTheDocument()
    );
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it("switches to register tab and shows conflict error", async () => {
    vi.mocked(register).mockRejectedValue(new Error("Email already registered"));

    render(<App />);
    await waitFor(() => screen.getByText("更换服务器"));
    await userEvent.click(screen.getByText("注册"));

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "a@b.com");
    await userEvent.type(
      document.querySelector('input[type="password"]')!,
      "password123"
    );
    fireEvent.submit(document.querySelector("form")!);

    await waitFor(() =>
      expect(screen.getByText("Email already registered")).toBeInTheDocument()
    );
  });

  it("navigates back to setup when 更换服务器 clicked", async () => {
    render(<App />);
    await waitFor(() => screen.getByText("更换服务器"));
    await userEvent.click(screen.getByText("更换服务器"));

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText("https://your-domain.com")
      ).toBeInTheDocument()
    );
  });
});
