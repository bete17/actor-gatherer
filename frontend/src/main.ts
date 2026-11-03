// The dashboard's page: the old page (src/legacy/: its styles, then its script, one scope) and, drawn into it, the
// views rewritten so far (ag_dashboard/DESIGN.md, A4-A6). The bridge comes first: the old page calls it as it runs.
import "./bridge";
import "./legacy/styles";
import "virtual:legacy";
import { mountSettings } from "./features/settings/mount";

const legacy = window.agLegacy;
const cfg = document.getElementById("cfg");
if (legacy && cfg && !legacy.snapshot && !legacy.pane) {
  mountSettings(cfg, { open: () => legacy.setAbout(true), close: () => legacy.setAbout(false) });
}
