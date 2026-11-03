// Code, coloured: the languages. A small highlighter of the page's own, for code in messages (fenced blocks), in files
// and in calls. Each language is a list of rules tried in turn at each place in the text -- a sticky regex and the class
// of what it matches, or a function making the tokens -- and word lists sorting its names. It colours what a reader
// scans for (comments, strings, numbers, keywords, a name defined or called) and leaves the rest in the text's own ink,
// as the NumPy docs do. Shell is read apart (shell.ts's shLex), as the shell reads it.

/** [class, text]: a piece of the text and its class ("" the class of plain text). */
export type Token = [cls: string, text: string];
/** The highlighter, for a rule reading a part of what it matched as another language (a session's commands). */
export type Tokens = (text: string, lang: string) => Token[];
/** A sticky regex and the class of what it matches ("id": a name, sorted by the word lists), or what makes its tokens. */
export type Rule = [RegExp, string | ((m: RegExpExecArray, tokens: Tokens) => Token[])];
export interface Language {
  rules: Rule[];
  /** keywords, literals (coloured as numbers), and the words after which a name is the one defined */
  kw?: Set<string>;
  lit?: Set<string>;
  defs?: Set<string>;
  /** the openings of what a part of a file may begin inside of: a comment, a string (highlight.ts's hlInside) */
  inside?: string[];
  /** its words in any case (SQL) */
  ci?: boolean;
}

export const words = (s: string) => new Set(s.split(" "));
const NUM =
  /(?:0[xX][\da-fA-F_]+|0[bBoO][0-7_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?)[jJlLuUfFnm]*(?![\w$])/y;
const C_COMMENTS: Rule[] = [
  [/\/\/.*/y, "com"],
  [/\/\*[\s\S]*?(?:\*\/|$)/y, "com"],
];
const QUOTED: Rule[] = [
  [/"(?:[^"\\\n]|\\.)*"?/y, "str"],
  [/'(?:[^'\\\n]|\\.)*'?/y, "str"],
];

/** A tag in HTML or XML: its name, its attributes' names and their quoted values. */
export function tagTokens(m: RegExpExecArray): Token[] {
  const t = m[0],
    name = /^<\/?[\w:.-]+/.exec(t)![0],
    out: Token[] = [["tag", name]];
  const re = /("[^"]*"?|'[^']*'?)|([\w:.@-]+)(?=\s*=)|(\/?>$)|([\s\S])/g;
  re.lastIndex = name.length;
  for (let x; (x = re.exec(t));) out.push([x[1] ? "str" : x[2] ? "prop" : x[3] ? "tag" : "", x[0]]);
  return out;
}

