// What a call printed, as its terminal showed it (ansiHtml), or coloured as what it plainly is (outputHtml).
import { describe, expect, it } from "vitest";
import { ansiHtml, outputHtml } from "./output";

describe("a command's output", () => {
  it("keeps a terminal's colours and drops its other escapes", () => {
    expect(ansiHtml("\x1b[1;31mFAIL\x1b[0m ok \x1b[32mpass\x1b[39m\x1b]0;title\x07\n10%\r100%")).toBe(
      '<span class="a-red a-bold">FAIL</span> ok <span class="a-green">pass</span>\n100%',
    );
  });

  it("with no colours of its own, is coloured as what it plainly is", () => {
    expect(outputHtml("-a\n+b\n@@ -1 +1 @@", "git diff x | head")).toContain('<span class="hl-del">-a</span>');
    expect(outputHtml('{"a": 1}', "curl x")).toContain('<span class="hl-prop">&quot;a&quot;</span>');
    expect(outputHtml("-a\n+b", "cat notes")).toBe("-a\n+b"); // not from a diff: as printed
  });
});
