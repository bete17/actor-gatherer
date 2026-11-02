// The page's script as page.html had it (ag_dashboard/DESIGN.md, step A3): its sections, each a file of
// src/legacy/, joined in the order of src/legacy/order.json into one module, `virtual:legacy`. So they share one scope
// and run top to bottom, as they did in one <script>; a source map points each line back to its file. A file changed
// in development reloads the page. The files go as their views are rewritten (A5, A6), and this with the last.
import fs from "node:fs";
import path from "node:path";
import MagicString, { Bundle } from "magic-string";
import type { Plugin } from "vite";

const ID = "virtual:legacy";
const RESOLVED = "\0" + ID;

export default function legacy(dir: string): Plugin {
  return {
    name: "ag-legacy",
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const order = JSON.parse(fs.readFileSync(path.join(dir, "order.json"), "utf8")) as { js: string[] };
      this.addWatchFile(path.join(dir, "order.json"));
      const bundle = new Bundle({ separator: "" });
      for (const name of order.js) {
        const file = path.join(dir, name);
        this.addWatchFile(file);
        bundle.addSource({ filename: file, content: new MagicString(fs.readFileSync(file, "utf8")) });
      }
      return {
        code: bundle.toString(),
        map: bundle.generateMap({ hires: "boundary", includeContent: true }).toString(),
      };
    },
    handleHotUpdate({ file, server }) {
      if (path.dirname(file) === dir) {
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
        return [];
      }
    },
  };
}
