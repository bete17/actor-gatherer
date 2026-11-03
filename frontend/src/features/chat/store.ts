// The turn list's own state, kept across the page's draws and across views: which latest replies a click folded, which
// turns show all their earlier messages, the turns before the latest a click showed or folded against the setting, the
// first turn drawn, and the turn last brought into view. The folds are one actor's at a time: they start over when the
// page's files feed does (`files`, the old page's state.files, made anew for each actor picked), as they did when they
// were kept in it. Read by the mount at each draw and handed down (mount.tsx): the turn list renders when the page
// draws, not on its own, so a change here is followed by the page's redraw (the host's), as a click on it was.
import { create } from "zustand";

/** The latest turns drawn at first; and how many more each pull up past the top draws. */
export const TURNS_SHOWN = 5,
  TURNS_MORE = 5;

export interface Folds {
  /** the latest replies folded by a click, by their ids */
  closed: ReadonlySet<string>;
  /** the turns whose earlier messages are all shown */
  opened: ReadonlySet<number>;
  /** the turns before the latest a click showed (true) or folded */
  flips: ReadonlyMap<number, boolean>;
  /** the first turn drawn: the latest few at first; then where the reader pulled it to, or the turn they picked */
  first: number | null;
}

interface TurnsState extends Folds {
  /** the page's files feed the folds are of */
  files: object | null;
  /** the turn last brought into view ("<actor's key>:<turn>"): once each time one is shown, the latest or one picked */
  shown: string | null;
  /** the folds of this files feed: started over for another */
  forFiles: (files: object) => void;
  /** a latest reply folded or opened by a click */
  fold: (id: string, open: boolean) => void;
  /** a turn's earlier messages all shown, or folded behind its + again */
  toggleOpened: (n: number) => void;
  /** a turn before the latest shown whole or folded by a click: kept so, until a click puts it back as the setting has it */
  flip: (n: number, whole: boolean, atFirst: boolean) => void;
  /** the setting picked again: every turn as it has them */
  clearFlips: () => void;
  setFirst: (first: number) => void;
  setShown: (at: string | null) => void;
}

const fresh = (): Folds => ({ closed: new Set(), opened: new Set(), flips: new Map(), first: null });

export const useTurns = create<TurnsState>()((set, get) => ({
  ...fresh(),
  files: null,
  shown: null,
  forFiles: (files) => {
    if (get().files !== files) set({ ...fresh(), files });
  },
  fold: (id, open) =>
    set((st) => {
      const closed = new Set(st.closed);
      if (open) closed.delete(id);
      else closed.add(id);
      return { closed };
    }),
  toggleOpened: (n) =>
    set((st) => {
      const opened = new Set(st.opened);
      if (opened.has(n)) opened.delete(n);
      else opened.add(n);
      return { opened };
    }),
  flip: (n, whole, atFirst) =>
    set((st) => {
      const flips = new Map(st.flips);
      if (!whole === atFirst) flips.delete(n);
      else flips.set(n, !whole);
      return { flips };
    }),
  clearFlips: () => set({ flips: new Map() }),
  setFirst: (first) => set({ first }),
  setShown: (shown) => set({ shown }),
}));

/** When each turn the session opened before ag stored it began: by the actor and its first message's words (the host's
 * typedAs), so the turn ag stores from it counts from when it was sent. */
export const turnsBegan = new Map<string, number>();
