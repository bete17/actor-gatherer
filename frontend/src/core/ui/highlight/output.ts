// What a call printed as HTML, as its terminal showed it: its colours (ANSI codes) kept, other escapes dropped, a line
// overwritten by its carriage returns (a progress bar) shown as it ended.
/* eslint-disable no-control-regex -- a terminal's escapes are control characters */
import { escapeHtml } from "../html";
import { hlLines } from "./highlight";

const ANSI_FG: Record<number, string> = {
  30: "dim",
  31: "red",
  32: "green",
  33: "yellow",
  34: "blue",
  35: "magenta",
  36: "cyan",
  37: "",
  90: "dim",
  91: "red",
  92: "green",
  93: "yellow",
  94: "blue",
  95: "magenta",
  96: "cyan",
  97: "",
};

export function ansiHtml(text: unknown): string {
  const t = String(text ?? "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => (l.includes("\r") ? l.split("\r").filter(Boolean).pop() || "" : l))
    .join("\n");
  if (!t.includes("\x1b")) return escapeHtml(t);
  let out = "",
    fg = "",
    bold = false,
    faint = false,
    last = 0;
  const seg = (s: string) => {
    const c = [fg && "a-" + fg, bold && "a-bold", faint && "a-dim"].filter(Boolean).join(" ");
    if (s) out += c ? `<span class="${c}">${escapeHtml(s)}</span>` : escapeHtml(s);
  };
  for (const m of t.matchAll(/\x1b\[([0-9;?]*)([ -/]*[@-~])/g)) {
    seg(t.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== "m") continue;
    const ps = (m[1] || "0").split(";").map(Number);
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      if (p === 0) {
        fg = "";
        bold = faint = false;
      } else if (p === 1) bold = true;
      else if (p === 2) faint = true;
      else if (p === 22) bold = faint = false;
      else if (p in ANSI_FG) fg = ANSI_FG[p];
      else if (p === 39) fg = "";
      else if (p === 38 || p === 48) k += ps[k + 1] === 5 ? 2 : ps[k + 1] === 2 ? 4 : 0; // 256 colours or true colour: not kept
    }
  }
  seg(t.slice(last));
  return out;
}

// What a call printed as HTML (ansiHtml); with no colours of its own, coloured as what it plainly is -- a diff (a git
// diff, show or log -p, a diff -u), JSON -- else as printed. `cmd`: the command that printed it.
const DIFF_CMD = /\b(?:git\s+(?:-C\s+\S+\s+)?(?:diff|show|log\s[^|;&]*-p|stash\s+show)|diff\s+-\w*u)\b/;

export function outputHtml(text: unknown, cmd?: string | null): string {
  const t = String(text ?? "");
  if (t.includes("\x1b") || t.length > 200000) return ansiHtml(t);
  const s = t.trim();
  if (/^[[{]/.test(s) && /[\]}]$/.test(s)) {
    try {
      JSON.parse(s);
      return hlLines(t, "json").join("\n");
    } catch {
      /* not JSON */
    }
  }
  if (cmd && DIFF_CMD.test(cmd)) {
    const ls = t.split("\n").filter(Boolean);
    if (ls.filter((l) => /^(?:[-+@ ]|diff |index |commit |Author:|Date:)/.test(l)).length >= ls.length * 0.6)
      return hlLines(t, "diff").join("\n");
  }
  return ansiHtml(t);
}
