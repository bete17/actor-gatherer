// split.mjs: page.html cut into the front end's files with every line kept, and a diff of page.html ported onto them.
import { describe, expect, it } from "vitest";
import { files, port, SECTIONS, STYLES } from "./split.mjs";

/** A page with every section and style comment the split cuts at, a line of its own in each. */
function page(): string {
  const styles = STYLES.filter(([m]) => m !== null).map(([m], i) => `${m} */\n.s${i} { color: red; }`);
  const sections = Object.keys(SECTIONS)
    .filter((t) => t !== "")
    .map((t, i) => `// ${"-".repeat(66)} ${t}\nconst x${i} = ${i};`);
  return [
    "<!doctype html>",
    "<head>",
    "<style>",
    ".base { margin: 0; }",
    ...styles,
    "</style>",
    "</head>",
    "<body>",
    "<p>hello</p>",
    "<!--VENDOR-->",
    "<script>",
    '"use strict";',
    "const SNAPSHOT = /*SNAPSHOT*/null;",
    ...sections,
    "</script>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

describe("files", () => {
  const got = files(page());

  it("writes the markup with the module's tags where the script was, and no style", () => {
    expect(got["index.html"]).toContain('<script type="module" src="/src/main.ts"></script>');
    expect(got["index.html"]).toContain("<script>window.AG_SNAPSHOT = /*SNAPSHOT*/null;</script>");
    expect(got["index.html"]).not.toContain("<style>");
    expect(got["index.html"]).toContain("<p>hello</p>\n<!--VENDOR-->");
  });

  it("keeps every line of the script, in order, its snapshot read from the markup's", () => {
    const order = JSON.parse(got["src/legacy/order.json"]);
    expect(order.js).toEqual(Object.values(SECTIONS));
    const script = order.js.map((f: string) => got[`src/legacy/${f}`]).join("");
    const original = page().split("<script>\n")[1].split("</script>")[0];
    expect(script).toBe(original.replace("const SNAPSHOT = /*SNAPSHOT*/null;", script.split("\n")[1]));
    expect(script.split("\n")[1]).toMatch(/^const SNAPSHOT = window\.AG_SNAPSHOT \?\? null;/);
  });

  it("keeps every line of the styles, in order", () => {
    const order = JSON.parse(got["src/legacy/order.json"]);
    expect(order.css).toEqual(STYLES.map(([, f]) => f));
    const styles = order.css.map((f: string) => got[`src/legacy/css/${f}`]).join("");
    expect(styles).toBe(page().split("<style>\n")[1].split("</style>")[0]);
  });
});

describe("port", () => {
  it("moves a hunk of page.html to the file its lines went to, at their line there", () => {
    const text = page();
    const lines = text.split("\n");
    const at = lines.indexOf("const x9 = 9;"); // in "the chat" (10-chat.js), its file's second line
    const diff = [
      "diff --git a/ag_dashboard/page.html b/ag_dashboard/page.html",
      "--- a/ag_dashboard/page.html",
      "+++ b/ag_dashboard/page.html",
      `@@ -${at},2 +${at},2 @@`,
      ` ${lines[at - 1]}`,
      `-${lines[at]}`,
      "+const x9 = 99;",
      "",
    ].join("\n");
    const got = port(diff, text);
    expect(got).toContain(
      "--- a/frontend/src/legacy/10-chat.js\n+++ b/frontend/src/legacy/10-chat.js\n@@ -1,2 +1,2 @@",
    );
    expect(got).toContain("-const x9 = 9;\n+const x9 = 99;");
  });

  it("moves a hunk of the markup after the script past the module's two tags", () => {
    const text = page();
    const lines = text.split("\n");
    const at = lines.indexOf("</body>") + 1;
    const diff = `diff --git a/ag_dashboard/page.html b/ag_dashboard/page.html\n@@ -${at},1 +${at},2 @@\n </body>\n+<!-- end -->\n`;
    const index = files(text)["index.html"].split("\n");
    expect(port(diff, text)).toContain(
      `--- a/frontend/index.html\n+++ b/frontend/index.html\n@@ -${index.indexOf("</body>") + 1},1`,
    );
  });
});
