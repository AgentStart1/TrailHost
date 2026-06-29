import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getBaseUrl,
  setBaseUrl,
  getTokens,
  saveTokens,
  clearTokens,
  apiFetch,
  login,
  register,
} from "../api/client";

describe("storage helpers", () => {
  it("getBaseUrl returns empty string when unset", async () => {
    expect(await getBaseUrl()).toBe("");
  });

  it("setBaseUrl strips trailing slash", async () => {
    await setBaseUrl("https://example.com/");
    expect(await getBaseUrl()).toBe("https://example.com");
  });

  it("getTokens returns undefined when storage empty", async () => {
    const { accessToken, refreshToken } = await getTokens();
    expect(accessToken).toBeUndefined();
    expect(refreshToken).toBeUndefined();
  });

  it("saveTokens and getTokens roundtrip", async () => {
    await saveTokens("acc", "ref");
    const { accessToken, refreshToken } = await getTokens();
    expect(accessToken).toBe("acc");
    expect(refreshToken).toBe("ref");
  });

  it("clearTokens removes both tokens", async () => {
    await saveTokens("acc", "ref");
    await clearTokens();
    const { accessToken, refreshToken } = await getTokens();
    expect(accessToken).toBeUndefined();
    expect(refreshToken).toBeUndefined();
  });
});

describe("apiFetch", () => {
  beforeEach(async () => {
    await setBaseUrl("https://api.example.com");
    await saveTokens("valid-access-token", "valid-refresh-token");
  });

  it("adds Authorization header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 200 })
    );

    await apiFetch("/api/history");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/api/history",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid-access-token",
        }),
      })
    );
  });

  it("retries with refreshed token on 401", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await apiFetch("/api/history");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const { accessToken } = await getTokens();
    expect(accessToken).toBe("new-access");
  });

  it("throws when not authenticated", async () => {
    await clearTokens();
    await expect(apiFetch("/api/history")).rejects.toThrow("not authenticated");
  });
});

describe("register", () => {
  beforeEach(async () => {
    await setBaseUrl("https://api.example.com");
  });

  it("returns auth result on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "acc",
          refresh_token: "ref",
          user_id: "uuid",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await register("a@b.com", "pass");
    expect(result.access_token).toBe("acc");
  });

  it("throws on duplicate email (409)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 409 })
    );

    await expect(register("a@b.com", "pass")).rejects.toThrow(
      "Email already registered"
    );
  });
});

describe("login", () => {
  beforeEach(async () => {
    await setBaseUrl("https://api.example.com");
  });

  it("throws on wrong credentials (401)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 401 })
    );

    await expect(login("a@b.com", "wrong")).rejects.toThrow(
      "Invalid credentials"
    );
  });
});
