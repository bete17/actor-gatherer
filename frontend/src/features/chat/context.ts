// What every part of the turn list draws from: the feed of this draw and the old page's host (types.ts), and the folds
// (store.ts) as they were when the draw began.
import { createContext, useContext } from "react";
import type { Folds } from "./store";
import type { ChatFeed, ChatHost } from "./types";

export interface Chat {
  feed: ChatFeed;
  host: ChatHost;
  folds: Folds;
}

export const ChatContext = createContext<Chat | null>(null);

export function useChat(): Chat {
  const chat = useContext(ChatContext);
  if (!chat) throw new Error("the turn list draws inside its ChatContext (mount.tsx)");
  return chat;
}

/** The actor's words in its hue (the host's hueInk, a style "color: ..."), as React takes a style. */
export const inkOf = (style: string | null): { color: string } | undefined =>
  style ? { color: style.replace(/^color:\s*/, "") } : undefined;