export const HL: Record<string, Language> = {
  python: {
    rules: [
      [/#.*/y, "com"],
      [/[rRbBuUfF]{0,2}("""|''')[\s\S]*?(?:\1|$)/y, "str"],
      [/[rRbBuUfF]{0,2}(["'])(?:(?!\1)[^\\\n]|\\.)*\1?/y, "str"],
      [/@[A-Za-z_][\w.]*/y, "meta"],
      [NUM, "num"],
      [/[A-Za-z_]\w*/y, "id"],
    ],
    kw: words(
      "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield",
    ),
    lit: words("True False None"),
    defs: words("def class"),
    inside: ['"""', "'''"],
  },
  js: {
    rules: [
      ...C_COMMENTS,
      [/`(?:[^`\\]|\\[\s\S])*`?/y, "str"],
      ...QUOTED,
      [/@[A-Za-z_][\w.]*/y, "meta"],
      [NUM, "num"],
      [/[A-Za-z_$][\w$]*/y, "id"],
    ],
    kw: words(
      "async await break case catch class const continue debugger default delete do else enum export extends finally for function if implements import in instanceof interface let new private protected public return static super switch throw try typeof var void while with yield",
    ),
    lit: words("true false null undefined this NaN Infinity"),
    defs: words("function class interface enum"),
    inside: ["/*", "`"],
  },
  json: {
    rules: [
      [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, "prop"],
      [/"(?:[^"\\\n]|\\.)*"?/y, "str"],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, "num"],
      [/[A-Za-z_]\w*/y, "id"],
    ],
    lit: words("true false null"),
  },
  clike: {
    rules: [
      ...C_COMMENTS,
      [/(?<=^[ \t]*)#[ \t]*[a-z]+/my, "meta"],
      [/#!?\[[^\]\n]*\]/y, "meta"],
      [/@[A-Za-z_]\w*/y, "meta"],
      [/"(?:[^"\\\n]|\\.)*"?/y, "str"],
      [/'(?:[^'\\\n]|\\.){1,8}'/y, "str"],
      [/`[^`]*`?/y, "str"],
      [NUM, "num"],
      [/[A-Za-z_]\w*/y, "id"],
    ],
    kw: words(
      "abstract async auto await break case catch char class const continue default defer do double dyn else enum extends extern final float fn for fun func go goto if impl implements import in inline int interface let long loop match mod move mut namespace new override package private protected pub public ref return short signed sizeof static struct super switch template throw throws trait try type typedef typename union unsafe unsigned use using val var virtual void volatile when where while yield",
    ),
    lit: words("true false null nil NULL nullptr None Some Ok Err self Self this"),
    defs: words("fn func fun class struct enum trait impl interface type union"),
    inside: ["/*"],
  },
  toml: {
    rules: [
      [/#.*/y, "com"],
      [/(?<=^[ \t]*);.*/my, "com"],
      [/(?<=^[ \t]*)\[\[?[^\]\n]*\]\]?/my, "sec"],
      [/(?<=^[ \t]*)[\w.\-"' ]*?[\w"'](?=[ \t]*=)/my, "prop"],
      [/("""|''')[\s\S]*?(?:\1|$)/y, "str"],
      ...QUOTED,
      [/\d{4}-\d\d-\d\d(?:[T ][\d:.]+)?(?:Z|[+-]\d\d:\d\d)?/y, "num"],
      [/[+-]?(?:\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|inf|nan)\b/y, "num"],
      [/[A-Za-z_][\w-]*/y, "id"],
    ],
    lit: words("true false"),
    inside: ['"""', "'''"],
  },
  yaml: {
    rules: [
      [/(?<=^|[ \t])#.*/my, "com"],
      [/(?<=^[ \t]*(?:-[ \t]+)*)(?:"[^"\n]*"|'[^'\n]*'|[^\s#'"\-?:,[\]{}][^\n#]*?)(?=[ \t]*:(?:[ \t]|$))/my, "prop"],
      [/(?<=(?:^|[:\-,[{])[ \t]*)(?:"(?:[^"\\\n]|\\.)*"?|'[^'\n]*'?)/my, "str"],
      [/[&*][\w-]+/y, "meta"],
      [/(?<=^)(?:---|\.\.\.)$/my, "meta"],
      [NUM, "num"],
      [/[A-Za-z_][\w-]*/y, "id"],
    ],
    lit: words("true false null True False Null"),
  },
  md: {
    rules: [
      [/(?<=^[ \t]{0,3})#{1,6}[ \t].*/my, "sec"],
      [/(?<=^[ \t]*)(?:```|~~~).*/my, "meta"],
      [/<!--[\s\S]*?(?:-->|$)/y, "com"],
      [/(?<=^[ \t]*)>.*/my, "com"],
      [/(?<=^[ \t]*)(?:[-*+]|\d+[.)])(?=[ \t])/my, "kw"],
      [/`[^`\n]+`/y, "str"],
      [/\*\*[^*\n]+\*\*|__[^_\n]+__/y, "b"],
      [/\[[^\]\n]*\]\([^)\n]*\)/y, "fn"],
    ],
    inside: ["<!--"],
  },
  html: {
    rules: [
      [/<!--[\s\S]*?(?:-->|$)/y, "com"],
      [/<![A-Za-z][^>]*>?/y, "meta"],
      [/<\/?[A-Za-z][\w:.-]*(?:[^>"']|"[^"]*"|'[^']*')*>?/y, tagTokens],
      [/&#?\w+;/y, "num"],
    ],
    inside: ["<!--"],
  },
  css: {
    rules: [
      [/\/\*[\s\S]*?(?:\*\/|$)/y, "com"],
      ...QUOTED,
      [/@[\w-]+/y, "kw"],
      [/-{0,2}[A-Za-z_][\w-]*(?=[ \t]*:[^{};\n]*(?:[;}]|$))/my, "prop"],
      [/--[\w-]+/y, "prop"],
      [/#[\da-fA-F]{3,8}(?![\w-])/y, "num"],
      [/-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/y, "num"],
      [/!important\b/y, "kw"],
      [/[A-Za-z_-][\w-]*/y, "id"],
    ],
    inside: ["/*"],
  },
  sql: {
    rules: [
      [/--.*/y, "com"],
      [/\/\*[\s\S]*?(?:\*\/|$)/y, "com"],
      [/'(?:[^']|'')*'?/y, "str"],
      [NUM, "num"],
      [/[A-Za-z_]\w*/y, "id"],
    ],
    ci: true,
    kw: words(
      "all alter and as asc begin between by case check collate commit create cross default delete desc distinct drop else end exists explain foreign from glob group having if ignore in index inner insert into is join key left like limit not null offset on or order outer pragma primary recursive references replace returning right rollback select set table then transaction trigger union unique update using vacuum values view when where with",
    ),
    lit: words("true false"),
    inside: ["/*"],
  },
  diff: {
    rules: [
      [/^(?:\+\+\+|---|\*\*\*|diff |index ).*/my, "meta"],
      [/^@@.*/my, "fn"],
      [/^\+.*/my, "add"],
      [/^-.*/my, "del"],
      [/.+/y, ""],
    ],
  },
  console: {
    // a session: its commands after their prompts
    rules: [
      [/^[$%] .*/my, (m, tokens) => [["sp", m[0].slice(0, 2)], ...tokens(m[0].slice(2), "shell")]],
      [/.+/y, ""],
    ],
  },
  shell: { rules: [] }, // read by shLex
};

const HL_ALIASES: Record<string, string> = {
  py: "python",
  python3: "python",
  pyi: "python",
  pyw: "python",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  typescript: "js",
  tsx: "js",
  mts: "js",
  cts: "js",
  node: "js",
  jsonc: "json",
  jsonl: "json",
  json5: "json",
  ipynb: "json",
  geojson: "json",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ksh: "shell",
  shellscript: "shell",
  "shell-session": "console",
  shellsession: "console",
  terminal: "console",
  ini: "toml",
  cfg: "toml",
  conf: "toml",
  properties: "toml",
  editorconfig: "toml",
  yml: "yaml",
  markdown: "md",
  mdx: "md",
  htm: "html",
  xhtml: "html",
  xml: "html",
  svg: "html",
  vue: "html",
  plist: "html",
  scss: "css",
  less: "css",
  sqlite: "sql",
  sqlite3: "sql",
  psql: "sql",
  postgres: "sql",
  postgresql: "sql",
  mysql: "sql",
  patch: "diff",
  udiff: "diff",
  c: "clike",
  h: "clike",
  cc: "clike",
  cpp: "clike",
  cxx: "clike",
  hpp: "clike",
  hh: "clike",
  "c++": "clike",
  java: "clike",
  go: "clike",
  golang: "clike",
  rs: "clike",
  rust: "clike",
  swift: "clike",
  kt: "clike",
  kts: "clike",
  kotlin: "clike",
  cs: "clike",
  csharp: "clike",
  scala: "clike",
  dart: "clike",
  zig: "clike",
};

/** The language a name stands for (a fenced block's, a file's extension); null: none known, shown as written. */
export const hlLang = (name: string | null | undefined): string | null => {
  const n = String(name || "").toLowerCase();
  return Object.hasOwn(HL, n) ? n : Object.hasOwn(HL_ALIASES, n) ? HL_ALIASES[n] : null;
};

const SHELL_FILES = words(".bashrc .zshrc .profile .bash_profile .zprofile .zshenv .envrc");

/** The language of a file, by its name. */
export function langOfPath(p: string | null | undefined): string | null {
  const name = String(p || "")
      .replace(/^['"]|['"]$/g, "")
      .split("/")
      .pop()!,
    dot = name.lastIndexOf(".");
  return SHELL_FILES.has(name) ? "shell" : dot > 0 ? hlLang(name.slice(dot + 1)) : null;
}

/**
 * A piece of a web page, read by itself (a file's lines, a change): its markup, its style or its script -- the page
 * itself (page.html) is mostly the last two.
 */
export function guessWeb(text: string): "html" | "css" | "js" {
  let tag = 0,
    css = 0,
    js = 0;
  for (const l of text.split("\n")) {
    const s = l.trim();
    if (!s) continue;
    if (
      /^(?:const|let|var|function|return|if|for|while|async|await|class|import|export|else|try|catch|throw|switch|case)\b|=>|^\}|^\/\/|[=(]\s*$/.test(
        s,
      )
    )
      js++;
    else if (/^<\/?[A-Za-z!]/.test(s)) tag++;
    else if (/^[.#:[*>@&\w][^{}=]*\{\s*(?:-{0,2}[\w-]+\s*:|\}?$)|^-{0,2}[\w-]+\s*:\s*[^{}]*;\s*\}?\s*$|^\/\*/.test(s))
      css++;
    else if (/[;{]\s*$/.test(s)) js++;
  }
  return tag && tag >= Math.max(css, js) ? "html" : css > js ? "css" : "js";
}
