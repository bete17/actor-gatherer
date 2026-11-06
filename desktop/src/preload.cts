// In the app's dashboard page (desktop/DESIGN.md, "A tab in its pane"): tells the page it is in the app, and tells the
// app where each Browser pane is, which tab it shows, and whether something of the dashboard's covers it, as they
// change -- so the app keeps that tab's native page over it, or, while a menu or popover of the dashboard's is over
// the pane (a native page would hide it), a still picture of the page in its place ("ag:still"). The page marks each
// pane (its stage) with data-key and data-target (frontend/src/legacy/20-browser.js, bwNative).
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agApp", {
  native: true,
  focusDashboard: () => ipcRenderer.send("ag:focus"), // the keys back to the dashboard from the native page
});

type Stage = { x: number; y: number; w: number; h: number; key: string; target: string; covered: boolean };
const GRID = 5; // points across and down the pane looked at for something of the dashboard's over it
let last = "";

/** Whether anything of the dashboard's is over the pane: at some point of it, the top element isn't the pane's own; or
 * what the pane draws over the page itself is up (a page's dialog, a download done). */
function covered(el: HTMLElement, r: DOMRect): boolean {
  if (el.querySelector(":scope > :is(.dialog, .dl):not([hidden])")) return true;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const hit = document.elementFromPoint(r.left + (r.width * (i + 0.5)) / GRID, r.top + (r.height * (j + 0.5)) / GRID);
      if (hit && !el.contains(hit)) return true;
    }
  }
  return false;
}

function check(): void {
  const stages: Stage[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(".bw-stage[data-key]")) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || !el.checkVisibility()) continue;
    stages.push({ x: r.left, y: r.top, w: r.width, h: r.height, key: el.dataset.key || "", target: el.dataset.target || "",
      covered: covered(el, r) });
  }
  const now = JSON.stringify(stages);
  if (now === last) return;
  last = now;
  ipcRenderer.send("ag:stages", stages);
}

function everyFrame(): void {
  check();
  requestAnimationFrame(everyFrame);
}

// The still picture of a pane's page while it is covered (its stage's own image, where a browser tab's dashboard draws
// the page's frames), or none once it isn't. A picture is shown once decoded, and the app told once it is drawn
// ("ag:still-drawn"), so the page is hidden only with its picture in its place; a newer word for the pane wins.
const stillAsked = new Map<string, number>();
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
ipcRenderer.on("ag:still", async (_event, still: { target: string; url: string | null }) => {
  const n = (stillAsked.get(still.target) || 0) + 1;
  stillAsked.set(still.target, n);
  const imgs: HTMLImageElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(".bw-stage[data-key]")) {
    if (el.dataset.target !== still.target) continue;
    const img = el.querySelector<HTMLImageElement>(":scope > img");
    if (!img) continue;
    if (still.url) {
      img.src = still.url;
      Object.assign(img.style, { width: `${el.clientWidth}px`, height: `${el.clientHeight}px` });
      imgs.push(img);
    } else img.hidden = true;
  }
  if (!still.url) return;
  await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
  if (stillAsked.get(still.target) !== n) return;
  for (const img of imgs) img.hidden = false;
  await nextFrame(); // (drawn in this frame, on screen by the next)
  await nextFrame();
  if (stillAsked.get(still.target) === n) ipcRenderer.send("ag:still-drawn", still.target);
});

window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(everyFrame); // panes move with layout: splits, the Editor above, resizing; menus open over them
  setInterval(check, 250); // (frames stop while the window is hidden or covered)
});
