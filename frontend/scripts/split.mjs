#!/usr/bin/env node
// The dashboard's page.html, split into the front end's sources (ag_dashboard/DESIGN.md, step A3): its markup
// (index.html), its styles (src/legacy/css/), and its script (src/legacy/*.js), each section of the script a file of
// its own. Every line is kept as it was, so a change made to page.html maps line for line onto the files: --port
// rewrites a diff of page.html (a branch begun before the split) as a diff of them.
//
//   node scripts/split.mjs [PAGE]                 write the files from PAGE (default: ../ag_dashboard/page.html)
//   node scripts/split.mjs --port DIFF [PAGE]     print DIFF (a unified diff of ag_dashboard/page.html) as a diff of
//                                                 the files, to `git apply` from the repository's root. PAGE: the
//                                                 page.html the diff was made against, e.g. from
//                                                 `git show $(git merge-base HEAD origin/main):ag_dashboard/page.html`
//
// The script's sections stay one script: vite-plugin-legacy.ts joins them, in the order of src/legacy/order.json, into
// one module, so they share one scope and run top to bottom as they did in page.html.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGACY = path.join(FRONT, "src", "legacy");

/** The script's sections, by the title of the divider that opens each ("" the part before the first): their files. */
export const SECTIONS = {
  "": "00-preamble.js",
  helpers: "01-helpers.js",
  data: "02-data.js",
  "ag's settings": "03-settings.js",
  "finished, not yet looked at": "04-seen.js",
  "the agent list": "05-agent-list.js",
  "the list folded, or over the whole page": "06-list-modes.js",
  panes: "07-panes.js",
  charts: "08-charts.js",
  "the selected agent": "09-selected-agent.js",
  "the chat": "10-chat.js",
  "code, coloured": "11-code.js",
  "the Transcript view": "12-transcript.js",
  "chat views": "13-chat-views.js",
  "the Terminal view": "14-terminal.js",
  "a shell": "15-shell.js",
  "the Files view": "16-files-view.js",
  "the History view": "17-history.js",
  "the Editor": "18-editor.js",
  DocWriter: "19-docwriter.js",
  "a Browser": "20-browser.js",
  start: "21-start.js",
};
const DIVIDER = /^\/\/ -{60,} (.+)$/;

/** The styles, cut where each of these comments opens a block at the top level: each part's file. */
export const STYLES = [
  [null, "00-base.css"],
  ["/* the page is the screen's height", "01-layout.css"],
  ["/* Panes: the actors open side by side", "02-panes.css"],
  ["/* The Transcript view:", "03-transcript.css"],
  ["/* the list's head, held at its top", "04-list.css"],
  ["/* the chat: all of the main view", "05-chat.css"],
  ["/* The Terminal view:", "06-terminal.css"],
  ["/* The Editor, above the panes", "07-editor.css"],
  ["/* DocWriter: a gatherer's button", "08-docwriter.css"],
  ["/* a Browser (browser.py)", "09-browser.css"],
  ["/* LaTeX (assets/src/editor/latex.mjs)", "10-editor-marks.css"],
  ["/* the Files view: a turn's files", "11-files-view.css"],
];

/** The page's script tag, where the split page has its two: the snapshot's data, and the module. */
const SNAPSHOT_LINE = "const SNAPSHOT = /*SNAPSHOT*/null;";
const SNAPSHOT_NOW =
  "const SNAPSHOT = window.AG_SNAPSHOT ?? null;            // a snapshot's data (index.html), or none";
const MODULE_TAGS = [
  "<script>window.AG_SNAPSHOT = /*SNAPSHOT*/null;</script>",
  '<script type="module" src="/src/main.ts"></script>',
];

function fail(message) {
  console.error(`split.mjs: ${message}`);
  process.exit(1);
}

