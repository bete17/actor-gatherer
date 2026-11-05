// In each Browser page (desktop/DESIGN.md, "What Electron leaves to the app"): the page's alert, confirm and prompt
// asked of the app, which waits for the answer while the page waits, as for a browser's own dialog -- given by the
// user in the dashboard's dialog, or by the agent (browsers.ts: shown to ag as Chrome's own dialog would be). Electron's
// own dialogs can't be closed when ag answers them, and has no prompt at all.
import { contextBridge, ipcRenderer } from "electron";

const ask = (type: string, message: unknown, given?: unknown): unknown =>
  ipcRenderer.sendSync("ag:dialog", { type, message: String(message ?? ""), default: given === undefined ? "" : String(given) });

contextBridge.executeInMainWorld({
  func: (ask: (type: string, message: unknown, given?: unknown) => unknown) => {
    window.alert = function alert(message?: unknown) {
      ask("alert", message);
    };
    window.confirm = function confirm(message?: unknown) {
      return !!ask("confirm", message);
    };
    window.prompt = function prompt(message?: unknown, given?: unknown) {
      const answer = ask("prompt", message, given);
      return answer === null || answer === undefined ? null : String(answer);
    } as typeof window.prompt;
  },
  args: [ask],
});
