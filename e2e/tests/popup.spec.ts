import { test, expect } from "../fixtures/extension";

test.describe("Popup", () => {
  test("shows login button when not authenticated", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html`
    );

    await expect(page.getByText("登录 / 注册")).toBeVisible();
  });

  test("shows logged-in state when token exists", async ({
    context,
    extensionId,
    setStorage,
  }) => {
    await setStorage({
      trailhost_base_url: "https://test.example.com",
      trailhost_access_token: "valid-token",
      trailhost_refresh_token: "valid-refresh",
    });

    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html`
    );

    await expect(page.getByText("查看历史")).toBeVisible();
    await expect(page.getByText("退出登录")).toBeVisible();
  });

  test("opens auth page tab when login button clicked", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html`
    );
    await expect(page.getByText("登录 / 注册")).toBeVisible();

    const [authPage] = await Promise.all([
      context.waitForEvent("page", {
        predicate: (p) => p.url().includes("auth-page"),
      }),
      page.getByText("登录 / 注册").click(),
    ]);

    expect(authPage.url()).toContain("auth-page");
  });

  test("returns to login state after logout", async ({
    context,
    extensionId,
    setStorage,
  }) => {
    await setStorage({
      trailhost_base_url: "https://test.example.com",
      trailhost_access_token: "valid-token",
      trailhost_refresh_token: "valid-refresh",
    });

    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/popup/index.html`
    );
    await expect(page.getByText("退出登录")).toBeVisible();

    await page.getByText("退出登录").click();

    await expect(page.getByText("登录 / 注册")).toBeVisible();
  });
});
