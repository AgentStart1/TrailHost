import { test, expect } from "../fixtures/extension";

const BASE_URL = "https://test.example.com";

const SAMPLE_ENTRIES = [
  {
    id: "h-1",
    url: "https://rust-lang.org",
    title: "Rust Language",
    visit_time: "2024-01-02T10:00:00Z",
    device_id: "dev-1",
  },
  {
    id: "h-2",
    url: "https://python.org",
    title: "Python Docs",
    visit_time: "2024-01-01T09:00:00Z",
    device_id: "dev-1",
  },
];

test.describe("History Page", () => {
  test.beforeEach(async ({ context, setStorage }) => {
    await setStorage({
      trailhost_base_url: BASE_URL,
      trailhost_access_token: "valid-token",
      trailhost_refresh_token: "valid-refresh",
    });

    // Stub history list; checks q param to simulate search filtering
    await context.route(
      new RegExp(`${BASE_URL.replace(".", "\\.")}/api/history(\\?.*)?$`),
      (route) => {
        const url = new URL(route.request().url());
        const q = url.searchParams.get("q")?.toLowerCase();
        const entries = q
          ? SAMPLE_ENTRIES.filter(
              (e) =>
                e.title.toLowerCase().includes(q) ||
                e.url.toLowerCase().includes(q)
            )
          : SAMPLE_ENTRIES;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(entries),
        });
      }
    );

    // Stub delete endpoint
    await context.route(
      new RegExp(`${BASE_URL.replace(".", "\\.")}/api/history/.+`),
      (route) => route.fulfill({ status: 204 })
    );
  });

  test("shows history entries", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/history-page/index.html`
    );

    await expect(page.getByText("Rust Language")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Python Docs")).toBeVisible();
  });

  test("filters entries by search query", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/history-page/index.html`
    );
    await expect(page.getByText("Rust Language")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("searchbox").fill("rust");

    // Debounce is 300ms; wait for Python Docs to disappear
    await expect(page.getByText("Python Docs")).not.toBeVisible({
      timeout: 2_000,
    });
    await expect(page.getByText("Rust Language")).toBeVisible();
  });

  test("deletes an entry", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(
      `chrome-extension://${extensionId}/src/history-page/index.html`
    );
    await expect(page.getByText("Rust Language")).toBeVisible({
      timeout: 10_000,
    });

    // Delete buttons are shown on hover; hover the first entry then click
    const firstEntry = page.locator("li.entry").first();
    await firstEntry.hover();
    await firstEntry.locator(".delete-btn").click();

    await expect(page.getByText("Rust Language")).not.toBeVisible({
      timeout: 5_000,
    });
    // Other entry remains
    await expect(page.getByText("Python Docs")).toBeVisible();
  });
});
