// Between the old page (src/legacy/, one script) and the new code, while views move from one to the other
// (ag_dashboard/DESIGN.md, A4-A6). Set up before the old page runs, as `window.agNext`: what it hands the new code
// (the stream's home) and calls of it (ag's settings; the renderers it draws with, `ui`). The old page hands back
// `window.agLegacy`: what the new code calls of it. Each side goes once nothing calls it.
import { useDashboard } from "./core/store";
import type { Home } from "./core/api/types";
import {
  ansiHtml,
  codeClick,
  guessWeb,
  hlLines,
  hlPart,
  langOfPath,
  outputHtml,
  shellHtml,
  tildePath,
} from "./core/ui/highlight";
import { escapeHtml } from "./core/ui/html";
import { markdown, unplanned } from "./core/ui/md";
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
  /** The renderers the old page draws with (src/legacy/11-code.js's and 12-transcript.js's functions call these). */
  ui: Object.freeze({
    escapeHtml,
    langOfPath,
    guessWeb,
    hlLines,
    hlPart,
    tildePath,
    shellHtml,
    ansiHtml,
    outputHtml,
    codeClick,
    markdown,
    unplanned,
  }),
});

declare global {
  interface Window {
    agNext: typeof agNext;
    agLegacy?: AgLegacy;
  }
}

window.agNext = agNext;
