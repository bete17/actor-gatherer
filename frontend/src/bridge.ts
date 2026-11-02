// Between the old page (src/legacy/, one script) and the new code, while views move from one to the other
// (ag_dashboard/DESIGN.md, A4-A6). Set up before the old page runs, as `window.agNext`: what it hands the new code
// (the stream's home) and calls of it (ag's settings). The old page hands back `window.agLegacy`: what the new code
// calls of it. Each side goes once nothing calls it.
import { useDashboard } from "./core/store";
import type { Home } from "./core/api/types";
import { useSettings } from "./features/settings/store";

/** What the old page gives the new code (src/legacy/03-settings.js). */
export interface AgLegacy {
  /** The dashboard's panel opened or closed. */
  setAbout: (open: boolean) => void;
  /** The page is a snapshot (its data inside it), or a pane's frame inside the page: neither has ag's settings. */
  snapshot: boolean;
  pane: boolean;
}

const agNext = Object.freeze({
  /** The stream's home, as the old page takes it (04-seen.js's takeHome). */
  home: (home: Home) => useDashboard.getState().setHome(home),
  settings: Object.freeze({
    load: () => useSettings.getState().load(),
    fileOpen: () => useSettings.getState().file.open,
    closeFile: () => useSettings.getState().closeFile(),
  }),
});

declare global {
  interface Window {
    agNext: typeof agNext;
    agLegacy?: AgLegacy;
  }
}

window.agNext = agNext;
