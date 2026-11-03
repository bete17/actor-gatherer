// A block of code in React: what codeFence draws, folded and copied by the page's one listener (codeClick).
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Code } from "./Code";
import { codeClick, codeFence, codeFolded, fence } from "./highlight/fence";

const LONG = "def f(x):\n" + "    x += 1\n".repeat(9) + "    return x";

beforeAll(() => document.addEventListener("click", codeClick));
afterAll(() => document.removeEventListener("click", codeClick));
afterEach(() => {
  cleanup();
  codeFolded.clear();
  vi.unstubAllGlobals();
});

describe("Code", () => {
  it("draws what codeFence draws", () => {
    for (const [text, lang] of [
      ["x = 1", "python"],
      [LONG, "python"],
      ["<b>a</b> & ──▶", ""],
      ["ls -la | head", "sh"],
    ]) {
      const { container, unmount } = render(<Code text={text} lang={lang} />);
      expect(container.innerHTML).toBe(codeFence(text, lang).replace(/\n$/, ""));
      unmount();
    }
  });

  it("folds a long block to its first rows on a click, and shows it all again", () => {
    const { container } = render(<Code text={LONG} lang="python" />);
    const box = container.querySelector(".code-box")!;
    fireEvent.click(box.querySelector(".code-fold")!);
    expect(box.classList.contains("folded")).toBe(true);
    expect(box.querySelector(".code-fold")!.textContent).toBe("Unfold");
    expect(codeFolded.has(fence(LONG, "python").fold!)).toBe(true);
    fireEvent.click(box.querySelector(".code-more")!);
    expect(box.classList.contains("folded")).toBe(false);
    expect(codeFolded.size).toBe(0);
  });

  it("is drawn folded when it was folded before, and keeps a click's folding until its text changes", () => {
    codeFolded.add(fence(LONG, "python").fold!);
    const { container, rerender } = render(<Code text={LONG} lang="python" />);
    const box = container.querySelector(".code-box")!;
    expect(box.className).toBe("code-box folded");
    fireEvent.click(box.querySelector(".code-fold")!);
    rerender(<Code text={LONG} lang="python" />);
    expect(box.className).toBe("code-box");
    codeFolded.add(fence(LONG + "\n", "python").fold!);
    rerender(<Code text={LONG + "\n"} lang="python" />);
    expect(box.className).toBe("code-box folded");
    rerender(<Code text="x = 1" lang="python" />);
    expect(box.className).toBe("code-box");
  });

  it("copies the code as written", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { container } = render(<Code text={"a < b\n\tc"} lang="python" />);
    const copy = container.querySelector<HTMLElement>(".code-copy")!;
    fireEvent.click(copy);
    await waitFor(() => expect(copy.textContent).toBe("Copied"));
    expect(writeText).toHaveBeenCalledWith("a < b\n\tc");
  });
});
