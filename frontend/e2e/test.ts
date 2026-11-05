// Playwright's `test`, with one check more on every test: the page threw no error while it ran (an error in the page's
// script would otherwise pass unseen, its view drawn as far as it got).
import { expect, test as base, type Page, type WebSocketRoute } from "@playwright/test";

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

/** The page's streams as the server sends them, each `chat` (what Chat shows of the actor: chat_view.py's view) passed
 * through `change` on its way; `again()` sends the latest again, changed as `change` changes it now. */
export async function chatAs(page: Page, change: (view: Record<string, unknown>) => Record<string, unknown>) {
  let last: [string, Record<string, unknown>] | null = null;
  let socket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/ws$/, (ws) => {
    socket = ws;
    const server = ws.connectToServer();
    server.onMessage((m) => {
      const [id, name, ...data] = typeof m === "string" ? m.split("\n") : [];
      if (name !== "chat") return ws.send(m);
      last = [id, JSON.parse(data.join("\n"))];
      ws.send(`${id}\nchat\n${JSON.stringify(change(last[1]))}`);
    });
  });
  return {
    again: () => {
      if (socket && last) socket.send(`${last[0]}\nchat\n${JSON.stringify(change(last[1]))}`);
    },
  };
}
