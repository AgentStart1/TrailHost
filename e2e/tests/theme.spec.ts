import { test, expect } from "../fixtures/extension";
import type { Page, TestInfo } from "@playwright/test";

// Read rendered foregrounds and composite every ancestor background. This also
// catches low-contrast text on hovered surfaces, rather than checking tokens.
async function auditText(page: Page, testInfo: TestInfo, name: string) {
  const samples = await page.evaluate(() => {
    type Color = number[];
    const parse = (value: string): Color => value.match(/[\d.]+/g)!.map(Number);
    const over = (fg: Color, bg: Color): Color => {
      const a = fg[3] ?? 1;
      return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a));
    };
    const background = (element: Element | null): Color => {
      if (!element) return [255, 255, 255];
      return over(parse(getComputedStyle(element).backgroundColor), background(element.parentElement));
    };
    const luminance = (rgb: Color) => rgb.map(c => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (fg: Color, bg: Color) => {
      const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    return [...document.body.querySelectorAll("*")].flatMap(element => {
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility === "hidden" || Number(style.opacity) === 0) return [];
      const text = [...element.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      const input = element instanceof HTMLInputElement;
      if (!text && !input) return [];
      const bg = background(element);
      const fg = over(parse(style.color), bg);
      const results = [{ element: element.className || element.tagName, foreground: fg, background: bg, ratio: ratio(fg, bg) }];
      if (input && element.placeholder && !element.value) {
        const placeholder = over(parse(getComputedStyle(element, "::placeholder").color), bg);
        results.push({ element: "placeholder", foreground: placeholder, background: bg, ratio: ratio(placeholder, bg) });
      }
      return results;
    });
  });
  await testInfo.attach(name, { body: JSON.stringify(samples, null, 2), contentType: "application/json" });
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) expect(sample.ratio, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
}

const colors = { light: "rgb(248, 250, 252)", dark: "rgb(15, 23, 42)" };
type Scheme = keyof typeof colors;

async function checkTheme(page: Page, scheme: Scheme) {
  await expect(page.locator("body")).toHaveCSS("background-color", colors[scheme]);
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches)).toBe(scheme === "dark");
}

for (const surface of ["popup", "history-page", "auth-page"]) {
  for (const initial of ["light", "dark"] as const) {
    test(`${surface} follows ${initial} on entry, live switch and re-entry`, async ({ context, extensionId, setStorage }, testInfo) => {
      if (surface !== "auth-page") {
        await setStorage({
          trailhost_base_url: "https://test.example.com",
          trailhost_access_token: "synthetic-token",
          trailhost_refresh_token: "synthetic-refresh",
        });
      }
      await context.route("https://www.google.com/**", route => route.abort());
      await context.route("https://test.example.com/api/history**", route => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(Array.from({ length: 50 }, (_, i) => ({
          id: `sample-${i}`, url: "https://example.com/synthetic",
          title: `Synthetic history ${i}`, visit_time: "2026-01-01T10:00:00Z", device_id: "synthetic",
        }))),
      }));
      const url = `chrome-extension://${extensionId}/src/${surface}/index.html`;
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: initial });
      await page.goto(url);
      await expect(page.locator(surface === "history-page" ? ".entry" : "button").first()).toBeVisible();
      // Force a validation error without contacting any authentication server.
      if (surface === "auth-page") {
        await page.locator("input").fill("ftp://example.com");
        await page.getByRole("button", { name: "继续" }).click();
        await expect(page.locator(".error")).toBeVisible();
      }
      const other: Scheme = initial === "light" ? "dark" : "light";
      for (const scheme of [initial, other, initial]) {
        await page.emulateMedia({ colorScheme: scheme });
        await checkTheme(page, scheme);
        await page.mouse.move(0, 0);
        await auditText(page, testInfo, `${scheme}-normal`);
        const input = page.locator("input").first();
        if (await input.count()) {
          await input.focus();
          await expect(input).toHaveCSS("outline-style", "solid");
          await auditText(page, testInfo, `${scheme}-focus`);
        }
        const interactive = page.locator(surface === "history-page" ? ".entry-title" : "button").first();
        await interactive.hover();
        // Check the effective row surface as well as text foregrounds.
        if (surface === "history-page") {
          await expect(page.locator(".entry").first()).toHaveCSS("background-color", scheme === "dark" ? "rgb(51, 65, 85)" : "rgb(226, 232, 240)");
          await expect(page.locator(".delete-btn").first()).toHaveCSS("opacity", "1");
        }
        await auditText(page, testInfo, `${scheme}-hover`);
        if (surface === "history-page") {
          await page.locator(".delete-btn").first().hover();
          await auditText(page, testInfo, `${scheme}-delete-hover`);
        }
        await testInfo.attach(`${scheme}-render`, { body: await page.screenshot(), contentType: "image/png" });
      }
      await page.close();
      const reopened = await context.newPage();
      await reopened.emulateMedia({ colorScheme: other });
      await reopened.goto(url);
      await checkTheme(reopened, other);
      await auditText(reopened, testInfo, "reopened");
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`auth form states remain legible in ${scheme}`, async ({ context, extensionId, setStorage }, testInfo) => {
    await setStorage({ trailhost_base_url: "https://test.example.com" });
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`chrome-extension://${extensionId}/src/auth-page/index.html`);
    await expect(page.locator(".tabs")).toBeVisible();
    await auditText(page, testInfo, "login");
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await auditText(page, testInfo, "register");
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "更换服务器" }).focus();
    await expect(page.getByRole("button", { name: "更换服务器" })).toHaveCSS("outline-style", "solid");
    await page.getByRole("button", { name: "更换服务器" }).hover();
    await auditText(page, testInfo, "server-hover");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("https://test.example.com/api/auth/register", async route => {
      await pending;
      await route.fulfill({ status: 401 });
    });
    await page.getByPlaceholder("you@example.com").fill("synthetic@example.com");
    await page.locator('input[type="password"]').fill("synthetic-password");
    await page.locator("form").dispatchEvent("submit");
    try {
      await expect(page.locator(".btn-primary")).toBeDisabled();
      await auditText(page, testInfo, "submitting");
    } finally {
      release();
    }
    await expect(page.locator(".error")).toBeVisible();
    await auditText(page, testInfo, "auth-error");
    await testInfo.attach("auth-render", { body: await page.screenshot(), contentType: "image/png" });
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const surface of ["popup", "history-page"]) {
    test(`logged-out ${surface} follows ${scheme}`, async ({ context, extensionId }, testInfo) => {
      const page = await context.newPage();
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(`chrome-extension://${extensionId}/src/${surface}/index.html`);
      await expect(page.getByText(surface === "popup" ? "登录 / 注册" : "Not logged in", { exact: true })).toBeVisible();
      await checkTheme(page, scheme);
      await auditText(page, testInfo, surface);
    });
  }

  test(`empty history follows ${scheme}`, async ({ context, extensionId, setStorage }, testInfo) => {
    await setStorage({
      trailhost_base_url: "https://test.example.com",
      trailhost_access_token: "synthetic-token",
    });
    await context.route("https://test.example.com/api/history**", route => route.fulfill({
      contentType: "application/json", body: "[]",
    }));
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`chrome-extension://${extensionId}/src/history-page/index.html`);
    await expect(page.locator(".empty")).toBeVisible();
    await auditText(page, testInfo, "empty-history");
  });
}

for (const surface of ["popup", "history-page", "auth-page"]) {
  test(`${surface} uses the browser preference without a page theme override`, async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/${surface}/index.html`);
    const dark = await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches);
    await checkTheme(page, dark ? "dark" : "light");
  });
}