/** Where each part of PAGE goes: [{file, from, to}] (0-based line indexes, `to` exclusive), and the lines. */
export function plan(text) {
  const lines = text.split("\n");
  const only = (line) => {
    const at = lines.reduce((got, l, i) => (l === line ? [...got, i] : got), []);
    if (at.length !== 1) fail(`expected one line "${line}" in the page, found ${at.length}`);
    return at[0];
  };
  const style = only("<style>"),
    styleEnd = only("</style>"),
    script = only("<script>"),
    scriptEnd = only("</script>");
  if (!(style < styleEnd && styleEnd < script && script < scriptEnd))
    fail("the page's style and script are out of order");
  const parts = [];

  // styles: from after <style> to before </style>, cut at the STYLES comments, each at the top level
  const cuts = STYLES.map(([marker, file]) => {
    if (marker === null) return { file, from: style + 1 };
    const at = lines.findIndex((l, i) => i > style && i < styleEnd && l.startsWith(marker));
    if (at < 0) fail(`the style comment "${marker}" is not in the page`);
    return { file, from: at };
  });
  for (let i = 0; i < cuts.length; i++) {
    const { file, from } = cuts[i];
    const to = i + 1 < cuts.length ? cuts[i + 1].from : styleEnd;
    if (to <= from) fail(`the style comments are out of order at ${file}`);
    if (depth(lines.slice(style + 1, from).join("\n")) !== 0) fail(`${file} would begin inside a rule`);
    parts.push({ kind: "css", file, from, to });
  }

  // the script: from after <script> to before </script>, cut at its section dividers
  const titles = [{ title: "", from: script + 1 }];
  for (let i = script + 1; i < scriptEnd; i++) {
    const m = DIVIDER.exec(lines[i]);
    if (m) titles.push({ title: m[1].trim(), from: i });
  }
  const seen = new Set();
  for (let i = 0; i < titles.length; i++) {
    const { title, from } = titles[i];
    const file = SECTIONS[title];
    if (!file) fail(`a section with no file: "${title}" (add it to SECTIONS)`);
    if (seen.has(file)) fail(`two sections "${title}"`);
    seen.add(file);
    parts.push({ kind: "js", file, from, to: i + 1 < titles.length ? titles[i + 1].from : scriptEnd });
  }
  const missing = Object.entries(SECTIONS).filter(([, f]) => !seen.has(f));
  if (missing.length) fail(`sections not in the page: ${missing.map(([t]) => `"${t}"`).join(", ")}`);

  // the markup: all the rest, the style and script taken out
  parts.push({
    kind: "html",
    file: "index.html",
    ranges: [
      [0, style],
      [styleEnd + 1, script],
      [scriptEnd + 1, lines.length],
    ],
  });
  return { lines, parts, script, scriptEnd };
}

