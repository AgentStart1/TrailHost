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

async function lifecyclePhase<T>(
  testInfo: TestInfo,
  phase: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (process.env.E2E_DIAGNOSTICS !== "1") return await operation();
  const logPath = testInfo.outputPath("lifecycle.jsonl");
  const started = performance.now();
  const record = async (event: string) => {
    try {
      await fs.mkdir(path.dirname(logPath), { recursive: true });
      await fs.appendFile(logPath, JSON.stringify({
        phase, event, pid: process.pid, worker: testInfo.workerIndex,
        timestamp: new Date().toISOString(), elapsedMs: performance.now() - started,
      }) + "\n");
    } catch {
      // Diagnostic I/O must not replace a test or cleanup failure.
      process.stderr.write(`Unable to record lifecycle phase: ${phase}\n`);
    }
  };
  await record("start");
  let outcome = "error";
  try {
    const result = await operation();
    outcome = "complete";
    return result;
  } finally {
    await record(outcome);
  }
}

type ExtensionFixtures = {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  setStorage: (items: Record<string, string>) => Promise<void>;
};

export const test = base.extend<ExtensionFixtures>({
  context: [
    async ({}, use, testInfo: TestInfo) => {
      const videoDir = path.join(testInfo.outputDir, "videos");

      const context = await lifecyclePhase(testInfo, "context.launch", () => chromium.launchPersistentContext("", {
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
      }));

      // Track every page ever opened (including ones closed mid-test)
      const allPages = [...context.pages()];
      context.on("page", (page) => allPages.push(page));

      try {
        await use(context);
      } finally {
        // Closing finalizes recordings, including pages closed during the test.
        // Attach only after close; reporters copy the completed video files.
        await lifecyclePhase(testInfo, "context.close", () => context.close());
        for (const [index, page] of allPages.entries()) {
          const video = page.video();
          if (!video) continue;
          if (testInfo.status === testInfo.expectedStatus) {
            // Persistent context closure also disconnects the browser, so the
            // protocol-based video.delete() is unavailable at this point.
            const videoPath = await lifecyclePhase(testInfo, `video.${index}.path`, () => video.path());
            await lifecyclePhase(testInfo, `video.${index}.delete`, () => fs.unlink(videoPath));
          } else {
            const videoPath = await lifecyclePhase(testInfo, `video.${index}.path`, () => video.path());
            await lifecyclePhase(testInfo, `video.${index}.attach`, () => testInfo.attach(`video-${index + 1}`, {
              path: videoPath,
              contentType: "video/webm",
            }));
          }
        }
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
