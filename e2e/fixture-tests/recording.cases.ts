import { test, expect } from "../fixtures/extension";

test("discards recordings after success", async ({ context }) => {
  const page = await context.newPage();
  await page.setContent("<p>successful recording</p>");
  await page.close();
});

for (const marker of ["alpha", "beta"]) {
  test(`retains recordings for ${marker}`, async ({ context, serviceWorker, setStorage }) => {
    expect(await serviceWorker.evaluate(() => chrome.storage.local.get("recording_marker"))).toEqual({});
    await setStorage({ recording_marker: marker });
    await context.route("https://recording.example.com/", route => route.fulfill({ body: marker }));
    const closedPage = await context.newPage();
    await closedPage.goto("https://recording.example.com/");
    await expect(closedPage.locator("body")).toHaveText(marker);
    await closedPage.close();
    const openPage = await context.newPage();
    await openPage.setContent(`<p>${marker}</p>`);
    expect(await serviceWorker.evaluate(() => chrome.storage.local.get("recording_marker"))).toEqual({ recording_marker: marker });
    // The outer verifier expects this failure and checks teardown and attachments.
    throw new Error(`intentional recording failure: ${marker}`);
  });
}
