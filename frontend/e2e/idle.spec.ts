// An idle page does no work: no layout while nothing changes (the Chrome idle layout loop, fixed before).
import { expect, test } from "./test";
import { CLAUDE, openActor } from "./home";

test("lays nothing out while idle", async ({ page }) => {
  await openActor(page, CLAUDE);
  await page.waitForTimeout(1500); // what the click started settles
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const layouts = async () =>
    (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "LayoutCount")?.value ?? 0;
  const before = await layouts();
  await page.waitForTimeout(3000);
  expect((await layouts()) - before).toBeLessThanOrEqual(1);
});
