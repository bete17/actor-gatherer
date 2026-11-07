// The test home's folders as the server keeps them (folders.py, POST /api/folders), for the folder tests (folders.spec.ts,
// rail-move.spec.ts): read, made, and all taken away again after a test.
import type { Page } from "@playwright/test";
import { GATHERER } from "./home";

type Tree = { folders: { id: number; parent: number | null; name: string }[]; filed: Record<string, number> };
type Home = {
  gatherers: { name: string; agents: { harness?: string; channel: string }[] }[];
  saved?: Record<string, Record<string, string>>;
  folders?: Record<string, Tree>;
};
export const homeOf = async (page: Page) => (await (await page.request.get("/api/home")).json()) as Home;
export const treeOf = async (page: Page) => (await homeOf(page)).folders?.[GATHERER] || { folders: [], filed: {} };
/** The id of a folder made in `parent` (null: the gatherer's top). */
export const newFolder = async (page: Page, name: string, parent: number | null = null) =>
  (await (await page.request.post("/api/folders", { data: { gatherer: GATHERER, do: "new", name, parent } })).json())
    .made as number;
/** The test gatherer with no folders, every actor at its top. */
export async function noFolders(page: Page) {
  for (const f of (await treeOf(page)).folders)
    await page.request.post("/api/folders", { data: { gatherer: GATHERER, do: "delete", id: f.id } });
  const filed = Object.keys((await treeOf(page)).filed);
  if (filed.length)
    await page.request.post("/api/folders", { data: { gatherer: GATHERER, do: "file", channels: filed } });
}
/** The channel of the test gatherer's actor run by `harness`. */
export async function channelOf(page: Page, harness: string) {
  const g = (await homeOf(page)).gatherers.find((x) => x.name === GATHERER)!;
  return g.agents.find((a) => a.harness === harness)!.channel;
}
