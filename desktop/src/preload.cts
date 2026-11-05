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
// the page's frames), or none once it isn't.
ipcRenderer.on("ag:still", (_event, still: { target: string; url: string | null }) => {
  for (const el of document.querySelectorAll<HTMLElement>(".bw-stage[data-key]")) {
    if (el.dataset.target !== still.target) continue;
    const img = el.querySelector<HTMLImageElement>(":scope > img");
    if (!img) continue;
    if (still.url) {
      img.src = still.url;
      Object.assign(img.style, { width: `${el.clientWidth}px`, height: `${el.clientHeight}px` });
    }
    img.hidden = !still.url;
  }
});

window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(everyFrame); // panes move with layout: splits, the Editor above, resizing; menus open over them
  setInterval(check, 250); // (frames stop while the window is hidden or covered)
});
