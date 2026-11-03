// A shell command as HTML, easy to read and still the same command: coloured; a long one-liner broken after its steps
// (each &&, || and ;, a pipe once its line runs long), the lines continuing a step indented, as are do and then blocks;
// a heredoc's body set apart, coloured as the language it feeds; a path in the home folder from ~. The agent's own
// lines are kept as it wrote them.
import { escapeHtml } from "../html";
import { hlLines } from "./highlight";
import { SH_CLASS, shLex, type ShToken } from "./shell";

const SH_WIDE = 64,
  SH_PIPE = 72; // a first line longer than this is broken; a pipeline, at a pipe
const shCache = new Map<string, string>();

/** A path in the home folder (`home`) from ~. */
export const tildePath = (p: string, home: string | null | undefined): string => {
  const h = (home || "").replace(/\/$/, "");
  return h && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : p;
};

export function shellHtml(src: string, home: string | null | undefined): string {
  const key = `${home}\0${src}`;
  if (shCache.has(key)) return shCache.get(key)!;
  let toks: ShToken[];
  try {
    toks = shLex(src);
  } catch {
    toks = [["w", src, 0]];
  }
  const html = (cls: string, text: string, prev: ShToken | null | undefined) => {
    if ((cls === "w" || cls === "cmd") && (!prev || ["ws", "op", "nl"].includes(prev[0]))) text = tildePath(text, home);
    return SH_CLASS[cls] ? `<span class="hl-${SH_CLASS[cls]}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  const STEP = /^(?:&&|\|\||;|\||\|&|&)$/;
  const step = (t: ShToken) => t[2] === 0 && t[0] === "op" && STEP.test(t[1]);
  let head = toks.findIndex((t) => t[1].includes("\n"));
  if (head < 0) head = toks.length;
  const breaking = toks.slice(0, head).reduce((n, t) => n + t[1].length, 0) > SH_WIDE && toks.slice(0, head).some(step);
  const lines: { ind?: number; html?: string; here?: string }[] = []; // {ind, html} or {here}
  let line = "",
    ind = 0,
    blk = 0,
    len = 0,
    stop = false,
    from = 0; // from: the indent the step on this line began at
  const brk = (next: number) => {
    lines.push({ ind, html: line });
    line = "";
    len = 0;
    ind = next;
  };
  const cut = (next: number) => {
    if (line) brk(next);
    else ind = next;
  };
  const put = (t: ShToken, k: number) =>
    t[1].split("\n").forEach((part, n) => {
      if (n) brk(0);
      if (part) {
        line += html(t[0], part, n ? null : toks[k - 1]);
        len += part.length;
      }
    });
  const skipWs = (k: number) => {
    while (toks[k + 1] && toks[k + 1][0] === "ws") k++;
    return k;
  };
  const rest = (k: number) => {
    let n = 0;
    for (let j = k + 1; j < head && !step(toks[j]); j++) n += toks[j][1].length;
    return n;
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t[0] === "nl") {
      brk(0);
      continue;
    }
    if (t[0] === "here") {
      if (line) brk(0);
      lines.push({ here: hlLines(t[1].replace(/\n$/, ""), t[3]).join("\n") });
      continue;
    }
    if (k < head && breaking && !stop && step(t)) {
      const o = t[1];
      if (o === "&&" || o === "||" || o === "&") {
        put(t, k);
        k = skipWs(k);
        cut((from = o === "&" ? blk : blk + 1));
        continue;
      }
      if (o === ";") {
        const j = skipWs(k) + 1;
        const w = toks[j] && toks[j][0] === "kw" ? toks[j][1] : "";
        if (w === "do" || w === "then") {
          put(t, k);
          line += " ";
          put(toks[j], j);
          k = skipWs(j);
          cut((from = ++blk));
          continue;
        }
        if (w === "else") {
          cut(Math.max(0, blk - 1));
          put(toks[j], j);
          k = skipWs(j);
          cut((from = blk));
          continue;
        }
        if (["elif", "done", "fi", "esac", "}"].includes(w)) blk = Math.max(0, blk - 1);
        k = skipWs(k);
        cut((from = blk));
        continue;
      }
      if (len + rest(k) > SH_PIPE) {
        // a pipe, its line long: under its step, a level in
        put(t, k);
        k = skipWs(k);
        cut(from + 1);
        continue;
      }
    }
    if (t[0] === "op" && /^<<[^<]/.test(t[1])) stop = true; // its body starts at the line's end: not broken after it
    put(t, k);
  }
  if (line || !lines.length) brk(0);
  const got = lines
    .map((l, n) =>
      l.here !== undefined
        ? `<div class="sh-here">${l.here || "&#8203;"}</div>`
        : `<div class="sh-l${n ? "" : " p"}" style="--i:${l.ind}">${n ? "" : '<span class="sh-p" aria-hidden="true">$ </span>'}${l.html || "&#8203;"}</div>`,
    )
    .join("");
  if (shCache.size > 1000) shCache.clear();
  shCache.set(key, got);
  return got;
}