/** How deep in braces `css` ends, its comments left out. */
function depth(css) {
  let d = 0;
  for (const c of css.replace(/\/\*[\s\S]*?\*\//g, "")) d += c === "{" ? 1 : c === "}" ? -1 : 0;
  return d;
}

/** The file each part of the page is written to, relative to frontend/. */
const target = (p) =>
  p.kind === "css" ? `src/legacy/css/${p.file}` : p.kind === "js" ? `src/legacy/${p.file}` : p.file;

/** The text of each file: {relative path: text}. */
export function files(text) {
  const { lines, parts } = plan(text);
  const out = {};
  for (const p of parts) {
    if (p.kind === "html") {
      const [[a0, a1], [b0, b1], [c0, c1]] = p.ranges;
      out[target(p)] = [...lines.slice(a0, a1), ...lines.slice(b0, b1), ...MODULE_TAGS, ...lines.slice(c0, c1)].join(
        "\n",
      );
      continue;
    }
    let body = lines.slice(p.from, p.to);
    if (p.file === "00-preamble.js") {
      const at = body.indexOf(SNAPSHOT_LINE);
      if (at < 0) fail(`the preamble has no "${SNAPSHOT_LINE}"`);
      body = body.map((l, i) => (i === at ? SNAPSHOT_NOW : l));
    }
    out[target(p)] = body.join("\n") + "\n";
  }
  const order = {
    css: parts.filter((p) => p.kind === "css").map((p) => p.file),
    js: parts.filter((p) => p.kind === "js").map((p) => p.file),
  };
  out["src/legacy/order.json"] = JSON.stringify(order, null, 2) + "\n";
  out["src/legacy/styles.ts"] =
    "// The page's styles, in page.html's order (src/legacy/order.json), so they cascade as they did.\n" +
    order.css.map((f) => `import "./css/${f}";`).join("\n") +
    "\n";
  return out;
}

/** Where line `n` of the page (0-based) is in the split files: {file, line} (0-based), or null (a tag that went). */
function locate(planned, n) {
  for (const p of planned.parts) {
    if (p.kind === "html") {
      let before = 0;
      for (const [a, b] of p.ranges) {
        if (n >= a && n < b)
          return { file: target(p), line: before + (n - a) + (a > planned.scriptEnd ? MODULE_TAGS.length : 0) };
        before += b - a;
      }
    } else if (n >= p.from && n < p.to) return { file: target(p), line: n - p.from };
  }
  return null;
}

/** DIFF, a unified diff of ag_dashboard/page.html made against PAGE, as a diff of the split files. */
export function port(diff, page) {
  const planned = plan(page);
  const out = new Map(); // file -> [hunk text]
  const shift = new Map(); // file -> lines the hunks so far added
  const lines = diff.split("\n");
  let inPage = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("diff --git ")) inPage = / a\/ag_dashboard\/page\.html /.test(l + " ");
    if (!inPage || !l.startsWith("@@")) continue;
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(l);
    if (!m) fail(`not a hunk header: ${l}`);
    const oldStart = Number(m[1]),
      oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const body = [];
    for (i++; i < lines.length && /^[ +\-\\]/.test(lines[i]) && !lines[i].startsWith("diff --git "); i++)
      body.push(lines[i]);
    i--;
    const first = locate(planned, Math.max(oldStart - 1, 0));
    const last = locate(planned, oldStart - 1 + Math.max(oldCount - 1, 0));
    if (!first || !last || first.file !== last.file) {
      fail(
        `the hunk at page.html line ${oldStart} spans ${first?.file ?? "a tag"} and ${last?.file ?? "a tag"}: move it by hand`,
      );
    }
    const newCount = body.filter((b) => b[0] === "+" || b[0] === " ").length;
    const added = shift.get(first.file) || 0;
    const start = first.line + 1;
    const head = `@@ -${oldCount ? start : start - 1},${oldCount} +${(oldCount ? start : start - 1) + added},${newCount} @@${m[5]}`;
    shift.set(first.file, added + newCount - oldCount);
    if (!out.has(first.file)) out.set(first.file, []);
    out.get(first.file).push([head, ...body].join("\n"));
  }
  if (!out.size) fail("no hunk of ag_dashboard/page.html in the diff");
  return [...out]
    .map(([file, hunks]) => `--- a/frontend/${file}\n+++ b/frontend/${file}\n${hunks.join("\n")}\n`)
    .join("");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const portAt = args.indexOf("--port");
  if (portAt >= 0) {
    const diff = fs.readFileSync(args[portAt + 1], "utf8");
    const rest = args.filter((_, i) => i !== portAt && i !== portAt + 1);
    const page = fs.readFileSync(rest[0] || path.join(FRONT, "..", "ag_dashboard", "page.html"), "utf8");
    process.stdout.write(port(diff, page));
  } else {
    const page = fs.readFileSync(args[0] || path.join(FRONT, "..", "ag_dashboard", "page.html"), "utf8");
    const written = files(page);
    fs.mkdirSync(path.join(LEGACY, "css"), { recursive: true });
    for (const [rel, text] of Object.entries(written)) fs.writeFileSync(path.join(FRONT, rel), text);
    console.log(`wrote ${Object.keys(written).length} files`);
  }
}
