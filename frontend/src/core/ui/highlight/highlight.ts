// Code, coloured: the highlighter, reading a text by its language's rules (languages.ts), or shell by shLex; its tokens
// as lines of HTML; and a part of a file read from inside the comment or string it begins in.
import { escapeHtml } from "../html";
import { guessWeb, HL, type Token } from "./languages";
import { SH_CLASS, shLex } from "./shell";

const HL_WS = /\s+/y,
  HL_CALL = /[ \t]*\(/y,
  HL_PLAIN = /\w+|[^\w\s]/y;

/** `text` as [class, text] tokens in `lang` ("" the class of plain text). */
export function hlTokens(text: string, lang: string): Token[] {
  if (lang === "shell")
    return shLex(text).flatMap(([cls, t, , l]): Token[] =>
      cls === "here" ? (l ? hlTokens(t, l) : [["", t]]) : [[SH_CLASS[cls] || "", t]],
    );
  const L = HL[lang],
    out: Token[] = [];
  const add = (cls: string, t: string) => {
    const p = out[out.length - 1];
    if (p && p[0] === cls) p[1] += t;
    else out.push([cls, t]);
  };
  let i = 0,
    def = false; // def: the next name is the one a def, class or function defines
  scan: while (i < text.length) {
    HL_WS.lastIndex = i;
    let m = HL_WS.exec(text);
    if (m) {
      add("", m[0]);
      i += m[0].length;
      continue;
    }
    for (const [re, cls] of L.rules) {
      re.lastIndex = i;
      m = re.exec(text);
      if (!m || !m[0]) continue;
      const w = m[0];
      if (typeof cls === "function") for (const t of cls(m, hlTokens)) add(t[0], t[1]);
      else if (cls !== "id") add(cls, w);
      else {
        // a name: a keyword, a literal, one defined or called -- not after a dot, a member
        const key = L.ci ? w.toLowerCase() : w,
          member = text[i - 1] === ".";
        HL_CALL.lastIndex = i + w.length;
        add(
          !member && L.kw && L.kw.has(key)
            ? "kw"
            : !member && L.lit && L.lit.has(key)
              ? "num"
              : def || HL_CALL.test(text)
                ? "fn"
                : "",
          w,
        );
        i += w.length;
        def = !member && !!(L.defs && L.defs.has(key));
        continue scan;
      }
      i += w.length;
      def = false;
      continue scan;
    }
    HL_PLAIN.lastIndex = i;
    m = HL_PLAIN.exec(text)!;
    add("", m[0]);
    i += m[0].length;
    def = false;
  }
  return out;
}

/** Tokens as lines of HTML, each whole in itself: a token over several lines closed at each line's end. */
export function tokenLines(toks: Token[]): string[] {
  const lines = [""];
  for (const [cls, t] of toks)
    t.split("\n").forEach((p, k) => {
      if (k) lines.push("");
      if (p) lines[lines.length - 1] += cls ? `<span class="hl-${cls}">${escapeHtml(p)}</span>` : escapeHtml(p);
    });
  return lines;
}

/**
 * `text` read as beginning inside `inside` (a comment's or a string's opening, "" none): the opening put before it,
 * and taken off the token it begins.
 */
export function hlTokensIn(text: string, lang: string, inside: string): Token[] {
  if (!inside) return hlTokens(text, lang);
  const toks = hlTokens(inside + text, lang);
  toks[0] = [toks[0][0], toks[0][1].slice(inside.length)];
  return toks[0][1] ? toks : toks.slice(1);
}

// A part of a file (lines read, a change, a search's hits) may begin inside a comment or a string opened above it,
// which then ends in it. Read from code, its words colour as code, and a string's closing quotes open one that runs on
// to the end. What it begins inside (one of the language's `inside`; "" none), told by the first closing of one in
// it: a comment's end (*/, -->) where code is read, or quotes the same at both ends (""", `) that close a string
// (quoteRole). Without one, code. Each of `texts` is the same place read on (a change's lines before and after it).
const HL_ENDS: Record<string, string> = { "/*": "*/", "<!--": "-->" };

export function hlInside(lang: string, ...texts: string[]): string {
  const L = HL[lang];
  if (!L || !L.inside) return "";
  for (const text of texts) {
    if (!text) continue;
    const toks: [string, string, number][] = []; // read from code: each token with where it starts
    let at = 0;
    for (const [cls, t] of hlTokens(text, lang)) {
      toks.push([cls, t, at]);
      at += t.length;
    }
    const tokAt = (p: number) => toks.find(([, t, a]) => p >= a && p < a + t.length)!;
    const lead = (t: string) => /^[A-Za-z]{0,2}/.exec(t)![0].length; // a string's prefix: r""" f"
    // a string that ends as it began ("**/*.js", '"""'), not one an apostrophe in a comment's words began
    const closed = (t: string) => {
      const s = t.slice(lead(t));
      return s.length > 1 && s.endsWith(s[0]);
    };
    let best: [number, string] | null = null; // [where its closing ends, the opening]
    for (const open of L.inside) {
      const end = HL_ENDS[open] || open;
      for (let p = text.indexOf(end); p >= 0; p = text.indexOf(end, p + 1)) {
        const [cls, t, a] = tokAt(p);
        if (cls === "com" || (cls === "str" && p !== a + lead(t) && closed(t))) continue; // in a comment, or a string
        const ends = HL_ENDS[open]
          ? // a comment's end with no opening before it, and a space after it: a regex's /a*/ has its flags
            !text.slice(0, p).includes(open) && !/\S/.test(text[p + end.length] || " ")
          : quoteRole(text, p, end) === "close";
        if (ends && (!best || p < best[0])) best = [p + end.length, open];
        break;
      }
    }
    // read from inside it, what it opens must run to that closing: none comes first (in a string, read from code)
    if (best) {
      const first = hlTokensIn(text, lang, best[1])[0];
      if (((first && first[1]) || "").length >= best[0]) return best[1];
    }
  }
  return "";
}

/**
 * Whether quotes the same at both ends (""", ''', `) at `p` open a string or close one, by what is around them: a
 * value's place before them (=, (, return) or words after them open one; words before them, or ), ; or . after them,
 * close one. Alone on their line, the line before says (a def's colon or a value's place opens one, words close it),
 * and on the first line, the one after (code: they closed one). null: no telling.
 */
export function quoteRole(text: string, p: number, q: string): "open" | "close" | null {
  const ls = text.lastIndexOf("\n", p - 1) + 1,
    le = text.indexOf("\n", p) < 0 ? text.length : text.indexOf("\n", p);
  const raw = text.slice(ls, p);
  if (q.length === 3 && /(?:^|[^\w])[rRbBuUfF]{1,2}$/.test(raw)) return "open"; // r""" b''' f"""
  const b = raw.trim(),
    a = text.slice(p + q.length, le).trim();
  // a script's template comes after a ternary's ? or an ||, a docstring's words may end with either; a backtick in a
  // regex (/`|\*\*/, [^`]) follows its marks
  if (q === "`" && /[/\\[^$|]$/.test(b)) return null;
  if (b)
    return (q === "`"
      ? /(?:[=(,[{:?+|&]|=>|\b(?:return|yield|await|in|of))$/
      : /(?:[=(,[{:+]|\b(?:return|yield|await))$/
    ).test(b)
      ? "open"
      : "close";
  if (a) return /^(?:[)\]},.;:+%#]|\/\/)/.test(a) ? "close" : "open";
  const prev = text
    .slice(0, ls)
    .split("\n")
    .reverse()
    .find((l) => l.trim());
  if (prev !== undefined) return /(?:[:=([{+]|=>)\s*$/.test(prev) ? "open" : "close";
  const next = text
    .slice(le + 1)
    .split("\n")
    .find((l) => l.trim());
  return next !== undefined && HL_CODE_LINE.test(next.trim()) ? "close" : null;
}
// a line that is plainly code, not words: a def, an import, an assignment, a call, a statement's end
const HL_CODE_LINE =
  /^(?:(?:async\s+)?def\s+\w+\s*\(|class\s+\w+|import\s+[\w.{*]|from\s+[\w.]+\s+import\b|@[\w.]+|(?:const|let|var)\s+[\w${[]|function\b|export\b|[\w.$[\]]+\s*(?:[-+*/%|&]|\*\*|\/\/)?=(?!=)|[\w.$]+\(.*\)[;,]?$|[})\]])|[;{]$/;

const hlCache = new Map<string, string[]>(),
  hlInCache = new Map<string, string>();

/**
 * `text` as HTML lines, coloured as `lang` (one hlLang gives; none: only escaped), read from inside `inside` if given
 * (hlInside). The same text colours the same.
 */
export function hlLines(text: unknown, lang: string | null | undefined, inside = ""): string[] {
  const s = String(text ?? "");
  if (!lang || !HL[lang] || s.length > 300000) return s.split("\n").map(escapeHtml);
  const k = lang + "\0" + inside + "\0" + s;
  let got = hlCache.get(k);
  if (!got) {
    try {
      got = tokenLines(hlTokensIn(s, lang, inside));
    } catch {
      got = s.split("\n").map(escapeHtml);
    }
    if (hlCache.size > 500) hlCache.clear();
    hlCache.set(k, got);
  }
  return got;
}

/**
 * A part of a file as HTML lines, coloured as the file's language (`lang`, langOfPath's; a web page's part as its
 * markup, style or script), read from inside the comment or string it begins in (hlInside). Each of `texts` is the
 * same place read on, so all begin inside the same: [the lines of each].
 */
export function hlPart(lang: string | null | undefined, ...texts: unknown[]): string[][] {
  const ts = texts.map((t) => String(t ?? ""));
  const L = lang === "html" ? guessWeb(ts.join("\n")) : lang,
    k = L + "\0" + ts.join("\0\0");
  let inside = hlInCache.get(k);
  if (inside === undefined && L && HL[L] && ts.every((t) => t.length <= 300000)) {
    try {
      inside = hlInside(L, ...ts);
    } catch {
      inside = "";
    }
    if (hlInCache.size > 500) hlInCache.clear();
    hlInCache.set(k, inside);
  }
  return ts.map((t) => hlLines(t, L, inside || ""));
}
