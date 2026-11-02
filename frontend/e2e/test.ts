// Playwright's `test`, with one check more on every test: the page threw no error while it ran (an error in the page's
// script would otherwise pass unseen, its view drawn as far as it got).
import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await use(page);
    expect(errors, "errors thrown in the page").toEqual([]);
  },
});
export { expect };
