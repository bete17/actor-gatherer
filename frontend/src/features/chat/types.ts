// What the Chat view's turn list draws from (the feed the old page hands it at each draw: ChatFeed) and what it calls of
// the old page (ChatHost), until those parts of the page move too (ag_dashboard/DESIGN.md, A5). The turns are files.py's,
// as /api/files gives them; the actor is the home's (data.py's), as far as the turn list reads them.
import type { Home } from "../../core/api/types";

/** A message of the agent's in a turn (files.py's `replies`): what it said, a run of its thinking, or a note of its
 * harness's (a subagent's report handed back, another session's message). */
export interface Reply {
  kind: string;
  text?: string;
  /** thinking's runs; none readable when encrypted */
  texts?: string[];
  /** a report's task, or the session a message came from */
  name?: string | null;
}

/** A call (files.py's command): its line, the call as its harness's view reads it, and how it went. */
export interface CallRun {
  id?: string | null;
  text: string;
  call?: unknown;
  running?: boolean;
  error?: boolean;
  output?: string | null;
  exit?: number | string | null;
  took?: string | null;
}

/** How a turn stopped short (files.py's `stopped`): interrupted, an error it gave up on, or another reason. */
export interface Stopped {
  kind: string;
  text?: string | null;
  status?: number | string | null;
  reason?: string | null;
}

/** A message of the user's: a turn's first, or one written while it ran (`more`). */
export interface UserMessage {
  text: string;
  kind?: string;
  at?: number;
}

/** A message the actor sent another (files.py's `sent`: `ag actors send`, or a new actor started with it). */
export interface SentMessage {
  text: string;
  kind?: string;
  to?: string | null;
  to_name?: string | null;
}

/** A turn (files.py's): the user's message, what the agent said and did, how it ended. */
export interface Turn {
  n: number;
  row_id?: number | null;
  at?: number | null;
  /** its last event's time */
  end?: number | null;
  text: string;
  kind?: string;
  replies?: Reply[];
  /** what the agent does now: a call, or thinking */
  now?: { kind: string; id?: string; text?: string } | null;
  more?: UserMessage[];
  /** its latest call, while nothing readable followed it */
  last?: CallRun | null;
  stopped?: Stopped | null;
  /** its calls, as many as its commands list */
  calls?: number;
  /** what the avatar acts out (work.py's summary) */
  work?: unknown;
  sent?: SentMessage[];
  /** a `!` command's output */
  output?: string | null;
}

/** /api/files: the actor's turns, and the one shown (`turn`, its index) -- the latest, unless one is picked. */
export interface FilesData {
  turns: Turn[];
  turn: number | null;
  home?: string;
}

/** An actor, as the home has it (data.py), as far as the turn list reads it. */
export interface Actor {
  channel: string;
  harness?: string | null;
  status?: string;
  role?: string;
  /** its last activity */
  last?: number | null;
  /** its calls failing, retried: since when */
  failing?: { at: number } | null;
  avatar?: string | null;
  avatar_hue?: string | null;
  /** what it says before its first message */
  avatar_hello?: string | null;
  name?: { text?: string | null } | null;
  session?: {
    status?: string;
    terminal?: unknown;
    started_as?: string | null;
    queued?: string[];
  } | null;
}

/** A message of the user's as the actor's own records have it (the agent's `typed`, data.py's): sent to the model at
 * `sent` (null: waiting), part of the turn it was written in (`joins`), or sent from Chat and not had yet (`chat`). */
export interface Typed {
  text: string;
  at?: number;
  sent: number | null;
  joins?: boolean;
  chat?: boolean;
  kind?: string;
}

/** What the actor's records say the user wrote (the old page's heard()): stored, typed, and queued. */
export interface Heard {
  stored: UserMessage[];
  typed: Typed[];
  queued: string[];
}

/** A message sent from this page's box, not yet in the actor's records (the old page's sentHere). */
export interface SentHere {
  text: string;
  /** when it was sent, in the page's milliseconds */
  at: number;
  /** typed into its terminal, opening a turn -- not kept for the end of the turn under way */
  ran?: boolean;
}

/** What the old page hands the turn list at each draw (16-files-view.js's talkFeed). */
export interface ChatFeed {
  /** the actor's key (its gatherer and channel) and its gatherer */
  key: string;
  gatherer: string;
  /** the page's files feed for the actor (state.files): the turn list's folds start over with a new one, as they did */
  files: object;
  data: FilesData;
  /** the turn picked, or null: the latest, followed */
  picked: number | null;
  home: Home | null;
  info: Actor;
  session: { status?: string };
  running: boolean;
  /** statusOf(info)'s first word: idle, running, asking, ... */
  status: string;
  writable: boolean;
  held: string;
  heard: Heard;
  /** sent from here, not had yet */
  mine: SentHere[];
  /** Esc sent for this actor lately */
  interrupting: boolean;
  /** Esc would interrupt it */
  canInterrupt: boolean;
  /** the files and commands folded to their bar */
  sideFolded: boolean;
  /** the setting "Chat's earlier turns": messages only, or whole */
  earlierTurns: string;
  /** a Terminal view to send the reader to */
  terminalView: boolean;
  /** the view opened afresh: the turn shown brought into view again */
  afresh: boolean;
}

/** What the turn list calls of the old page, until those parts move too. */
export interface ChatHost {
  /** the actor's stage (01-helpers.js): at work, done, waving hello */
  atWork(info: Actor, t: { work?: unknown }): Node;
  atRest(info: Actor, turn: number | null | undefined): Node;
  greeting(info: Actor): Node | null;
  /** a call as the commands at the left show it (16-files-view.js): opened, and its line */
  callView(call: unknown, ran: CallRun): Node;
  callLabel(c: CallRun, n: number): Node | string;
  /** an actor's face, small (05-agent-list.js's crewFace); the gatherer agent's picture for one with none */
  crewFace(a: Actor | null, coordinator: boolean): Node;
  /** a message an app wrote with its own block (a Browser's), as the app draws it; null for any other */
  appWords(text: string): Node | null;
  /** the actor's avatar without its circle: where to get it */
  bareAvatar(info: Actor): string | null;
  /** the words in the actor's hue: a style ("color: ...") */
  hueInk(info: Actor): string | null;
  /** a message between actors (coordination.py's envelope) */
  envelope(text: string): Envelope | null;
  /** a message's words as matched with one stored, and whether two say the same */
  typedAs(text: string): string;
  sameWords(a: string, b: string): boolean;
  /** the page's icons: SVG paths in a 16x16 box */
  icons: Record<string, string>;
  /** the key that opens beside: ⌘ or Ctrl */
  beside: string;
  /** the page drawn again where the reader left it (keepingPlace(renderMain)): the turn list with it */
  redraw(): void;
  /** the files and commands folded to their bar, or shown (and drawn, unless `draw` is false) */
  foldSide(fold: boolean, draw?: boolean): unknown;
  /** a turn's files and commands shown: null, the latest's */
  setFilesTurn(n: number | null): Promise<unknown>;
  setChatView(id: string): unknown;
  /** the Esc sent is over: its turn is */
  interruptOver(): void;
}

/** A message between actors, or a watch's news (coordination.py's `envelope`, `update`). */
export interface Envelope {
  from: "coordinator" | "actor" | "update";
  id: string | null;
  name: string | null;
  text: string;
  how?: string;
  watch?: number;
}
