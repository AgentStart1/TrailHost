import { test, expect } from "../fixtures/extension";

const BASE_URL = "https://test.example.com";

test.describe("Auth Page", () => {
  test("shows server setup form when no URL is configured", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/auth-page/index.html`
    );

    await expect(
      page.getByPlaceholder("https://your-domain.com")
    ).toBeVisible();
  });

  test("rejects non-http server URL", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/auth-page/index.html`
    );
    await expect(
      page.getByPlaceholder("https://your-domain.com")
    ).toBeVisible();

    await page
      .getByPlaceholder("https://your-domain.com")
      .fill("ftp://bad-url.com");
    await page.getByText("继续").click();

    await expect(page.getByText(/URL 必须以 http/)).toBeVisible();
  });

  test("proceeds to auth form after valid server URL", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/auth-page/index.html`
    );

    await page
      .getByPlaceholder("https://your-domain.com")
      .fill(BASE_URL);
    await page.getByText("继续").click();

    // "更换服务器" link only appears on the auth step
    await expect(page.getByText("更换服务器")).toBeVisible();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();
  });

  test("logs in successfully and closes the tab", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/auth-page/index.html`
    );

    await page
      .getByPlaceholder("https://your-domain.com")
      .fill(BASE_URL);
    await page.getByText("继续").click();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();

    await page.route(`${BASE_URL}/api/auth/login`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "new-token",
          refresh_token: "new-refresh",
          user_id: "uid-123",
        }),
      })
    );

    await page.getByPlaceholder("you@example.com").fill("user@example.com");
    await page.locator('input[type="password"]').fill("password123");
    await page.locator("form").dispatchEvent("submit");

    // Successful login calls window.close(); page detaches
    await page.waitForEvent("close", { timeout: 5_000 });
  });

  test("shows error on invalid credentials", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/auth-page/index.html`
    );

    await page
      .getByPlaceholder("https://your-domain.com")
      .fill(BASE_URL);
    await page.getByText("继续").click();
    await expect(page.getByPlaceholder("you@example.com")).toBeVisible();

    await page.route(`${BASE_URL}/api/auth/login`, (route) =>
      route.fulfill({ status: 401 })
    );

    await page.getByPlaceholder("you@example.com").fill("user@example.com");
    await page.locator('input[type="password"]').fill("wrongpassword");
    await page.locator("form").dispatchEvent("submit");

    await expect(page.getByText("Invalid credentials")).toBeVisible();
  });

  test("navigates back to setup when 更换服务器 clicked", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/auth-page/index.html`
    );

    await page
      .getByPlaceholder("https://your-domain.com")
      .fill(BASE_URL);
    await page.getByText("继续").click();
    await expect(page.getByText("更换服务器")).toBeVisible();

    await page.getByText("更换服务器").click();

    await expect(
      page.getByPlaceholder("https://your-domain.com")
    ).toBeVisible();
  });
});
