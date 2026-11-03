// Code, coloured: the page's own highlighter, by each language's rules, and a part of a file read from inside the
// comment or string it begins in.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { plain, ROOT, tokens } from "../testing";
import { guessWeb, hlLang, langOfPath } from "./languages";
import { hlInside, hlLines, hlPart, hlTokens } from "./highlight";

describe("the highlighter", () => {
  it("colours what a reader scans for in Python", () => {
    const got = tokens(
      hlTokens('import os\n@cache\ndef go(x=1.5):  # why\n    return f"{x}" if x else None', "python"),
    );
    expect(got.kw).toEqual(["import", "def", "return", "if", "else"]);
    expect(got.fn).toEqual(["go"]);
    expect(got.num).toEqual(["1.5", "None"]);
    expect(got.com).toEqual(["# why"]);
    expect(got.str).toEqual(['f"{x}"']);
    expect(got.meta).toEqual(["@cache"]);
  });

  it("closes a string over several lines at each line's end and opens it again on the next", () => {
    expect(hlLines('x = """a\nb"""', "python")).toEqual([
      'x = <span class="hl-str">&quot;&quot;&quot;a</span>',
      '<span class="hl-str">b&quot;&quot;&quot;</span>',
    ]);
  });

  it("knows languages by name and by a file's extension", () => {
    expect([hlLang("Python"), hlLang("tsx"), hlLang("zsh"), hlLang("made-up")]).toEqual([
      "python",
      "js",
      "shell",
      null,
    ]);
    expect([langOfPath("a/b.toml"), langOfPath("~/.zshrc"), langOfPath("Makefile")]).toEqual(["toml", "shell", null]);
  });

  it("reads a piece of a web page as its markup, style or script", () => {
    expect([
      guessWeb("const a = 1;\nfunction f() {\n}"),
      guessWeb(".a { color: red; }\n.b {\n  margin: 0;\n}"),
      guessWeb('<div class="x">\n</div>'),
    ]).toEqual(["js", "css", "html"]);
  });

  it("keeps the text as written in every language", () => {
    const py = fs.readFileSync(path.join(ROOT, "ag_dashboard", "files.py"), "utf8");
    // the highlighter's own code, as the page's script that the old test read it from
    const page = ["languages.ts", "shell.ts", "highlight.ts", "command.ts", "output.ts", "fence.ts"]
      .map((f) => fs.readFileSync(path.join(import.meta.dirname, f), "utf8"))
      .join("\n");
    const cases: [string, string][] = [
      [py, "python"],
      [page, "js"],
      [page, "html"],
      [page, "css"],
      ['{"a": [1, "b\\"c"]}', "json"],
      ["[x]\na = 'b' # c", "toml"],
      ["a: [1, 'b'] # c\n- k: v", "yaml"],
      ["SELECT 'it''s' -- c", "sql"],
      ['fn main() { let s = "x"; } // c', "clike"],
      ["# h\n- `a` **b**", "md"],
      ["@@ -1 +1 @@\n-a\n+b", "diff"],
      ["$ ls -la\ntotal 0", "console"],
    ];
    for (const [text, lang] of cases) expect(plain(hlLines(text, lang).join("\n")), lang).toBe(text);
  });
});

// A part of a file (a change, lines read, a search's hits) that begins inside a comment or a string opened above it:
// read from there, not from code, when the comment's end or the string's closing quotes are in it.
describe("a part of a file", () => {
  it("is closed by a docstring's closing quotes, the code after them read as code", () => {
    const text = '    the value is None when it is not set.\n    """\n    x = load(path)\n    return x';
    expect(hlInside("python", text)).toBe('"""');
    const [lines] = hlPart("python", text);
    expect(lines[0]).toBe('<span class="hl-str">    the value is None when it is not set.</span>');
    expect(lines.slice(2)).toEqual([
      '    x = <span class="hl-fn">load</span>(path)',
      '    <span class="hl-kw">return</span> x',
    ]);
    expect(plain(lines.join("\n"))).toBe(text);
  });

  it("is closed by a comment's end, in a script and in a style", () => {
    const [js] = hlPart("js", "   * the user's own list\n   */\n  go(a);");
    const [css] = hlPart("css", "   and the page's rows */\n.x { color: red; }");
    expect(js).toEqual([
      '<span class="hl-com">   * the user&#39;s own list</span>',
      '<span class="hl-com">   */</span>',
      '  <span class="hl-fn">go</span>(a);',
    ]);
    expect(css[0]).toBe('<span class="hl-com">   and the page&#39;s rows */</span>');
  });

  it("is closed by a template's closing backtick", () => {
    const [lines] = hlPart("js", '    <div class="x">${y}</div>\n  `;\n  const z = f(1);');
    expect(lines[0]).toBe('<span class="hl-str">    &lt;div class=&quot;x&quot;&gt;${y}&lt;/div&gt;</span>');
    expect(lines[2]).toBe(
      '  <span class="hl-kw">const</span> z = <span class="hl-fn">f</span>(<span class="hl-num">1</span>);',
    );
  });

  it("begins inside the same on a change's two sides", () => {
    const [was, now] = hlPart("python", 'end of the doc.\n"""\nx = 1', "end of the doc, and more of it.");
    expect(was[2]).toBe('x = <span class="hl-num">1</span>');
    expect(now).toEqual(['<span class="hl-str">end of the doc, and more of it.</span>']);
  });

  it("is read from code when it begins in code", () => {
    const cases: [string, string][] = [
      ["python", 'def f():\n    """\n    Doc.\n    """\n    return 1'], // a docstring opened, alone on its line
      ["python", 'x = """a\nb"""'],
      ["python", '    return r"""\n    text"""'],
      ["python", '    """Summary.\n\n    More."""'],
      ["js", "const re = /\\w*/y;\nf();"], // a regex's /a*/, not a comment's end
      ["js", 'glob("**/*.js");\nx = 1;'], // nor a glob's, in a string
      ["js", 'const t = s.replace(/`|\\*\\*/g, "");\nx();'], // a backtick in a regex
      ["js", "el.innerHTML = cond ? `<b>${x}</b>` : y;"],
      ["css", ".a { b: c; } /* d */"],
      ["js", "// a closing */ in a comment\nf();"],
    ];
    expect(cases.map(([lang, text]) => hlInside(lang, text))).toEqual(cases.map(() => ""));
  });
});
