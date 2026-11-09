// What a panel asking `notify` asks (app_kit/DESIGN.md, "Panels"; the SDK's ag.notices): a notification sent to the
// user -- in the dashboard's list, as a pop-up, on this computer if allowed -- or one it sent cleared. The dashboard's
// routes record it in the gatherer (app_host.py's `notify`, `settle_notice`).
import { post } from "../../core/api/client";
import type { AppInfo } from "./host";

type Msg = Record<string, unknown> & { op?: string };

export const NOTICE_OPS = new Set(["notices.send", "notices.clear"]);

export async function toNotices(app: AppInfo, m: Msg, w: Record<string, string>): Promise<unknown> {
  if (!app.capabilities?.notify) throw new Error(`${app.label} may not send notifications`);
  if (m.op === "notices.clear") return post("/api/apps/notices/settle", { ...w, which: m.which, by: "app" });
  const n = { title: m.title, text: m.text, key: m.key, show: m.show, where: m.where };
  return (await post<{ id: string }>("/api/apps/notify", { ...w, ...n })).id;
}
