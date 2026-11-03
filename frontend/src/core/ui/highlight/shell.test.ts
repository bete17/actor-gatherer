// Shell, read as the shell reads it (shLex, through the highlighter), and a command laid out (shellHtml).
import { describe, expect, it } from "vitest";
import { plain, tokens } from "../testing";
import { shellHtml } from "./command";
import { hlLines, hlTokens } from "./highlight";

/** A command as shellHtml lays it out: each line's indent and its text. */
const laidOut = (markup: string): [number, string][] =>
  [...markup.matchAll(/<div class="sh-l(?: p)?" style="--i:(\d+)">(.*?)<\/div>/g)].map((m) => [
    Number(m[1]),
    plain(m[2]),
  ]);

describe("shell", () => {
  it("tells the command run, its flags, variables and operators", () => {
    const got = tokens(hlTokens('FOO=1 env -u X sudo -E python3 -m x "$HOME/a $(date)" 2>&1 | tail -5 # c', "shell"));
    expect(got.cmd).toEqual(["env", "sudo", "python3", "date", "tail"]); // past a wrapper and its flags' words
    expect(got.flag).toEqual(["-u", "-E", "-m", "-5"]);
    expect(got.var).toEqual(["FOO", "$HOME"]);
    expect(got.op).toEqual(["$(", ")", "2>&1", "|"]);
    expect(got.com).toEqual(["# c"]);
  });

  it("colours a heredoc's body as what reads it", () => {
    const got = tokens(hlTokens("python3 - <<'EOF'\nimport os\nEOF\ncat > a.json <<EOF\n{\"a\": 1}\nEOF", "shell"));
    expect(got.kw).toContain("import"); // python reads the first
    expect(got.prop).toEqual(['"a"']); // the second is written to a .json
    expect(got.op).toEqual(["<<'EOF'", "EOF", ">", "<<EOF", "EOF"]);
  });

  it("breaks a long command after its steps, its pipes indented under them", () => {
    const markup = shellHtml(
      "cd /Users/sep/x && git diff a b -- one.py two.py three.py | grep -E '^[+-]' | head -60; git status",
      "/Users/sep",
    );
    expect(laidOut(markup)).toEqual([
      [0, "$ cd ~/x &&"],
      [1, "git diff a b -- one.py two.py three.py | grep -E '^[+-]' | head -60"],
      [0, "git status"],
    ]);
  });

  it("keeps a short command on its line, and indents loops", () => {
    const short = shellHtml("ls -la && pwd", "");
    const loop = shellHtml(
      'for f in *.py; do echo "$f"; wc -l "$f" | sort -rn | head -3; done; echo all files counted',
      "",
    );
    expect(short.split('class="sh-l').length - 1).toBe(1);
    expect(laidOut(loop)).toEqual([
      [0, "$ for f in *.py; do"],
      [1, 'echo "$f"'],
      [1, 'wc -l "$f" | sort -rn | head -3'],
      [0, "done"],
      [0, "echo all files counted"],
    ]);
  });

  it("still shows whole what it cannot read", () => {
    for (const text of ['echo "never closed && more', "ls (unbalanced", "cat <<EOF\nno end", "a | | b; ;"])
      expect(plain(hlLines(text, "shell").join("\n"))).toBe(text);
  });
});
