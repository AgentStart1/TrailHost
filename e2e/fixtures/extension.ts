import {
  test as base,
  chromium,
  type BrowserContext,
  type TestInfo,
  type Worker,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../../extension/dist");

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  setStorage: (items: Record<string, string>) => Promise<void>;
};

async function deleteVideos(pages: ReturnType<BrowserContext["pages"]>) {
  for (const page of pages) {
    const video = page.video();
    if (!video) continue;
    const filePath = await video.path().catch(() => null);
    if (filePath) await fs.unlink(filePath).catch(() => {});
  }
}

export const test = base.extend<ExtensionFixtures>({
  context: [
    async ({}, use, testInfo: TestInfo) => {
      const videoDir = path.join(testInfo.outputDir, "videos");

      const context = await chromium.launchPersistentContext("", {
        headless: false,
        recordVideo: { dir: videoDir },
        args: [
          // Chrome's new headless mode supports extensions; used in CI
          ...(process.env.CI ? ["--headless=new"] : []),
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ],
      });

      // Track every page ever opened (including ones closed mid-test)
      const allPages = [...context.pages()];
      context.on("page", (page) => allPages.push(page));

      await use(context);

      await context.close();

      // retain-on-failure: delete videos when the test passed
      if (testInfo.status === testInfo.expectedStatus) {
        await deleteVideos(allPages);
      }
    },
    { scope: "test" },
  ],

  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) {
      sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    }
    await use(sw);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = serviceWorker.url().split("/")[2];
    await use(extensionId);
  },

  // Helper to pre-populate chrome.storage.local via the service worker
  setStorage: async ({ serviceWorker }, use) => {
    await use(async (items: Record<string, string>) => {
      await serviceWorker.evaluate(
        (data) => chrome.storage.local.set(data),
        items
      );
    });
  },
});

export const expect = test.expect;
