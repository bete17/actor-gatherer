// For the renderers' tests (Vitest, in jsdom): the vendored marked and DOMPurify as the page loads them, and HTML read
// back as a reader sees it.
import fs from "node:fs";
import path from "node:path";

/** The repository's root (the front end is its frontend/). */
export const ROOT = path.resolve(import.meta.dirname, "../../../..");

/** A vendored script (ag_dashboard/vendor/), run as the page runs it: what it makes. */
function vendored(file: string): unknown {
  const m = { exports: {} };
  new Function("module", "exports", fs.readFileSync(path.join(ROOT, "ag_dashboard", "vendor", file), "utf8"))(
    m,
    m.exports,
  );
  return m.exports;
}

/** window.marked and window.DOMPurify, as index.html's scripts set them before the page runs. */
export function loadVendored() {
  window.marked ??= vendored("marked.min.js") as Window["marked"];
  window.DOMPurify ??= vendored("purify.min.js") as Window["DOMPurify"];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/** HTML as its text: what the reader sees, less the tags. */
export const plain = (markup: string) =>
  markup
    .replaceAll("&#8203;", "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e]);

/** [class, text] tokens as {class: [texts]}, plain text left out. */
export function tokens(pairs: [string, string][]) {
  const out: Record<string, string[]> = {};
  for (const [cls, t] of pairs) if (cls) (out[cls] ??= []).push(t);
  return out;
}
