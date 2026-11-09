// What a panel asking `message_actors` asks of its gatherer's actors (app_kit/DESIGN.md, "Panels"; the SDK's
// ag.actors): any of them messaged, its question answered, one started with a message, one shown -- not only the agents
// attached to its instance, as `message_agents` allows. The page does each as Chat would (its hooks).
import type { AppInfo, PaneHooks } from "./host";

type Msg = Record<string, unknown> & { op?: string };

export const ACTOR_OPS = new Set(["actors.send", "actors.answer", "actors.start", "actors.show"]);

export async function toActors(app: AppInfo, h: PaneHooks, m: Msg, gatherer: string): Promise<unknown> {
  if (!app.capabilities?.message_actors) throw new Error(`${app.label} may not message the actors`);
  const text = String(m.text || "");
  if (m.op === "actors.start") {
    if (!h.startActor) throw new Error("no actor can be started from here");
    if (!text.trim()) throw new Error("a new actor's first message, please");
    return h.startActor(gatherer, String(m.harness || ""), String(m.folder || ""), text);
  }
  const ch = String(m.channel || "");
  if (m.op === "actors.send") {
    if (!h.sendActor) throw new Error("no actor can be messaged from here");
    if (!text.trim()) throw new Error("an empty message");
    return h.sendActor(gatherer, ch, text);
  }
  if (!h.agentState(gatherer, ch)) throw new Error(`${ch}: not an actor of ${gatherer}`);
  if (m.op === "actors.answer") return h.answer(gatherer, ch, String(m.call || ""), m.choice);
  await h.showActor?.(gatherer, ch);
  return null;
}
