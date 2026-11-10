// An app's instance as its pane's head names it, and named there by the user (app_host.py's `rename`, POST
// /api/apps/rename): the app, then what the user called it -- else its own title, else its folder's name. Double-clicked,
// that name becomes a box: Enter, or leaving it, keeps what is typed; Esc leaves it as it was; nothing typed takes the
// user's name back, its own title shown again. The list names it the same way (src/legacy/05-agent-list.js's appShown).
import { post } from "../../core/api/client";
import type { AppInfo, Instance } from "./host";

/** What the head shows after the app's label: the user's name, else its title (not its label again), else its
 * folder's name. */
export function shownName(app: AppInfo, i: Instance): string {
  const title = i.title !== app.label ? i.title : "";
  return i.name || title || (i.folder || "").split("/").filter(Boolean).pop() || "";
}

/** The head's `who` drawn: the app's label, then its name; its title says the rest. Left as it is while it is named. */
export function drawWho(who: HTMLElement, app: AppInfo, i: Instance): void {
  if (who.querySelector("input")) return;
  const label = document.createElement("b");
  label.textContent = app.label;
  const where = shownName(app, i);
  const name = document.createElement("span");
  name.className = "app-where" + (i.name ? " named" : "");
  name.textContent = where;
  who.replaceChildren(label, ...(where ? [name] : []));
  who.title = [
    app.label,
    i.name,
    i.title,
    i.folder,
    `${i.gatherer} · ${i.id}`,
    `Double-click to ${i.name ? "rename" : "name"} it`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** A pane naming its instance: as it has it now, and what it does once it is renamed. */
export interface Nameable {
  readonly app: AppInfo;
  readonly instance: Instance;
  renamed: (got: Instance) => void;
}

/** `who`, double-clicked, made a box naming the pane's instance; the pane told once it is renamed -- left as it was, or
 * refused, its name drawn again as it was. */
export function nameable(who: HTMLElement, pane: Nameable): void {
  who.addEventListener("dblclick", (ev) => {
    ev.stopPropagation();
    nameIn(who, pane.app, pane.instance, (got) => (got ? pane.renamed(got) : drawWho(who, pane.app, pane.instance)));
  });
}

function nameIn(who: HTMLElement, app: AppInfo, i: Instance, done: (got: Instance | null) => void): void {
  if (who.querySelector("input")) return;
  const was = shownName(app, i);
  const box = document.createElement("input");
  box.className = "app-name-box";
  box.type = "text";
  box.maxLength = 120;
  box.spellcheck = false;
  box.autocomplete = "off";
  box.placeholder = i.title || app.label;
  box.setAttribute("aria-label", `This ${app.label}'s name`);
  box.value = was;
  let over = false;
  const end = async (keep: boolean) => {
    if (over) return;
    over = true;
    box.remove();
    const text = box.value.replace(/\s+/g, " ").trim();
    if (!keep || text === was) return done(null);
    done(
      await post<Instance>("/api/apps/rename", { gatherer: i.gatherer, instance: i.id, name: text }).catch(() => null),
    );
  };
  box.addEventListener("keydown", (ev) => {
    ev.stopPropagation(); // the page's own keys are not this box's
    if (ev.key === "Enter" && !ev.isComposing) {
      ev.preventDefault();
      void end(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      void end(false);
    }
  });
  box.addEventListener("blur", () => void end(true));
  box.addEventListener("dblclick", (ev) => ev.stopPropagation());
  box.addEventListener("pointerdown", (ev) => ev.stopPropagation()); // a press in it: not its head's (the pane selected)
  who.replaceChildren(box);
  box.focus();
  box.select();
}
