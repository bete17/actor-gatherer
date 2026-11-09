// In the app's dashboard page (desktop/DESIGN.md, "A tab in its pane"): tells the page it is in the app, and takes from
// the page where each native page goes -- the page works it out from what its apps' panels report (app_kit's
// ag.native: frontend/src/features/apps/native.ts), each frame: where the panel's element is in the window, the page it
// asks shown there, whether something covers it, and whose it is (its app) -- so the app keeps that page over it, or,
// while something is over it (a native page would hide it), a still picture of the page in its place ("ag:still"),
// handed back to the page for the panel to draw. The panel says once it is drawn ("ag:still-drawn"), so the page is
// hidden only with its picture in its place.
import { contextBridge, ipcRenderer } from "electron";

type Stage = { x: number; y: number; w: number; h: number; target: string; covered: boolean; app?: string; key?: string };
type Still = { target: string; url: string | null };

const stills = new Set<(still: Still) => void>();
ipcRenderer.on("ag:still", (_event, still: Still) => {
  for (const cb of stills) {
    try {
      cb(still);
    } catch {
      // (the page's own trouble)
    }
  }
});

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

contextBridge.exposeInMainWorld("agApp", {
  native: true,
  focusDashboard: () => ipcRenderer.send("ag:focus"), // the keys back to the dashboard from a native page
  raise: () => ipcRenderer.send("ag:raise"), // the window brought to the front (a notification of the page's clicked)
  place: (stages: unknown) => {
    const list: Stage[] = (Array.isArray(stages) ? stages : []).filter((s) => s && typeof s === "object").map((s) => ({
      x: num(s.x), y: num(s.y), w: num(s.w), h: num(s.h), target: String(s.target || ""), covered: !!s.covered,
      ...(typeof s.app === "string" ? { app: s.app } : {}), ...(typeof s.key === "string" ? { key: s.key } : {}),
    }));
    ipcRenderer.send("ag:stages", list);
  },
  onStill: (cb: (still: Still) => void) => {
    if (typeof cb === "function") stills.add(cb);
  },
  stillDrawn: (target: unknown) => ipcRenderer.send("ag:still-drawn", String(target || "")),
});
