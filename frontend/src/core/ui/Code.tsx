// A block of code, coloured, as the page draws a fenced block in a message (highlight/fence.ts's codeFence): its rows,
// a long one's Fold and Show all, and Copy. Those buttons work by the page's one listener (fence.ts's codeClick, on the
// document), which folds the box itself; a block folded by a click before is drawn folded.
import { useLayoutEffect, useMemo, useRef } from "react";
import { codeFolded, fence, foldCode } from "./highlight/fence";

export interface CodeProps {
  text: string;
  /** its language, as a fenced block names it (```python); none: shown as written */
  lang?: string | null;
}

export function Code({ text, lang }: CodeProps) {
  const f = useMemo(() => fence(text, lang), [text, lang]);
  const ref = useRef<HTMLDivElement>(null);
  // Folded or not as it was left; drawn again only for a new text, so a click's folding stays until then.
  useLayoutEffect(() => {
    if (ref.current) foldCode(ref.current, !!f.fold && codeFolded.has(f.fold));
  }, [f]);
  return (
    <div ref={ref} className="code-box" data-fold={f.fold ?? undefined} dangerouslySetInnerHTML={{ __html: f.inner }} />
  );
}
