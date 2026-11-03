// The old page's drawing in the turn list: its stage kept on the page while it shows the same, and the nodes it builds
// drawn as React's own.
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Html, useStage } from "./Hosted";

afterEach(cleanup);

const node = (html: string) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content.firstChild!;
};

function Box({ make, words = true }: { make: () => Node | null; words?: boolean }) {
  const box = useRef<HTMLDivElement>(null),
    after = useRef<HTMLSpanElement>(null);
  useStage(box, make, words ? after : undefined);
  return (
    <div ref={box} className="box">
      {words ? (
        <span ref={after} className="now">
          Working…
        </span>
      ) : null}
    </div>
  );
}

describe("useStage", () => {
  it("puts the stage first, and keeps the one on the page while it shows the same", () => {
    const { container, rerender } = render(<Box make={() => node('<span data-sig="a">1</span>')} />);
    const box = container.querySelector(".box")!;
    const first = box.firstChild!;
    expect(box.innerHTML).toBe('<span data-sig="a">1</span><span class="now">Working…</span>');
    // the same sig: kept, whatever it holds now (its own clock moved it on)
    rerender(<Box make={() => node('<span data-sig="a">2</span>')} />);
    expect(box.firstChild).toBe(first);
    expect(box.innerHTML).toBe('<span data-sig="a">1</span><span class="now">Working…</span>');
    // another: in its place
    rerender(<Box make={() => node('<span data-sig="b">3</span>')} />);
    expect(box.innerHTML).toBe('<span data-sig="b">3</span><span class="now">Working…</span>');
    // the stage's own next moment, put in its place: compared, and kept
    const own = node('<span data-sig="c">4</span>');
    box.firstChild!.replaceWith(own);
    rerender(<Box make={() => node('<span data-sig="c">5</span>')} />);
    expect(box.firstChild).toBe(own);
    // none: gone
    rerender(<Box make={() => null} />);
    expect(box.innerHTML).toBe('<span class="now">Working…</span>');
  });

  it("compares a stage without a sig by its markup, in a box holding only it", () => {
    const { container, rerender } = render(<Box words={false} make={() => node('<span class="spin"></span>')} />);
    const box = container.querySelector(".box")!,
      spin = box.firstChild;
    rerender(<Box words={false} make={() => node('<span class="spin"></span>')} />);
    expect(box.firstChild).toBe(spin);
    rerender(<Box words={false} make={() => node('<span class="buddy"></span>')} />);
    expect(box.innerHTML).toBe('<span class="buddy"></span>');
  });
});

describe("Html", () => {
  it("draws the old page's node as React's own: the same element, attributes and contents", () => {
    for (const html of [
      '<div class="cv err"><pre class="out">a &amp; <b>b</b></pre><button type="button" data-copy="x">Copy</button></div>',
      '<img class="crew-face" src="/avatars/a.svg" alt="" draggable="false">',
      '<span class="crew-face none" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M1 1"></path></svg></span>',
      '<span class="cmdline"><span class="sh-t"><span class="hl-fn">ls</span></span></span>',
    ]) {
      const { container, unmount } = render(<Html node={node(html)} />);
      expect(container.childNodes.length).toBe(1);
      expect(container.firstChild!.isEqualNode(node(html))).toBe(true); // attributes in any order: an image's src last
      unmount();
    }
  });

  it("takes a style as React does, and a text as it is", () => {
    const { container } = render(
      <>
        <Html node={node('<span style="color: red; --x: 1px">s</span>')} />
        <Html node="plain &" />
        <Html node={null} />
      </>,
    );
    expect(container.innerHTML).toBe('<span style="color: red; --x: 1px;">s</span>plain &amp;');
  });
});
