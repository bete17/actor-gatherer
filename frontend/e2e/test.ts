// Playwright's `test`, with one check more on every test: the page threw no error while it ran (an error in the page's
// script would otherwise pass unseen, its view drawn as far as it got).
import { expect, test as base, type Page } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await use(page);
    expect(errors, "errors thrown in the page").toEqual([]);
  },
});
export { expect };

/** The page's streams each its own HTTP request, as before they shared a WebSocket (src/core/api/stream.ts): the socket
 * refused, so the page opens each as an EventSource -- which `page.route` can hold back or answer, as a socket's
 * messages it cannot. */
export const streamsAsRequests = (page: Page) => page.routeWebSocket(/\/api\/ws$/, (ws) => ws.close());
