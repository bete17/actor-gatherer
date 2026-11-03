// A fenced block in a message (codeFence): each line a row Chat wraps in the box, its rest indented under where the
// line begins, and a long block foldable to its first rows.
import { describe, expect, it } from "vitest";
import { plain } from "../testing";
import { codeFence } from "./fence";

/** [indent, the row's HTML] of each row, less its closing tag (the highlighter's own spans kept). */
function rows(markup: string): [number, string][] {
  const code = markup.slice(markup.indexOf("<code>") + 6, markup.indexOf("</code>"));
  return [...code.matchAll(/<span class="cf-l" style="--in:(\d+)">([\s\S]*?)(?=<span class="cf-l"|$)/g)].map((m) => [
    Number(m[1]),
    m[2].slice(0, -"</span>".length),
  ]);
}

describe("codeFence", () => {
  it("makes each line a row indented as it begins, and keeps the text", () => {
    const text = "def f(x):\n    if x:\n\treturn x\n\n" + " ".repeat(40) + "deep";
    const got = rows(codeFence(text, "python"));
    expect(got.map(([i]) => i)).toEqual([0, 4, 4, 0, 24]); // a tab to 4; a deep line's indent held at 24
    // each row but the last ends in its line break, so the rows' text (a copy, a selection) is the block as written
    expect(got.map(([, t]) => plain(t)).join("")).toBe(text);
    expect(got.slice(0, -1).every(([, t]) => t.endsWith("\n"))).toBe(true);
    expect(got[got.length - 1][1].endsWith("\n")).toBe(false);
  });

  it("can fold only a long block, and the same text is the same block", () => {
    const short = codeFence("a\n".repeat(7) + "b", ""),
      long = codeFence("a\n".repeat(8) + "b", ""),
      again = codeFence("a\n".repeat(8) + "b", "text"),
      other = codeFence("a\n".repeat(8) + "c", "");
    expect(short).not.toContain("data-fold");
    expect(short).not.toContain("code-fold");
    expect(long).toContain("Show all 9 lines");
    expect(long).toContain('class="code-fold"');
    const key = (m: string) => /data-fold="([^"]+)"/.exec(m)![1];
    expect(key(long)).toBe(key(again));
    expect(key(long)).not.toBe(key(other));
  });

  it("shows an unnamed block as written", () => {
    const markup = codeFence("<b>a</b> & ──▶", "");
    expect(
      plain(
        rows(markup)
          .map(([, t]) => t)
          .join(""),
      ),
    ).toBe("<b>a</b> & ──▶");
    expect(markup).not.toContain("<b>");
  });
});
