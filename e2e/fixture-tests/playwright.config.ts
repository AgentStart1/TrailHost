import { defineConfig } from "@playwright/test";
import config from "../playwright.config";

export default defineConfig(config, {
  testDir: ".",
  testMatch: "recording.cases.ts",
  retries: 0,
  use: { trace: "on" },
  reporter: [
    ["json", { outputFile: process.env.RECORDING_REPORT }],
    ["html", { open: "never", outputFolder: process.env.RECORDING_HTML }],
  ],
});
