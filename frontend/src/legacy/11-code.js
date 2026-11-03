// ------------------------------------------------------------------ code, coloured
// A small highlighter of the page's own, for code in messages (fenced blocks), in files and in calls. Each language is
// a list of rules tried in turn at each place in the text -- a sticky regex and the class of what it matches, or a
// function making the tokens -- and word lists sorting its names. It colours what a reader scans for (comments,
// strings, numbers, keywords, a name defined or called) and leaves the rest in the text's own ink, as the NumPy docs
// do. Shell is read apart (shLex), as the shell reads it.
const words = (s) => new Set(s.split(" "));
const NUM = /(?:0[xX][\da-fA-F_]+|0[bBoO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[jJlLuUfFnm]*(?![\w$])/y;
const C_COMMENTS = [[/\/\/.*/y, "com"], [/\/\*[\s\S]*?(?:\*\/|$)/y, "com"]];
const QUOTED = [[/"(?:[^"\\\n]|\\.)*"?/y, "str"], [/'(?:[^'\\\n]|\\.)*'?/y, "str"]];
// a tag in HTML or XML: its name, its attributes' names and their quoted values
function tagTokens(m) {
  const t = m[0], name = /^<\/?[\w:.-]+/.exec(t)[0], out = [["tag", name]];
  const re = /("[^"]*"?|'[^']*'?)|([\w:.@-]+)(?=\s*=)|(\/?>$)|([\s\S])/g;
  re.lastIndex = name.length;
  for (let x; (x = re.exec(t));) out.push([x[1] ? "str" : x[2] ? "prop" : x[3] ? "tag" : "", x[0]]);
  return out;
}
const HL = {
  python: { rules: [[/#.*/y, "com"], [/[rRbBuUfF]{0,2}("""|''')[\s\S]*?(?:\1|$)/y, "str"], [/[rRbBuUfF]{0,2}(["'])(?:(?!\1)[^\\\n]|\\.)*\1?/y, "str"],
    [/@[A-Za-z_][\w.]*/y, "meta"], [NUM, "num"], [/[A-Za-z_]\w*/y, "id"]],
    kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"),
    lit: words("True False None"), defs: words("def class"), inside: ['"""', "'''"] },
  js: { rules: [...C_COMMENTS, [/`(?:[^`\\]|\\[\s\S])*`?/y, "str"], ...QUOTED, [/@[A-Za-z_][\w.]*/y, "meta"], [NUM, "num"], [/[A-Za-z_$][\w$]*/y, "id"]],
    kw: words("async await break case catch class const continue debugger default delete do else enum export extends finally for function if implements import in instanceof interface let new private protected public return static super switch throw try typeof var void while with yield"),
    lit: words("true false null undefined this NaN Infinity"), defs: words("function class interface enum"), inside: ["/*", "`"] },
  json: { rules: [[/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, "prop"], [/"(?:[^"\\\n]|\\.)*"?/y, "str"], [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, "num"], [/[A-Za-z_]\w*/y, "id"]],
    lit: words("true false null") },
  clike: { rules: [...C_COMMENTS, [/(?<=^[ \t]*)#[ \t]*[a-z]+/my, "meta"], [/#!?\[[^\]\n]*\]/y, "meta"], [/@[A-Za-z_]\w*/y, "meta"], [/"(?:[^"\\\n]|\\.)*"?/y, "str"],
    [/'(?:[^'\\\n]|\\.){1,8}'/y, "str"], [/`[^`]*`?/y, "str"], [NUM, "num"], [/[A-Za-z_]\w*/y, "id"]],
    kw: words("abstract async auto await break case catch char class const continue default defer do double dyn else enum extends extern final float fn for fun func go goto if impl implements import in inline int interface let long loop match mod move mut namespace new override package private protected pub public ref return short signed sizeof static struct super switch template throw throws trait try type typedef typename union unsafe unsigned use using val var virtual void volatile when where while yield"),
    lit: words("true false null nil NULL nullptr None Some Ok Err self Self this"), defs: words("fn func fun class struct enum trait impl interface type union"),
    inside: ["/*"] },
  toml: { rules: [[/#.*/y, "com"], [/(?<=^[ \t]*);.*/my, "com"], [/(?<=^[ \t]*)\[\[?[^\]\n]*\]\]?/my, "sec"], [/(?<=^[ \t]*)[\w.\-"' ]*?[\w"'](?=[ \t]*=)/my, "prop"],
    [/("""|''')[\s\S]*?(?:\1|$)/y, "str"], ...QUOTED, [/\d{4}-\d\d-\d\d(?:[T ][\d:.]+)?(?:Z|[+-]\d\d:\d\d)?/y, "num"], [/[+-]?(?:\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|inf|nan)\b/y, "num"],
    [/[A-Za-z_][\w-]*/y, "id"]],
    lit: words("true false"), inside: ['"""', "'''"] },
  yaml: { rules: [[/(?<=^|[ \t])#.*/my, "com"], [/(?<=^[ \t]*(?:-[ \t]+)*)(?:"[^"\n]*"|'[^'\n]*'|[^\s#'"\-?:,\[\]{}][^\n#]*?)(?=[ \t]*:(?:[ \t]|$))/my, "prop"],
    [/(?<=(?:^|[:\-,\[{])[ \t]*)(?:"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?)/my, "str"], [/[&*][\w-]+/y, "meta"], [/(?<=^)(?:---|\.\.\.)$/my, "meta"], [NUM, "num"], [/[A-Za-z_][\w-]*/y, "id"]],
    lit: words("true false null True False Null") },
  md: { rules: [[/(?<=^[ \t]{0,3})#{1,6}[ \t].*/my, "sec"], [/(?<=^[ \t]*)(?:```|~~~).*/my, "meta"], [/<!--[\s\S]*?(?:-->|$)/y, "com"], [/(?<=^[ \t]*)>.*/my, "com"],
    [/(?<=^[ \t]*)(?:[-*+]|\d+[.)])(?=[ \t])/my, "kw"], [/`[^`\n]+`/y, "str"], [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, "b"], [/\[[^\]\n]*\]\([^)\n]*\)/y, "fn"]], inside: ["<!--"] },
  html: { rules: [[/<!--[\s\S]*?(?:-->|$)/y, "com"], [/<![A-Za-z][^>]*>?/y, "meta"], [/<\/?[A-Za-z][\w:.-]*(?:[^>"']|"[^"]*"|'[^']*')*>?/y, tagTokens], [/&#?\w+;/y, "num"]], inside: ["<!--"] },
  css: { rules: [[/\/\*[\s\S]*?(?:\*\/|$)/y, "com"], ...QUOTED, [/@[\w-]+/y, "kw"], [/-{0,2}[A-Za-z_][\w-]*(?=[ \t]*:[^{};\n]*(?:[;}]|$))/my, "prop"], [/--[\w-]+/y, "prop"],
    [/#[\da-fA-F]{3,8}(?![\w-])/y, "num"], [/-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/y, "num"], [/!important\b/y, "kw"], [/[A-Za-z_-][\w-]*/y, "id"]], inside: ["/*"] },
  sql: { rules: [[/--.*/y, "com"], [/\/\*[\s\S]*?(?:\*\/|$)/y, "com"], [/'(?:[^']|'')*'?/y, "str"], [NUM, "num"], [/[A-Za-z_]\w*/y, "id"]], ci: true,
    kw: words("all alter and as asc begin between by case check collate commit create cross default delete desc distinct drop else end exists explain foreign from glob group having if ignore in index inner insert into is join key left like limit not null offset on or order outer pragma primary recursive references replace returning right rollback select set table then transaction trigger union unique update using vacuum values view when where with"),
    lit: words("true false"), inside: ["/*"] },
  diff: { rules: [[/^(?:\+\+\+|---|\*\*\*|diff |index ).*/my, "meta"], [/^@@.*/my, "fn"], [/^\+.*/my, "add"], [/^-.*/my, "del"], [/.+/y, ""]] },
  console: { rules: [[/^[$%] .*/my, (m) => [["sp", m[0].slice(0, 2)], ...hlTokens(m[0].slice(2), "shell")]], [/.+/y, ""]] },   // a session: its commands after their prompts
  shell: {},                                                                                                                   // read by shLex
};
const HL_ALIASES = { py: "python", python3: "python", pyi: "python", pyw: "python", javascript: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", typescript: "js",
  tsx: "js", mts: "js", cts: "js", node: "js", jsonc: "json", jsonl: "json", json5: "json", ipynb: "json", geojson: "json",
  sh: "shell", bash: "shell", zsh: "shell", ksh: "shell", shellscript: "shell", "shell-session": "console", shellsession: "console", terminal: "console",
  ini: "toml", cfg: "toml", conf: "toml", properties: "toml", editorconfig: "toml", yml: "yaml", markdown: "md", mdx: "md",
  htm: "html", xhtml: "html", xml: "html", svg: "html", vue: "html", plist: "html", scss: "css", less: "css",
  sqlite: "sql", sqlite3: "sql", psql: "sql", postgres: "sql", postgresql: "sql", mysql: "sql", patch: "diff", udiff: "diff",
  c: "clike", h: "clike", cc: "clike", cpp: "clike", cxx: "clike", hpp: "clike", hh: "clike", "c++": "clike", java: "clike", go: "clike", golang: "clike",
  rs: "clike", rust: "clike", swift: "clike", kt: "clike", kts: "clike", kotlin: "clike", cs: "clike", csharp: "clike", scala: "clike", dart: "clike", zig: "clike" };
// the language a name stands for (a fenced block's, a file's extension); null: none known, shown as written
const hlLang = (name) => { const n = String(name || "").toLowerCase(); return Object.hasOwn(HL, n) ? n : Object.hasOwn(HL_ALIASES, n) ? HL_ALIASES[n] : null; };
const SHELL_FILES = words(".bashrc .zshrc .profile .bash_profile .zprofile .zshenv .envrc");
function langOfPath(p) {
  const name = String(p || "").replace(/^['"]|['"]$/g, "").split("/").pop(), dot = name.lastIndexOf(".");
  return SHELL_FILES.has(name) ? "shell" : dot > 0 ? hlLang(name.slice(dot + 1)) : null;
}
// A piece of a web page, read by itself (a file's lines, a change): its markup, its style or its script -- the page
// itself (page.html) is mostly the last two
function guessWeb(text) {
  let tag = 0, css = 0, js = 0;
  for (const l of text.split("\n")) {
    const s = l.trim();
    if (!s) continue;
    if (/^(?:const|let|var|function|return|if|for|while|async|await|class|import|export|else|try|catch|throw|switch|case)\b|=>|^\}|^\/\/|[=(]\s*$/.test(s)) js++;
    else if (/^<\/?[A-Za-z!]/.test(s)) tag++;
    else if (/^[.#:\[*>@&\w][^{}=]*\{\s*(?:-{0,2}[\w-]+\s*:|\}?$)|^-{0,2}[\w-]+\s*:\s*[^{}]*;\s*\}?\s*$|^\/\*/.test(s)) css++;
    else if (/[;{]\s*$/.test(s)) js++;
  }
  return tag && tag >= Math.max(css, js) ? "html" : css > js ? "css" : "js";
}
const HL_WS = /\s+/y, HL_CALL = /[ \t]*\(/y, HL_PLAIN = /\w+|[^\w\s]/y;
// `text` as [class, text] tokens in `lang` ("" the class of plain text)
function hlTokens(text, lang) {
  if (lang === "shell") return shLex(text).flatMap(([cls, t, , l]) => cls === "here" ? (l ? hlTokens(t, l) : [["", t]]) : [[SH_CLASS[cls] || "", t]]);
  const L = HL[lang], out = [];
  const add = (cls, t) => { const p = out[out.length - 1]; if (p && p[0] === cls) p[1] += t; else out.push([cls, t]); };
  let i = 0, def = false;                            // def: the next name is the one a def, class or function defines
  scan: while (i < text.length) {
    HL_WS.lastIndex = i;
    let m = HL_WS.exec(text);
    if (m) { add("", m[0]); i += m[0].length; continue; }
    for (const [re, cls] of L.rules) {
      re.lastIndex = i;
      m = re.exec(text);
      if (!m || !m[0]) continue;
      const w = m[0];
      if (typeof cls === "function") for (const t of cls(m)) add(t[0], t[1]);
      else if (cls !== "id") add(cls, w);
      else {                                         // a name: a keyword, a literal, one defined or called -- not after a dot, a member
        const key = L.ci ? w.toLowerCase() : w, member = text[i - 1] === ".";
        HL_CALL.lastIndex = i + w.length;
        add(!member && L.kw && L.kw.has(key) ? "kw" : !member && L.lit && L.lit.has(key) ? "num" : def || HL_CALL.test(text) ? "fn" : "", w);
        i += w.length;
        def = !member && !!(L.defs && L.defs.has(key));
        continue scan;
      }
      i += w.length; def = false;
      continue scan;
    }
    HL_PLAIN.lastIndex = i; m = HL_PLAIN.exec(text);
    add("", m[0]); i += m[0].length; def = false;
  }
  return out;
}
// tokens as lines of HTML, each whole in itself: a token over several lines closed at each line's end
function tokenLines(toks) {
  const lines = [""];
  for (const [cls, t] of toks) t.split("\n").forEach((p, k) => {
    if (k) lines.push("");
    if (p) lines[lines.length - 1] += cls ? `<span class="hl-${cls}">${escapeHtml(p)}</span>` : escapeHtml(p);
  });
  return lines;
}
// `text` read as beginning inside `inside` (a comment's or a string's opening, "" none): the opening put before it,
// and taken off the token it begins
function hlTokensIn(text, lang, inside) {
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
const HL_ENDS = { "/*": "*/", "<!--": "-->" };
function hlInside(lang, ...texts) {
  const L = HL[lang];
  if (!L || !L.inside) return "";
  for (const text of texts) {
    if (!text) continue;
    const toks = [];                                 // read from code: each token with where it starts
    let at = 0;
    for (const [cls, t] of hlTokens(text, lang)) { toks.push([cls, t, at]); at += t.length; }
    const tokAt = (p) => toks.find(([, t, a]) => p >= a && p < a + t.length);
    const lead = (t) => /^[A-Za-z]{0,2}/.exec(t)[0].length;   // a string's prefix: r""" f"
    // a string that ends as it began ("**/*.js", '"""'), not one an apostrophe in a comment's words began
    const closed = (t) => { const s = t.slice(lead(t)); return s.length > 1 && s.endsWith(s[0]); };
    let best = null;                                 // [where its closing ends, the opening]
    for (const open of L.inside) {
      const end = HL_ENDS[open] || open;
      for (let p = text.indexOf(end); p >= 0; p = text.indexOf(end, p + 1)) {
        const [cls, t, a] = tokAt(p);
        if (cls === "com" || (cls === "str" && p !== a + lead(t) && closed(t))) continue;   // in a comment, or a string
        const ends = HL_ENDS[open]
          // a comment's end with no opening before it, and a space after it: a regex's /a*/ has its flags
          ? !text.slice(0, p).includes(open) && !/\S/.test(text[p + end.length] || " ")
          : quoteRole(text, p, end) === "close";
        if (ends && (!best || p < best[0])) best = [p + end.length, open];
        break;
      }
    }
    // read from inside it, what it opens must run to that closing: none comes first (in a string, read from code)
    if (best && ((hlTokensIn(text, lang, best[1])[0] || [])[1] || "").length >= best[0]) return best[1];
  }
  return "";
}
// Whether quotes the same at both ends (""", ''', `) at `p` open a string or close one, by what is around them: a
// value's place before them (=, (, return) or words after them open one; words before them, or ), ; or . after them,
// close one. Alone on their line, the line before says (a def's colon or a value's place opens one, words close it),
// and on the first line, the one after (code: they closed one). null: no telling.
function quoteRole(text, p, q) {
  const ls = text.lastIndexOf("\n", p - 1) + 1, le = text.indexOf("\n", p) < 0 ? text.length : text.indexOf("\n", p);
  const raw = text.slice(ls, p);
  if (q.length === 3 && /(?:^|[^\w])[rRbBuUfF]{1,2}$/.test(raw)) return "open";      // r""" b''' f"""
  const b = raw.trim(), a = text.slice(p + q.length, le).trim();
  // a script's template comes after a ternary's ? or an ||, a docstring's words may end with either; a backtick in a
  // regex (/`|\*\*/, [^`]) follows its marks
  if (q === "`" && /[/\\[^$|]$/.test(b)) return null;
  if (b) return (q === "`" ? /(?:[=(,[{:?+|&]|=>|\b(?:return|yield|await|in|of))$/ : /(?:[=(,[{:+]|\b(?:return|yield|await))$/).test(b) ? "open" : "close";
  if (a) return /^(?:[)\]},.;:+%#]|\/\/)/.test(a) ? "close" : "open";
  const prev = text.slice(0, ls).split("\n").reverse().find((l) => l.trim());
  if (prev !== undefined) return /(?:[:=([{+]|=>)\s*$/.test(prev) ? "open" : "close";
  const next = text.slice(le + 1).split("\n").find((l) => l.trim());
  return next !== undefined && HL_CODE_LINE.test(next.trim()) ? "close" : null;
}
// a line that is plainly code, not words: a def, an import, an assignment, a call, a statement's end
const HL_CODE_LINE = /^(?:(?:async\s+)?def\s+\w+\s*\(|class\s+\w+|import\s+[\w.{*]|from\s+[\w.]+\s+import\b|@[\w.]+|(?:const|let|var)\s+[\w${[]|function\b|export\b|[\w.$[\]]+\s*(?:[-+*/%|&]|\*\*|\/\/)?=(?!=)|[\w.$]+\(.*\)[;,]?$|[})\]])|[;{]$/;
const hlCache = new Map(), hlInCache = new Map();
// `text` as HTML lines, coloured as `lang` (one hlLang gives; none: only escaped), read from inside `inside` if given
// (hlInside). The same text colours the same.
function hlLines(text, lang, inside = "") {
  text = String(text ?? "");
  if (!lang || !HL[lang] || text.length > 300000) return text.split("\n").map(escapeHtml);
  const k = lang + "\0" + inside + "\0" + text;
  let got = hlCache.get(k);
  if (!got) {
    try { got = tokenLines(hlTokensIn(text, lang, inside)); } catch (e) { got = text.split("\n").map(escapeHtml); }
    if (hlCache.size > 500) hlCache.clear();
    hlCache.set(k, got);
  }
  return got;
}
// A part of a file as HTML lines, coloured as the file's language (`lang`, langOfPath's; a web page's part as its
// markup, style or script), read from inside the comment or string it begins in (hlInside). Each of `texts` is the
// same place read on, so all begin inside the same: [the lines of each].
function hlPart(lang, ...texts) {
  texts = texts.map((t) => String(t ?? ""));
  const L = lang === "html" ? guessWeb(texts.join("\n")) : lang, k = L + "\0" + texts.join("\0\0");
  let inside = hlInCache.get(k);
  if (inside === undefined && L && HL[L] && texts.every((t) => t.length <= 300000)) {
    try { inside = hlInside(L, ...texts); } catch (e) { inside = ""; }
    if (hlInCache.size > 500) hlInCache.clear();
    hlInCache.set(k, inside);
  }
  return texts.map((t) => hlLines(t, L, inside || ""));
}
const shellSpan = (text) => { const s = el("span", { class: "sh-t" }); s.innerHTML = hlLines(text, "shell").join("\n"); return s; };

// Shell, read as the shell reads it: words, quotes, variables, substitutions ($(…), `…`), operators, redirections and
// heredocs, each body's language guessed from the command it feeds. Each token [class, text, depth, a body's language]:
// depth, how deep in parentheses and substitutions -- the command's own steps are at 0. A word naming a command is
// "cmd", one starting with - a "flag", a name before = (an assignment) a "var".
const SH_KW = words("if then else elif fi for do done while until case esac function select time ! { } [[");
const SH_NEXT = words("if then else elif do while until ! time {");            // a command's name comes after these
const SH_WRAP = words("sudo env exec nohup xargs command builtin nice watch");   // ...and after these, past their flags
const SH_WRAP_ARG = { env: words("-u -C -S"), sudo: words("-u -g -C -h -p -U"), nice: words("-n"), xargs: words("-I -n -P -L -s -d -E -a"), watch: words("-n") };   // flags taking a word
const SH_CLASS = { cmd: "cmd", kw: "kw", op: "op", str: "str", var: "var", com: "com", flag: "flag" };
// a heredoc body's language: the interpreter reading it (python - <<EOF), else the file it is written to (cat > x.py <<EOF)
function hereLang(ws, target) {
  const name = (ws.find((w) => !/^\w+=/.test(w) && !w.startsWith("-") && !SH_WRAP.has(w.split("/").pop())) || "").split("/").pop();
  if (/^i?python[\d.]*$/.test(name)) return "python";
  if (/^(?:node|deno|bun)$/.test(name)) return "js";
  if (/^(?:sqlite3?|psql|mysql|duckdb)$/.test(name)) return "sql";
  if (/^(?:ba|z|k|da)?sh$/.test(name)) return "shell";
  return target ? langOfPath(target) : null;
}
function shLex(src) {
  const out = [], pending = [];                      // pending: the heredocs started on this line, their bodies after it
  let i = 0, cmd = true, redir = false, wrapped = "", arg = false, at = { words: [], target: null };   // at: the command being read; wrapped: the wrapper before it
  const push = (cls, text, depth, lang) => { if (text) out.push([cls, text, depth, lang]); };
  const take = (re) => { re.lastIndex = i; const m = re.exec(src); if (m && m[0]) i += m[0].length; return m && m[0] ? m : null; };
  const next = () => { cmd = true; redir = arg = false; wrapped = ""; at = { words: [], target: null }; };
  const bodies = (depth) => {
    while (pending.length) {
      const h = pending.shift(), lang = hereLang(h.at.words, h.at.target);
      let body = "";
      for (;;) {
        if (i >= src.length) { push("here", body, depth, lang); return; }   // its end clipped off
        const j = src.indexOf("\n", i), end = j < 0 ? src.length : j, line = src.slice(i, end);
        if ((h.strip ? line.replace(/^\t+/, "") : line) === h.delim) {
          push("here", body, depth, lang); push("op", line, depth);
          i = pending.length ? Math.min(src.length, end + 1) : end;      // the next body starts on the next line
          break;
        }
        body += line + (j < 0 ? "" : "\n");
        i = j < 0 ? src.length : j + 1;
      }
    }
  };
  // inside $( … ), ( … ) or ` … `: commands of their own, up to the close
  const sub = (depth, close) => {
    const keep = [at, redir, wrapped];
    next();
    lex(depth, close);
    if (src[i] === close) { push("op", close, depth - 1); i++; }
    [at, redir, wrapped] = keep;
    cmd = false;
  };
  const dollar = (depth) => {
    const from = i;
    if (src.startsWith("$((", i)) { const j = src.indexOf("))", i + 3); i = j < 0 ? src.length : j + 2; push("var", src.slice(from, i), depth); return; }
    if (src[i + 1] === "(") { i += 2; push("op", "$(", depth); sub(depth + 1, ")"); return; }
    if (src[i + 1] === "{") { const j = src.indexOf("}", i + 2); i = j < 0 ? src.length : j + 1; push("var", src.slice(from, i), depth); return; }
    if (take(/\$(?:[A-Za-z_]\w*|[0-9@*#?$!-])/y)) push("var", src.slice(from, i), depth);
    else { i++; push("w", "$", depth); }
  };
  const tick = (depth) => { push("op", "`", depth); i++; sub(depth + 1, "`"); };
  const dq = (depth) => {                            // "…": its variables and substitutions read inside it
    let from = i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "$" && /[({\w@*#?$!]/.test(src[i + 1] || "")) { push("str", src.slice(from, i), depth); dollar(depth); from = i; continue; }
      if (src[i] === "`") { push("str", src.slice(from, i), depth); tick(depth); from = i; continue; }
      i++;
    }
    i = Math.min(src.length, i + 1);
    push("str", src.slice(from, i), depth);
  };
  const flag = (k, head, depth) => { const e = head[1].indexOf("="); if (e < 0) head[0] = "flag"; else out.splice(k, 1, ["flag", head[1].slice(0, e), depth], ["w", head[1].slice(e), depth]); };
  const word = (depth, close) => {
    const start = out.length, begin = i, wasCmd = cmd, target = redir;
    cmd = redir = false;
    while (i < src.length) {
      const c = src[i], from = i;
      if (" \t\n|&;()<>".includes(c) || (c === "`" && close === "`")) break;
      if (c === "'") { const j = src.indexOf("'", i + 1); i = j < 0 ? src.length : j + 1; push("str", src.slice(from, i), depth); }
      else if (c === "$" && src[i + 1] === "'") { take(/\$'(?:[^'\\]|\\[\s\S])*'?/y); push("str", src.slice(from, i), depth); }
      else if (c === '"') dq(depth);
      else if (c === "$") dollar(depth);
      else if (c === "`") tick(depth);
      else if (c === "\\") { i = Math.min(src.length, i + 2); push("w", src.slice(from, i), depth); }
      else { take(/[^ \t\n|&;()<>'"$`\\]+/y); push("w", src.slice(from, i), depth); }
    }
    if (i === begin) { i++; push("w", src[begin], depth); }
    const raw = src.slice(begin, i), head = out[start];
    if (head && head[0] === "w" && wasCmd) {
      if (out.length === start + 1 && SH_KW.has(raw)) { head[0] = "kw"; cmd = SH_NEXT.has(raw); return; }
      const name = /^[A-Za-z_]\w*(?=\+?=)/.exec(head[1]);
      if (name) { out.splice(start, 1, ...[["var", name[0], depth], ["w", head[1].slice(name[0].length), depth]].filter((t) => t[1])); cmd = true; return; }
      if (arg) { arg = false; cmd = true; return; }                      // a wrapper's flag's word (env -u NAME)
      if (wrapped && head[1].startsWith("-")) { flag(start, head, depth); arg = !!(SH_WRAP_ARG[wrapped] && SH_WRAP_ARG[wrapped].has(raw)); cmd = true; return; }
      head[0] = "cmd";
      at.words.push(raw);
      wrapped = SH_WRAP.has(raw.split("/").pop()) ? raw.split("/").pop() : "";
      cmd = !!wrapped;
      return;
    }
    if (head && head[0] === "w" && head[1].startsWith("-")) flag(start, head, depth);
    if (target || (at.words[0] && at.words[0].split("/").pop() === "tee" && !raw.startsWith("-"))) at.target = raw;
    at.words.push(raw);
  };
  const lex = (depth, close) => {
    while (i < src.length) {
      const c = src[i], from = i;
      let m;
      if (close && c === close) return;
      if (c === "\n") { i++; push("nl", "\n", depth); bodies(depth); next(); continue; }
      if (c === " " || c === "\t") { take(/[ \t]+/y); push("ws", src.slice(from, i), depth); continue; }
      if (c === "\\" && src[i + 1] === "\n") { i += 2; push("ws", "\\\n", depth); continue; }
      if (c === "#") { take(/#[^\n]*/y); push("com", src.slice(from, i), depth); continue; }
      if ((m = take(/<<(-?)[ \t]*\\?(['"]?)([A-Za-z_][\w.-]*)\2/y))) { push("op", m[0], depth); pending.push({ delim: m[3], strip: !!m[1], at }); continue; }
      if (take(/\d*(?:<<<|&>>|&>|>>|>&|<&|>\||<>|>|<)(?:&?\d+-?|&-)?/y)) { const r = src.slice(from, i); push("op", r, depth); redir = !/&(?:\d+-?|-)$/.test(r); continue; }
      if (take(/&&|\|\||;;&?|;&|\|&|[|;&]/y)) { push("op", src.slice(from, i), depth); next(); continue; }
      if (c === "(") { i++; push("op", "(", depth); sub(depth + 1, ")"); continue; }
      if (c === ")" || c === "`") { i++; push("op", c, depth); continue; }   // with nothing open
      word(depth, close);
    }
  };
  lex(0, null);
  return out;
}
// A shell command as HTML, easy to read and still the same command: coloured; a long one-liner broken after its steps
// (each &&, || and ;, a pipe once its line runs long), the lines continuing a step indented, as are do and then blocks;
// a heredoc's body set apart, coloured as the language it feeds; a path in the home folder from ~. The agent's own
// lines are kept as it wrote them.
const SH_WIDE = 64, SH_PIPE = 72;                    // a first line longer than this is broken; a pipeline, at a pipe
const shCache = new Map();
const tildePath = (p, home) => { const h = (home || "").replace(/\/$/, ""); return h && (p === h || p.startsWith(h + "/")) ? "~" + p.slice(h.length) : p; };
function shellHtml(src, home) {
  const key = home + "\0" + src;
  if (shCache.has(key)) return shCache.get(key);
  let toks;
  try { toks = shLex(src); } catch (e) { toks = [["w", src, 0]]; }
  const html = (cls, text, prev) => {
    if ((cls === "w" || cls === "cmd") && (!prev || ["ws", "op", "nl"].includes(prev[0]))) text = tildePath(text, home);
    return SH_CLASS[cls] ? `<span class="hl-${SH_CLASS[cls]}">${escapeHtml(text)}</span>` : escapeHtml(text);
  };
  const STEP = /^(?:&&|\|\||;|\||\|&|&)$/;
  const step = (t) => t[2] === 0 && t[0] === "op" && STEP.test(t[1]);
  let head = toks.findIndex((t) => t[1].includes("\n"));
  if (head < 0) head = toks.length;
  const breaking = toks.slice(0, head).reduce((n, t) => n + t[1].length, 0) > SH_WIDE && toks.slice(0, head).some(step);
  const lines = [];                                  // {ind, html} or {here}
  let line = "", ind = 0, blk = 0, len = 0, stop = false, from = 0;   // from: the indent the step on this line began at
  const brk = (next) => { lines.push({ ind, html: line }); line = ""; len = 0; ind = next; };
  const cut = (next) => { if (line) brk(next); else ind = next; };
  const put = (t, k) => t[1].split("\n").forEach((part, n) => {
    if (n) brk(0);
    if (part) { line += html(t[0], part, n ? null : toks[k - 1]); len += part.length; }
  });
  const skipWs = (k) => { while (toks[k + 1] && toks[k + 1][0] === "ws") k++; return k; };
  const rest = (k) => { let n = 0; for (let j = k + 1; j < head && !step(toks[j]); j++) n += toks[j][1].length; return n; };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t[0] === "nl") { brk(0); continue; }
    if (t[0] === "here") { if (line) brk(0); lines.push({ here: hlLines(t[1].replace(/\n$/, ""), t[3]).join("\n") }); continue; }
    if (k < head && breaking && !stop && step(t)) {
      const o = t[1];
      if (o === "&&" || o === "||" || o === "&") { put(t, k); k = skipWs(k); cut(from = o === "&" ? blk : blk + 1); continue; }
      if (o === ";") {
        let j = skipWs(k) + 1;
        const w = toks[j] && toks[j][0] === "kw" ? toks[j][1] : "";
        if (w === "do" || w === "then") { put(t, k); line += " "; put(toks[j], j); k = skipWs(j); cut(from = ++blk); continue; }
        if (w === "else") { cut(Math.max(0, blk - 1)); put(toks[j], j); k = skipWs(j); cut(from = blk); continue; }
        if (["elif", "done", "fi", "esac", "}"].includes(w)) blk = Math.max(0, blk - 1);
        k = skipWs(k); cut(from = blk); continue;
      }
      if (len + rest(k) > SH_PIPE) { put(t, k); k = skipWs(k); cut(from + 1); continue; }   // a pipe, its line long: under its step, a level in
    }
    if (t[0] === "op" && /^<<[^<]/.test(t[1])) stop = true;   // its body starts at the line's end: not broken after it
    put(t, k);
  }
  if (line || !lines.length) brk(0);
  const got = lines.map((l, n) => l.here !== undefined ? `<div class="sh-here">${l.here || "&#8203;"}</div>`
    : `<div class="sh-l${n ? "" : " p"}" style="--i:${l.ind}">${n ? "" : '<span class="sh-p" aria-hidden="true">$ </span>'}${l.html || "&#8203;"}</div>`).join("");
  if (shCache.size > 1000) shCache.clear();
  shCache.set(key, got);
  return got;
}
// What a call printed as HTML, as its terminal showed it: its colours (ANSI codes) kept, other escapes dropped, a line
// overwritten by its carriage returns (a progress bar) shown as it ended.
const ANSI_FG = { 30: "dim", 31: "red", 32: "green", 33: "yellow", 34: "blue", 35: "magenta", 36: "cyan", 37: "", 90: "dim", 91: "red", 92: "green",
  93: "yellow", 94: "blue", 95: "magenta", 96: "cyan", 97: "" };
function ansiHtml(text) {
  const t = String(text ?? "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g, "").replace(/\r\n/g, "\n")
    .split("\n").map((l) => l.includes("\r") ? l.split("\r").filter(Boolean).pop() || "" : l).join("\n");
  if (!t.includes("\x1b")) return escapeHtml(t);
  let out = "", fg = "", bold = false, faint = false, last = 0;
  const seg = (s) => {
    const c = [fg && "a-" + fg, bold && "a-bold", faint && "a-dim"].filter(Boolean).join(" ");
    if (s) out += c ? `<span class="${c}">${escapeHtml(s)}</span>` : escapeHtml(s);
  };
  for (const m of t.matchAll(/\x1b\[([0-9;?]*)([ -\/]*[@-~])/g)) {
    seg(t.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] !== "m") continue;
    const ps = (m[1] || "0").split(";").map(Number);
    for (let k = 0; k < ps.length; k++) {
      const p = ps[k];
      if (p === 0) { fg = ""; bold = faint = false; }
      else if (p === 1) bold = true; else if (p === 2) faint = true; else if (p === 22) bold = faint = false;
      else if (p in ANSI_FG) fg = ANSI_FG[p]; else if (p === 39) fg = "";
      else if (p === 38 || p === 48) k += ps[k + 1] === 5 ? 2 : ps[k + 1] === 2 ? 4 : 0;   // 256 colours or true colour: not kept
    }
  }
  seg(t.slice(last));
  return out;
}
// What a call printed as HTML (ansiHtml); with no colours of its own, coloured as what it plainly is -- a diff (a git
// diff, show or log -p, a diff -u), JSON -- else as printed. `cmd`: the command that printed it.
const DIFF_CMD = /\b(?:git\s+(?:-C\s+\S+\s+)?(?:diff|show|log\s[^|;&]*-p|stash\s+show)|diff\s+-\w*u)\b/;
function outputHtml(text, cmd) {
  const t = String(text ?? "");
  if (t.includes("\x1b") || t.length > 200000) return ansiHtml(t);
  const s = t.trim();
  if (/^[\[{]/.test(s) && /[\]}]$/.test(s)) { try { JSON.parse(s); return hlLines(t, "json").join("\n"); } catch (e) { /* not JSON */ } }
  if (cmd && DIFF_CMD.test(cmd)) {
    const ls = t.split("\n").filter(Boolean);
    if (ls.filter((l) => /^(?:[-+@ ]|diff |index |commit |Author:|Date:)/.test(l)).length >= ls.length * 0.6) return hlLines(t, "diff").join("\n");
  }
  return ansiHtml(t);
}
// A fenced block in a message: coloured when it names a language the highlighter knows (```python), as written
// otherwise -- most unnamed ones are diagrams and output -- with a button copying it. Each line a row of its own (cf-l),
// so Chat can wrap it in the box rather than scroll it sideways, what a line wraps onto indented under where it begins
// (--in, its own indent). Each row but the last ends in its line break: a copy of what is selected keeps the empty lines.
// A block of more than CODE_FOLDS lines can be folded to its first six rows (Fold; codeFolded keeps it so).
const CODE_FOLDS = 8;
const codeFolded = new Set();                      // the blocks folded by a click, by their texts (codeKey)
const codeKey = (t) => { let h = 0x811c9dc5; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36) + "-" + t.length; };
const indentOf = (l) => { let n = 0; for (const c of l) { if (c === " ") n++; else if (c === "\t") n += 4 - n % 4; else break; } return Math.min(n, 24); };
function codeFence(text, lang) {
  text = String(text ?? "");
  const raw = text.split("\n"), ls = hlLines(text, hlLang(String(lang || "").split(/\s/)[0]));
  const rows = ls.map((h, i) => `<span class="cf-l" style="--in:${indentOf(raw[i] || "")}">${h}${i < ls.length - 1 ? "\n" : ""}</span>`).join("");
  const long = ls.length > CODE_FOLDS;
  return `<div class="code-box"${long ? ` data-fold="${codeKey(text)}"` : ""}><pre><code>${rows}</code></pre>`
    + (long ? `<button type="button" class="code-more" title="Show all of it">Show all ${ls.length} lines</button>` : "")
    + `<div class="code-tools">${long ? `<button type="button" class="code-fold" aria-expanded="true" title="Fold it to its first lines">Fold</button>` : ""}`
    + `<button type="button" class="code-copy" title="Copy the code">Copy</button></div></div>\n`;
}
// a block folded to its first rows, or shown whole (`on` false)
function foldCode(box, on) {
  box.classList.toggle("folded", on);
  const b = box.querySelector(".code-fold");
  if (b) { b.textContent = on ? "Unfold" : "Fold"; b.title = on ? "Show all of it" : "Fold it to its first lines"; b.setAttribute("aria-expanded", String(!on)); }
}
// a code block's Copy (codeFence's, callView's): the command as written (data-copy), else the block's own text
document.addEventListener("click", async (ev) => {
  const f = ev.target.closest && ev.target.closest(".code-fold, .code-more");
  if (f) {
    const box = f.closest(".code-box"), on = !box.classList.contains("folded");
    if (on) codeFolded.add(box.dataset.fold); else codeFolded.delete(box.dataset.fold);
    foldCode(box, on);
    return;
  }
  const b = ev.target.closest && ev.target.closest(".code-copy");
  if (!b) return;
  const code = (b.closest(".code-box") || b.parentElement).querySelector("code");
  try { await navigator.clipboard.writeText(b.dataset.copy ?? (code ? code.textContent : "")); b.textContent = "Copied"; } catch (e) { b.textContent = "Not copied"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1500);
});

