// ------------------------------------------------------------------ the list folded, or over the whole page
// The list's shape, kept in this browser: "list"; folded to a rail ("folded"), the actors at work or wanting the reader
// as their avatars; or over the whole page ("full"), the monitor -- left again for the shape it came from (listFrom),
// by its button, by Esc, or by picking an actor there. Over the whole page, the panes stay under it as they are: their
// terminals not resized, nor typed into.
const LIST_KEY = "ag-dashboard-list";
let listMode = "list", listFrom = "list";
const LIST_ICONS = {
  full: "M9.75 2.25h4v4M13.75 2.25l-4.5 4.5M6.25 13.75h-4v-4M2.25 13.75l4.5-4.5",
  unfull: "M13.75 2.25l-4.5 4.5M9.25 3v3.75H13M2.25 13.75l4.5-4.5M6.75 13V9.25H3",
  fold: "M11 6l-2 2 2 2", unfold: "M9 6l2 2-2 2",
};
function setListMode(mode, keep = true) {
  if (PANE || !["list", "folded", "full"].includes(mode)) mode = "list";
  if (mode === "full" && listMode !== "full") listFrom = listMode;
  const was = listMode;
  listMode = mode;
  document.documentElement.classList.toggle("list-folded", mode === "folded");
  document.documentElement.classList.toggle("list-full", mode === "full");
  document.documentElement.classList.toggle("list-was-folded", mode === "full" && listFrom === "folded");   // the panes as wide as they were
  drawListButtons();
  if (keep) { try { localStorage.setItem(LIST_KEY, JSON.stringify({ mode, from: listFrom })); } catch (e) { /* this page only */ } }
  if (mode === "full" && was !== "full") {          // what had the keys -- a terminal, a pane's frame -- has them no more
    const at = document.activeElement;
    if (at && at !== document.body && at.closest(".panes")) at.blur();
    document.getElementById("monitor").focus({ preventScroll: true });
  }
  if (mode !== "full") monForget();
  if (state.home) renderAgents();
}
// A column's width, dragged at its edge (grip): set as node's prop, at least min (its most: the stylesheet's
// max), kept under key; at(x) is the width the pointer at x gives. A double click: the stylesheet's width again.
function widthGrip(grip, key, node, prop, min, at) {
  const set = (w) => w > 0 ? node.style.setProperty(prop, `${Math.round(Math.max(min, w))}px`) : node.style.removeProperty(prop);
  try { set(Number(localStorage.getItem(key))); } catch (e) { /* this page only */ }
  grip.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const box = document.getElementById("panes");
    grip.classList.add("on"); box.classList.add("resizing");   // the frames let the pointer by while it drags
    const move = (e) => set(at(e.clientX));
    const up = () => {
      grip.classList.remove("on"); box.classList.remove("resizing");
      grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
      try { localStorage.setItem(key, String(parseInt(node.style.getPropertyValue(prop)) || "")); } catch (e) { /* this page only */ }
    };
    grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
  });
  grip.addEventListener("dblclick", () => { set(0); try { localStorage.removeItem(key); } catch (e) { /* this page only */ } });
}
widthGrip(document.getElementById("side-grip"), "ag-dashboard-side-width", document.documentElement, "--side-w", 200,
  (x) => x - document.querySelector(".side").getBoundingClientRect().left);
// the folded rail's own width (--rail-w), its right edge dragged as the list's is: 76px at the least, 360px at the most
const RAIL_GRIP = el("div", { class: "rail-grip", "aria-hidden": "true", title: "Drag to widen the rail · double-click: as narrow as it was" });
document.querySelector(".side").append(RAIL_GRIP);
widthGrip(RAIL_GRIP, "ag-dashboard-rail-width", document.documentElement, "--rail-w", 76,
  (x) => Math.min(360, x - document.querySelector(".side").getBoundingClientRect().left));
// its two buttons, as the list is: over the whole page (or back), and folded (or open again; none over the page)
function listButtons() {
  const full = listMode === "full", folded = listMode === "folded";
  const fold = folded ? "Open the list" : "Fold the list";
  return [el("button", { class: "list-btn lb-full", type: "button", "aria-pressed": full ? "true" : "false",
      title: full ? "Back to the list (Esc)" : "Every actor over the whole page: what each is doing",
      "aria-label": full ? "Leave full screen" : "Full screen", onclick: () => full ? leaveFull() : setListMode("full") },
      strokeIcon(full ? LIST_ICONS.unfull : LIST_ICONS.full)),
    full ? null : el("button", { class: "list-btn lb-fold", type: "button", "aria-expanded": folded ? "false" : "true", title: fold,
      "aria-label": fold, onclick: () => setListMode(folded ? "list" : "folded") },
      strokeIcon(ICONS.sidebar + (folded ? LIST_ICONS.unfold : LIST_ICONS.fold)))];
}
function drawListButtons() { document.getElementById("list-btns").replaceChildren(...listButtons().filter(Boolean)); }
const leaveFull = () => setListMode(listFrom === "full" ? "list" : listFrom);
document.addEventListener("keydown", (ev) => {        // first: Esc closes the settings first, if they are open
  if (ev.key !== "Escape" || listMode !== "full" || !document.getElementById("about").hidden || window.agNext.settings.fileOpen()) return;
  ev.preventDefault();
  leaveFull();
}, true);
// The list in the shape it is in: the rail, or the monitor, drawn from the home (the list itself is drawn all the same).
function renderFolded() {
  if (listMode === "folded") renderRail();
  else if (listMode === "full") renderMonitor();
  if (hover.from === "rail" && listMode !== "folded") cardHide();
}
// The rail: the list, small. Each gatherer not hidden, its name over its actors -- a button folding it, as the list's
// does (folded, the counts the list shows for it); hovered, its card has its buttons (gathererCard) -- then its box as
// the list has it (railBox): each of its folders, folded, its name as a gatherer's is, and under it, as under a folded
// gatherer, how many wait on the reader, stopped on an error, run (railFolded) -- a click opens it in place, its actors
// and folders set in under its name, a line down their left; hovered, a folder's name has its card with its buttons and
// its actors (folderCard); a double-click on a gatherer's or folder's name shows only it (railHere) -- then its actors
// open, then its saved and closed ones, folded as the list folds
// them, to a line here too that opens them (the one shown staying in view). Each actor its avatar, its status's dot at
// its corner, and its name in small under it; hovered (or in focus from the keys), a card beside the rail says who it
// is (actorCard) -- a folder's, what it holds (folderCard) -- and an actor's bookmark and × show in its top corners. A
// click shows it, as in the list.
// The rail drilled into a gatherer or a folder (a double-click on its name, or its card's "Show only it"): only the tree
// from there, under "Up" (the folder it is in; from a gatherer's top, every gatherer) and "Root" (every gatherer).
// `railAt`: {g, f} (a gatherer's name, a folder's id; f null: the gatherer's top), or null: every gatherer. Kept across
// reloads; gone (a folder deleted, a gatherer hidden): its gatherer's top, or every gatherer.
const RAIL_AT_KEY = "ag-dashboard-rail-at";
let railAt = (() => {
  try { const v = JSON.parse(localStorage.getItem(RAIL_AT_KEY)); if (v && v.at && typeof v.at.g === "string") return v.at; } catch (e) { /* none kept */ }
  return null;
})();
let railMoved = false;                                // stepped in or out: the rail drawn from its top
const sameAt = (x, y) => (!x && !y) || (!!x && !!y && x.g === y.g && x.f === y.f);
// where `at` is, as it is now: {g, f} (the gatherer, the folder or null), or null: gone
function railFind(at) {
  const g = at && state.home.gatherers.find((x) => x.name === at.g && !isHidden(x));
  if (!g) return null;
  if (at.f === null) return { g, f: null };
  const f = folderById(g.name, at.f);
  return f ? { g, f } : null;
}
function railGo(at) {
  railAt = at; railMoved = true;
  try { localStorage.setItem(RAIL_AT_KEY, JSON.stringify({ at: railAt })); } catch (e) { /* this page only */ }
  cardHide(); renderRail();
}
const railDrill = (at) => { if (!sameAt(at, railAt)) railGo(at); };
// one level up from where the rail is (`here`, as railFind finds it): a folder's, the folder it is in or its
// gatherer's top; a gatherer's top's, every gatherer
const railUp = ({ g, f }) => railGo(f ? { g: g.name, f: parentOf(g.name, f) } : null);
// A click on a gatherer's or a folder's name in the rail folds or opens it; the second of a double-click folds it back
// as it was, and the rail shows only it (railDrill)
const railNameClick = (fold, at) => (ev) => { cardHide(); fold(); if (ev.detail === 2) railDrill(at); };
// The rail drilled in (railAt): Up and Root, where it is (the path to it small over its name, its card hovered), then
// what is in it as the list has it -- a gatherer's top, its gatherer agent first
function railHere(here) {
  const { g, f } = here, up = f ? parentOf(g.name, f) : null, crew = g.agents.find(isCoordinator);
  // the places above it, the gatherer first: a step each, a click showing only it
  const steps = [];
  if (f) {
    const seen = new Set();
    for (let k = up === null ? null : folderById(g.name, up); k && !seen.has(k.id); k = folderById(g.name, parentOf(g.name, k))) {
      seen.add(k.id); steps.unshift({ name: k.name, at: { g: g.name, f: k.id } });
    }
    steps.unshift({ name: titleOf(g), at: { g: g.name, f: null } });
  }
  return el("section", { class: "r-gatherer open r-drilled", "aria-label": f ? f.name : titleOf(g) },
    el("div", { class: "r-nav" },
      el("button", { class: "r-navb up", type: "button", title: f ? `Up: ${up === null ? titleOf(g) : folderById(g.name, up).name}` : "Up: every gatherer",
        onclick: () => railUp(here) }, strokeIcon(ICONS.up, 13), el("span", { text: "Up" })),
      el("button", { class: "r-navb root", type: "button", title: "Root: every gatherer", onclick: () => railGo(null) },
        strokeIcon(ICONS.home, 13), el("span", { text: "Root" }))),
    el("div", { class: "r-here" + (f ? " folder" : "") },
      steps.length ? el("div", { class: "r-path", role: "group", "aria-label": "Where it is" },
        ...steps.map((s) => el("button", { class: "r-step", type: "button", title: `${s.name}: show only it`, onclick: () => railGo(s.at) },
          el("span", { class: "nm", text: s.name }), el("span", { class: "sep", "aria-hidden": "true", text: "›" })))) : null,
      el("div", { class: "r-hname", "data-card": key(g.name, f ? `folder:${f.id}` : "gatherer:") }, ...breakable(f ? f.name : titleOf(g)))),
    !f && crew && !crewHidden.has(g.name) ? railActor(g, crew) : null,
    ...railBox(g, f ? f.id : null));
}
// Over the rail, every gatherer's actors open (its gatherer agent left out, as a folder's counts leave it), counted by
// what they do -- waiting for the reader, stopped on an error, running (in the background too), finished and not yet
// seen, idle -- each a dot of its colour and a number, none for a state no actor is in. The whole home's, wherever the
// rail is drilled to, so what needs the reader elsewhere still shows.
function railTotals(shown) {
  const t = { asking: 0, error: 0, running: 0, background: 0, finished: 0, idle: 0 };
  for (const g of shown) for (const a of g.agents) {
    if (isCoordinator(a)) continue;
    const group = groupOf(g, a);
    if (group === "Waiting for you") t.asking++; else if (group === "Error") t.error++; else if (group === "Running") t.running++;
    else if (group === "Background") t.background++; else if (group === "Finished") t.finished++; else if (group === "Idle") t.idle++;
  }
  const chip = (k, cls, what) => k ? el("span", { class: `count ${cls}`, title: `${k} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  const chips = [chip(t.asking, "asking", "waiting for you"), chip(t.error, "error", "stopped on an error"),
    chip(t.running + t.background, "running", t.background ? `running (${t.background} in the background)` : "running"),
    chip(t.finished, "finished", "finished, not yet seen"), chip(t.idle, "idle", "idle")].filter(Boolean);
  return chips.length ? el("div", { class: "r-totals", role: "group", "aria-label": `Every gatherer's actors: ${chips.map((c) => c.title).join(", ")}` },
    ...chips) : null;
}
function renderRail() {
  const shown = state.home.gatherers.filter((g) => !isHidden(g));
  const list = el("div", { class: "r-actors" });
  // drilled in: there, or, it gone, its gatherer's top, or every gatherer
  const here = railAt ? railFind(railAt) || railFind({ g: railAt.g, f: null }) : null;
  if (here) list.append(railHere(here));
  for (const g of here ? [] : shown) {
    const open = !collapsed.has(g.name), crew = g.agents.find(isCoordinator);
    const sec = el("section", { class: "r-gatherer" + (open ? " open" : ""), "aria-label": titleOf(g) },
      el("button", { class: "r-gname", type: "button", "aria-expanded": open ? "true" : "false", "data-card": key(g.name, "gatherer:"),
        ...(HOVERS.matches ? {} : { title: `${titleOf(g)}${titleOf(g) !== g.name ? ` (${g.name})` : ""}: ${open ? "fold it" : "show its actors"} · double-click: only it` }),
        onclick: railNameClick(() => toggleGatherer(g.name), { g: g.name, f: null }) },
        el("span", { class: "tx" }, el("span", { class: "caret", text: "▶" }),
          el("span", { class: "nm", text: titleOf(g) }))));
    if (!open) {                                      // folded: its counts, and those of its actors open in the panes
      const counts = gathererCounts(g);
      if (counts.length) sec.append(el("div", { class: "r-counts" }, ...counts));
      for (const a of g.agents) if (openActors().some((sel) => isAt(sel, g.name, a.channel))) sec.append(railActor(g, a));
    } else {
      // what is in it, in one box under its name (r-kids), set in, a line down its left: a tree, as the list's folders are
      sec.append(el("div", { class: "r-kids" }, crew && !crewHidden.has(g.name) ? railActor(g, crew) : null, ...railBox(g, null)));
    }
    list.append(sec);
  }
  if (!shown.length) list.append(el("div", { class: "r-none", text: state.home.gatherers.length ? "Every gatherer is hidden" : "No gatherers" }));
  // its buttons -- open the list, settings, full screen -- the header's, in one row over it (01-layout.css); then the
  // totals of what every actor does (railTotals), then the tree
  const rail = document.getElementById("rail"), was = rail.querySelector(".r-actors");
  const top = was ? was.scrollTop : 0, across = was ? was.scrollLeft : 0;
  rail.replaceChildren(...[railTotals(shown), list].filter(Boolean));
  list.scrollTop = railMoved ? 0 : top; list.scrollLeft = railMoved ? 0 : across;   // drawn again where the reader had scrolled it
  railMoved = false;
  if (hover.from === "rail") cardDraw();
}
// A gatherer's or a folder's box in the rail (`id` null: the gatherer's top), as the list's (boxRows): its folders -- each
// its name, or, opened, its name and what is in it set in under it -- its actors open, its saved and closed folds (its
// terminals: in the list only).
function railBox(g, id) {
  const out = [];
  for (const f of kidFolders(g.name, id)) {
    if (isOpenFolder(g.name, f.id)) {
      out.push(el("div", { class: "r-fopen", role: "group", "aria-label": f.name },
        el("button", { class: "r-fhead", type: "button", "aria-expanded": "true", "data-card": key(g.name, `folder:${f.id}`),
          title: `${f.name}: fold it · double-click: only it`, onclick: railNameClick(() => toggleFolder(g.name, f.id), { g: g.name, f: f.id }) },
          el("span", { class: "tx" }, el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "nm", text: f.name }))),
        el("div", { class: "r-kids" }, ...railBox(g, f.id))));
    } else {
      out.push(railFolded(g, f));
      for (const a of openIn(g, f.id)) out.push(railActor(g, a));   // folded: those open in a pane, in view
    }
  }
  for (const [name, items] of boxGroups(g, id)) {
    if (name === SHELLS) continue;
    if (name === "Saved" || name === "Closed") {
      const k = boxKey(g.name, id), unfolded = foldOpen[name].has(k), what = name.toLowerCase();
      out.push(el("button", { class: "r-fold", type: "button", "aria-expanded": unfolded ? "true" : "false",
        title: `${unfolded ? "Hide" : "Show"} the ${what} actors`, onclick: () => toggleFold(name, k) },
        `${unfolded ? "▾" : "▸"} `, name === "Saved" ? el("span", { class: "fold-mark", "aria-hidden": "true" }, saveIcon(true)) : null,
        `${items.length} ${what}`));
      for (const a of unfolded ? items : items.filter((a) => inPane(g, a))) out.push(railActor(g, a));
      continue;
    }
    for (const a of items) out.push(railActor(g, a));
  }
  return out;
}
// A folded folder in the rail, as a folded gatherer is: its name -- a button opening it in place -- with how many actors
// it holds open, and under it how many of those wait on the reader, stopped on an error, run (its folders' too).
function railFolded(g, f) {
  const t = folderTally(g, f.id), counts = tallyChips(t, plural(t.open, "actor"));
  return el("div", { class: "r-ffold" },
    el("button", { class: "r-fname", type: "button", "aria-expanded": "false", "data-card": key(g.name, `folder:${f.id}`),
      "aria-label": `${f.name}, a folder: ${plural(t.open, "actor")} open`, ...(HOVERS.matches ? {} : { title: folderSays(f, t) }),
      onclick: railNameClick(() => toggleFolder(g.name, f.id), { g: g.name, f: f.id }) },
      el("span", { class: "tx" }, el("span", { class: "caret", "aria-hidden": "true", text: "▶" }),
        el("span", { class: "nm", text: f.name }))),
    counts.length ? el("div", { class: "r-counts" }, ...counts) : null);
}
// A name in a narrow column, broken after its _, - or . where it must break: "making_" over "ag", not "making_a" over "g".
const breakable = (text) => String(text).split(/(?<=[_\-.])/).flatMap((part, i) => i ? [el("wbr"), part] : [part]);
// What the rail writes under an actor's avatar, and its card at its top: its name, else what it was last asked (a message
// from another actor, as the list says it), else that it has had none.
function railName(a) {
  if (a.name && a.name.text) return { text: a.name.text, cls: "" };
  const env = envelope(a.last_user_message), asked = env ? crewLine(env) : a.last_user_message;
  if (asked) return { text: firstLine(asked, 160), cls: "unnamed" };
  return { text: isCoordinator(a) ? "Gatherer agent" : "No message yet", cls: "none" };
}
function railActor(g, a) {
  const [cls, label] = statusOf(a);
  const current = isAt(focusedActor(), g.name, a.channel);
  const open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const nm = railName(a);
  return el("button", { class: "r-actor", type: "button", "data-card": key(g.name, a.channel), "aria-current": current ? "true" : "false",
    ...(open ? { "data-open": "true" } : {}), "aria-label": `${nm.text}, in ${titleOf(g)}: ${label}`,
    // where there is no hovering (a touch screen), the card's words as its title
    ...(HOVERS.matches ? {} : { title: `${nm.text}\n${label} · ${ago(a.last)} · ${titleOf(g)}` }),
    onclick: (ev) => { cardHide(); pick(g.name, a.channel, ev); }, oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev) },
    el("span", { class: "r-pic" }, actorLogo(a), el("i", { class: `rd ${cls}`, "aria-hidden": "true", style: `--spin-at: -${Date.now() % 1200}ms` })),
    el("span", { class: "r-name" + (nm.cls === "none" ? " none" : ""), "aria-hidden": "true", text: nm.text }),
    // the list's bookmark and × (saveButton, closeButton), in the corners over its avatar: shown while hovered, in focus or
    // the one shown (a saved one's bookmark always, filled)
    saveButton(g, a), closeButton(g, a));
}
// The card an actor shows while hovered, in the rail or the list (or in focus from the keys): its avatar and name, its
// gatherer and harness, its directory, its status, when it last did something and its size, what it was last asked
// (under its name, if it has one), its recap, what runs in the background, its branch. Beside the rail or the list (under
// the actor, where there is no room beside: the rail across a phone's top, the list as wide as the page), level with the
// actor, inside the window; the pointer passes through it (but a live card's: cardLive). It waits a moment the first
// time (HOVER_WAIT), then follows
// the pointer from actor to actor at once; none over an actor's own buttons, which say what they do. Kept by where it
// came from and the actor's key (data-card): the rail or the list drawn again under it, the card is said again from the
// new data, at the actor's new place. Where there is no hovering (a touch screen), the actor's title says it instead.
const HOVERS = matchMedia("(hover: hover)");
const HOVER_WAIT = 250, hover = { from: null, key: null, shown: false, timer: null, node: null };
const HOVER_FROM = { rail: () => listMode === "folded", agents: () => listMode === "list" };
function hoverTo(from, k) {
  clearTimeout(hover.timer);
  if (!k) { hover.timer = setTimeout(cardLetGo, cardLive() ? 300 : 120); return; }
  if (k === hover.key && from === hover.from && hover.shown) return;
  const go = () => { hover.from = from; hover.key = k; hover.shown = true; cardDraw(); };
  // a live card shown: the pointer, on its way to it, may cross another item -- switched only once it lingers there
  // (CARD_ON_THE_WAY), the card's own pointerenter keeping it
  if (hover.shown && cardLive()) hover.timer = setTimeout(go, CARD_ON_THE_WAY);
  else if (hover.shown) go(); else hover.timer = setTimeout(go, HOVER_WAIT);
}
const CARD_ON_THE_WAY = 250;
function cardHide() {
  clearTimeout(hover.timer);
  hover.from = null; hover.key = null; hover.shown = false;
  cardEdit = null; cardInput = null;
  if (hover.node) hover.node.hidden = true;
}
// A LIVE card -- a folder's or a gatherer's, in the rail -- is one to use, not only read: the pointer may go onto it,
// and it stays while the pointer, a menu opened from it, or its name box is on it, or something starts (cardLetGo); its buttons do what the
// list's do on the folder's line or the gatherer's row, its name box names there (cardEdit), and a click on one of its
// actors shows it.
const cardLive = () => !!hover.node && !hover.node.hidden && hover.node.classList.contains("live");
function cardLetGo() {
  const card = hover.node;
  if (cardLive() && state.starting) { hover.timer = setTimeout(cardLetGo, 300); return; }   // what it started: its answer, first
  if (cardLive() && (card.matches(":hover") || (cardEdit && card.contains(document.activeElement))
    || (rowPop.el && card.contains(popButton())))) return;
  cardHide();
}
// a menu opened from the card closed: the card let go of too, once the pointer is not on it
function cardRelease() { if (cardLive() && !hover.node.matches(":hover")) hoverTo(hover.from, null); }
function cardDraw() {
  const box = hover.from && document.getElementById(hover.from);
  const at = box && [...box.querySelectorAll("[data-card]")].find((n) => n.dataset.card === hover.key);
  const [gname, channel] = (hover.key || "").split("\u0000");
  const g = state.home && state.home.gatherers.find((x) => x.name === gname), a = g && g.agents.find((x) => x.channel === channel);
  const f = g && !a && /^folder:\d+$/.test(channel || "") ? folderById(g.name, Number(channel.slice(7))) : null;
  const top = !!g && !a && channel === "gatherer:";
  if (!at || !(a || f || top) || !HOVER_FROM[hover.from]()) { cardHide(); return; }
  if (!hover.node) {
    hover.node = el("div", { class: "actor-card", id: "actor-card", role: "tooltip" });
    hover.node.addEventListener("pointerenter", () => clearTimeout(hover.timer));
    hover.node.addEventListener("pointerleave", () => { if (cardLive()) hoverTo(hover.from, null); });
    document.body.append(hover.node);
  }
  const card = hover.node, live = hover.from === "rail" && !SNAPSHOT && (!!f || top);
  card.classList.toggle("live", live);
  card.setAttribute("role", live ? "group" : "tooltip");
  if (live) card.setAttribute("aria-label", f ? `The folder ${f.name}` : `The gatherer ${titleOf(g)}`); else card.removeAttribute("aria-label");
  const typing = cardInput && document.activeElement === cardInput && [cardInput.selectionStart, cardInput.selectionEnd];
  cardMoving = true;                                 // its name box taken out and put back: not a blur that ends it
  card.replaceChildren(...(f ? folderCard(g, f, live) : top ? gathererCard(g)
    : actorCard(g, a, hover.from === "agents" && isAt(focusedActor(), g.name, a.channel))));
  cardMoving = false;
  if (typing && cardInput && cardInput.isConnected) { cardInput.focus({ preventScroll: true }); cardInput.setSelectionRange(...typing); }
  card.hidden = false;
  at.setAttribute("aria-describedby", "actor-card");
  const r = at.getBoundingClientRect(), side = box.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  if (side.width > side.height || side.right + 8 + w > innerWidth) {      // no room beside it: under the actor
    card.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
    card.style.top = `${clamp(hover.from === "rail" ? side.bottom + 6 : r.bottom + 4, 8, innerHeight - h - 8)}px`;
  } else {
    card.style.left = `${side.right + 8}px`;
    card.style.top = `${clamp(r.top + r.height / 2 - h / 2, 8, innerHeight - h - 8)}px`;
  }
}
// a path's end, where it tells one actor's from another's: its worktree, its project
const tail = (t, n) => t.length > n ? "…" + t.slice(-(n - 1)) : t;
// `shown`: the one shown, in the list, whose name is renamed by clicking it -- said at its foot
function actorCard(g, a, shown = false) {
  const [cls, label] = statusOf(a), nm = railName(a), size = a.real_tokens ?? a.sent_tokens;
  const env = envelope(a.last_user_message), asked = env ? crewLine(env) : a.last_user_message;
  const bg = a.background || [], dir = cwdOf(a);
  const hint = [SNAPSHOT ? "Click to show it" : `Click to show it · ${BESIDE_KEY}+click: beside the one shown`];
  if (shown && !SNAPSHOT) hint.splice(0, 1, `${nameNote(g, a).trim() ? `${nameNote(g, a).trim()} · ` : ""}Click its name (or F2) to ${a.name && a.name.text ? "rename" : "name"} it`);
  return [
    el("div", { class: "c-who" }, actorLogo(a),
      el("div", { class: "tx" }, el("div", { class: "c-nm" + (nm.cls ? ` ${nm.cls}` : ""), text: nm.text }),
        el("div", { class: "c-sub", text: `${titleOf(g)} · ${harnessName(a.harness)}` }))),
    dir ? el("div", { class: "c-dir", title: dir, text: tail(tildePath(dir, state.home.home_dir), 44) }) : null,
    el("div", { class: "c-st" }, el("span", { class: `status ${cls}` }, el("i", { "aria-hidden": "true" }), label),
      el("span", { text: [ago(a.last), size !== null && size !== undefined ? `${compact(size)} tokens` : null].filter(Boolean).join(" · ") }),
      // saved: said here, the rail's bookmark showing only while hovered
      !isCoordinator(a) && savedAs(g.name, a) ? el("span", { class: "c-saved" }, saveIcon(true), "Saved") : null),
    asked && nm.cls !== "unnamed" ? el("div", { class: "c-asked" }, el("span", { class: "lbl", text: "Asked" }), firstLine(asked, 400)) : null,
    a.recap && a.recap.text ? el("div", { class: "c-recap" }, el("span", { class: "lbl", text: "Recap" }), a.recap.text) : null,
    bg.length ? el("div", { class: "c-bg", text: `${bg.length} in background · ${bg.map((t) => t.label || t.id).join(", ")}` }) : null,
    branchChip(g, a),
    el("div", { class: "c-hint", text: hint.join(" · ") }),
  ].filter(Boolean);
}
// A folder's card: its name and where it is, then what is in it as a tree, its first level shown (cardTree). Live (in
// the rail): its buttons first, as its line's in the list -- "+ actor", "+ ⋯", a new folder in it, rename, delete -- its
// name box under them while one is named, a folder in the tree opened in place by a click (`cardOpen`, for as long as
// the card shows this folder), an actor shown by one (⌘/Ctrl: beside the one shown), and its foot a button opening the
// folder in the rail.
let cardOpen = { key: null, ids: new Set() };
function folderCard(g, f, live = false) {
  if (cardOpen.key !== hover.key) cardOpen = { key: hover.key, ids: new Set() };   // another card: its tree as it starts
  const up = parentOf(g.name, f), rows = cardTree(g, f.id, 0, live);
  return [
    el("div", { class: "c-who" }, el("span", { class: "c-folder" }, strokeIcon(ICONS.folder, 18)),
      el("div", { class: "tx" }, el("div", { class: "c-nm", text: f.name }),
        el("div", { class: "c-sub", text: [titleOf(g), up === null ? null : folderPath(g.name, up)].filter(Boolean).join(" / ") }))),
    live ? el("div", { class: "c-acts" }, ...cardStarts(g, f),
      cardAct("new", `New folder in ${f.name}`, strokeIcon(ICONS.folderNew, 14), () => editInCard({ g: g.name, id: null, parent: f.id })),
      cardAct("rename", `Rename ${f.name}`, strokeIcon(ICONS.pencil, 13), () => editInCard({ g: g.name, id: f.id, parent: up })),
      cardAct("delete", `Delete ${f.name}: what is in it moves up a level`, closeIcon(), () => { cardHide(); deleteFolder(g.name, f.id); })) : null,
    live ? cardEditBox(g.name) : null,
    rows.length ? el("div", { class: "c-tree" }, ...rows) : el("div", { class: "c-st", text: "Empty" }),
    // in the rail: opened there, or, the rail drilled into it, nothing to open
    live ? (sameAt(railAt, { g: g.name, f: f.id }) ? null : el("button", { class: "c-more", type: "button",
      onclick: () => { cardHide(); showFolder(g.name, f.id, true); renderAgents(); } }, "Open it in the rail ›"))
      : el("div", { class: "c-hint", text: "Click to open or fold it" }),
    live && !sameAt(railAt, { g: g.name, f: f.id }) ? el("button", { class: "c-more only", type: "button", onclick: () => railDrill({ g: g.name, f: f.id }) },
      "Show only it ›") : null,
  ].filter(Boolean);
}
// What is in folder `id`, as the list has it (boxGroups), `depth` in: its folders, each with how many actors it holds open
// (its own folders' too) -- opened, what is in it under it -- then its actors open, then how many of its actors are
// saved and closed. Live, a folder's row a button opening or folding it, an actor's one showing it.
function cardTree(g, id, depth, live) {
  const out = [], pad = { style: `--depth: ${depth}` };
  for (const k of kidFolders(g.name, id)) {
    const open = live && cardOpen.ids.has(k.id), n = folderTally(g, k.id).open;
    const parts = [el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "g" }, strokeIcon(open ? ICONS.folderOpen : ICONS.folder, 14)),
      el("span", { class: "nm", text: k.name }), el("span", { class: "st", text: n ? String(n) : "" })];
    out.push(live ? el("button", { class: "c-row c-frow", type: "button", "aria-expanded": open ? "true" : "false", ...pad,
      title: `${open ? "Fold" : "Open"} ${k.name}`, onclick: (ev) => {
        ev.stopPropagation();
        if (open) cardOpen.ids.delete(k.id); else cardOpen.ids.add(k.id);
        cardDraw();
      } }, ...parts) : el("div", { class: "c-row c-frow", ...pad }, ...parts));
    if (open) out.push(...cardTree(g, k.id, depth + 1, live));
  }
  const groups = new Map(boxGroups(g, id));
  for (const a of groups.get(OPEN) || []) {
    const [cls, label] = statusOf(a);
    const parts = [el("span", { class: `status ${cls}` }, el("i", { "aria-hidden": "true" })), actorLogo(a),
      el("span", { class: "nm", text: railName(a).text }), el("span", { class: "st", text: label })];
    out.push(live ? el("button", { class: "c-row", type: "button", ...pad, title: `Show it · ${BESIDE_KEY}+click: beside the one shown`,
      onclick: (ev) => { cardHide(); pick(g.name, a.channel, ev); } }, ...parts) : el("div", { class: "c-row", ...pad }, ...parts));
  }
  const rest = [["Saved", "saved"], ["Closed", "closed"]].map(([k, w]) => (groups.get(k) || []).length ? `${groups.get(k).length} ${w}` : null).filter(Boolean);
  if (rest.length) out.push(el("div", { class: "c-rest", ...pad, text: rest.join(" · ") }));
  return out;
}
// A gatherer's card, in the rail: its name, how many actors it holds open and how many folders, and its buttons, as its
// row's in the list -- "+ actor", "+ ⋯", a new folder, rename, hide -- its name box under them while one is named.
function gathererCard(g) {
  const open = g.agents.filter((a) => !isCoordinator(a) && !["Saved", "Closed"].includes(groupOf(g, a))).length;
  const folders = treeOf(g.name).folders.length, counts = gathererCounts(g);
  return [
    el("div", { class: "c-who" }, el("span", { class: "c-folder" }, strokeIcon(ICONS.folder, 18)),
      el("div", { class: "tx" }, el("div", { class: "c-nm", text: titleOf(g) }),
        el("div", { class: "c-sub", text: [`${plural(open, "actor")} open`, folders ? plural(folders, "folder") : null].filter(Boolean).join(" · ") }))),
    counts.length ? el("div", { class: "c-counts" }, ...counts) : null,
    el("div", { class: "c-acts" }, ...cardStarts(g, null),
      cardAct("newfolder", `New folder in ${titleOf(g)}`, strokeIcon(ICONS.folderNew, 14), () => editInCard({ g: g.name, id: null, parent: null })),
      cardAct("rename", `Rename ${titleOf(g)}`, strokeIcon(ICONS.pencil, 13), () => editInCard({ g: g.name, gatherer: true })),
      cardAct("hide", `Hide ${g.name}`, hideIcon(), () => { cardHide(); setHidden(g, true); })),
    cardEditBox(g.name),
    sameAt(railAt, { g: g.name, f: null }) ? null : el("button", { class: "c-more only", type: "button", onclick: () => railDrill({ g: g.name, f: null }) },
      "Show only it ›"),
    el("div", { class: "c-hint", text: `Click its name to ${collapsed.has(g.name) ? "show" : "fold"} its actors · double-click: only it` }),
  ].filter(Boolean);
}
// A card's "+ actor" and "+ ⋯", started in its folder (`f`; null: its gatherer's top): the rail's own (railNew, railMore)
// -- the directory asked in a box beside them, if none is known or starting there fails, the list being folded away
const cardStarts = (g, f) => [railNew(g, f, "act start new-actor"), railMore(g, f, "act start new-more")].filter(Boolean);
const cardAct = (cls, title, icon, fn) => el("button", { class: `act ${cls}`, type: "button", title, "aria-label": title,
  onclick: (ev) => { ev.stopPropagation(); fn(); } }, icon);
// The card's name box: a folder named or made (`cardEdit`: {g, id -- null, made in `parent` -- parent}), or the gatherer
// renamed ({g, gatherer: true}), as the list's own box does, which is out of sight with the list folded. One element for
// as long as it is open (`cardInput`), put back in each redraw of the card (`cardMoving`), its caret kept. Enter, or
// leaving it, keeps what is typed; Esc, or nothing typed, leaves it.
let cardEdit = null, cardInput = null, cardMoving = false;
function editInCard(edit) {
  const g = state.home.gatherers.find((x) => x.name === edit.g);
  cardEdit = { ...edit, key: hover.key, value: edit.gatherer ? (g ? titleOf(g) : edit.g) : edit.id !== null && edit.id !== undefined ? (folderById(edit.g, edit.id) || {}).name || "" : "" };
  cardInput = null;
  cardDraw();
  if (cardInput) { cardInput.focus(); cardInput.select(); }
}
function cardEditBox(gname) {
  const e = cardEdit;
  if (!e || e.g !== gname || e.key !== hover.key) return null;   // the card it was opened in only
  if (!cardInput) {
    cardInput = el("input", { class: "name-box c-box", type: "text", maxlength: String(e.gatherer ? 120 : FOLDER_CHARS), spellcheck: "false",
      autocomplete: "off", placeholder: e.gatherer ? gname : "Folder name", "aria-label": e.gatherer ? "This gatherer's name" : "The folder's name" });
    cardInput.value = e.value;
    cardInput.addEventListener("input", () => { e.value = cardInput.value; });
    cardInput.addEventListener("keydown", (ev) => {
      ev.stopPropagation();                          // the page's own keys are not this box's
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); endCardEdit(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); endCardEdit(false); }
    });
    cardInput.addEventListener("blur", () => { if (!cardMoving && document.hasFocus() && cardEdit === e) endCardEdit(true); });
  }
  const what = e.gatherer ? "Its name" : e.id === null || e.id === undefined ? "A new folder's name" : "The folder's name";
  return el("label", { class: "c-edit" }, what, cardInput);
}
function endCardEdit(keep) {
  const e = cardEdit;
  if (!e) return;
  cardEdit = null; cardInput = null;
  if (keep && e.gatherer) {
    const g = state.home.gatherers.find((x) => x.name === e.g), text = e.value.replace(/\s+/g, " ").trim();
    if (g && text !== titleOf(g)) keepTitle(e.g, text);
  } else if (keep) nameFolder(e.g, e.id ?? null, e.parent ?? null, e.value);
  if (hover.node && !hover.node.hidden) cardDraw();
}
for (const from of Object.keys(HOVER_FROM)) {
  const box = document.getElementById(from);
  box.addEventListener("pointerover", (ev) => {
    if (ev.pointerType === "touch") return;
    const at = ev.target.closest("[data-card]");
    hoverTo(from, at && !ev.target.closest(".save-btn, .close-btn, .chat-icon, .branchline, .f-acts, .pick") ? at.dataset.card : null);
  });
  box.addEventListener("pointerleave", () => hoverTo(from, null));
  box.addEventListener("focusin", (ev) => {
    const at = ev.target.closest("[data-card]");
    if (at && ev.target === at && at.matches(":focus-visible")) { hover.shown = true; hoverTo(from, at.dataset.card); }
  });
  box.addEventListener("focusout", () => hoverTo(from, null));
  box.addEventListener("scroll", () => { if (hover.shown && hover.from === from) cardDraw(); }, true);   // kept level with its actor
}
addEventListener("resize", () => { if (hover.shown) cardDraw(); });
// The monitor: every actor of the gatherers not hidden, a column for each group of the list that has any, side by side
// -- those wanting the reader first, then those at work, then those at rest (MON_ORDER), Closed last; Saved and Closed folded
// to a strip until opened, each column's fold kept in this browser -- and in each, a card for each actor: who it is, its status,
// and what it is doing -- what it waits on the reader for, its error, what it runs now and its newest calls, what runs
// in the background, or once done, what it said last -- with the files its latest turn worked on. What its turn did
// is read from the server (monitor.py) for the cards in view, again when the actor changes (monSig), at most every
// MON_GAP ms. A card, a column, and each column's place are only redrawn where they changed, so an actor at work goes
// on as it was (its stage, its glyphs: on the page's clock).
const MON_FOLD_KEY = "ag-dashboard-monitor-folded", MON_GAP = 1000, MON_BATCH = 24;
const MON_ORDER = ["Waiting for you", "Error", "Running", "Background", "Finished", "Idle", "Saved", "Closed"];
const monFolded = (() => {
  try { const v = JSON.parse(localStorage.getItem(MON_FOLD_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set(["Saved", "Closed"]);
})();
const mon = { got: new Map(), cards: new Map(), secs: new Map(), box: null, visible: new Set(), timer: null, busy: false, last: -Infinity, seen: null,
  old: false };                                    // old: the server started before the monitor was, and has no /api/monitor
// "N listed here (closed), of M saved in all: K still open, listed by their status"
const savedCount = (n, m) => !m ? "none" : `${n} listed here (closed), of ${m} in all`
  + (m > n ? `: ${m - n} still open, listed by ${m - n === 1 ? "its" : "their"} status` : "");
const monSig = (a) => `${a.last}|${a.events}|${statusOf(a)[0]}`;
function monForget() {                                 // left: nothing in view; what was read stays, for coming back
  if (mon.seen) mon.seen.disconnect();
  mon.seen = null; mon.box = null; mon.visible.clear(); mon.cards.clear(); mon.secs.clear();
  document.getElementById("monitor").replaceChildren();
}
function foldSection(name) {
  if (monFolded.has(name)) monFolded.delete(name); else monFolded.add(name);
  try { localStorage.setItem(MON_FOLD_KEY, JSON.stringify([...monFolded])); } catch (e) { /* this page only */ }
  renderMonitor();
}
// `nodes` in `box`, in order: those gone taken out first, then only those not in their place moved (a node moved starts
// its animations over)
function placeAll(box, nodes) {
  const keep = new Set(nodes);
  for (const n of [...box.children]) if (!keep.has(n)) n.remove();
  nodes.forEach((n, i) => { if (box.children[i] !== n) box.insertBefore(n, box.children[i] || null); });
}
function renderMonitor() {
  if (listMode !== "full" || !state.home) return;
  const box = document.getElementById("monitor");
  if (!SNAPSHOT && !mon.seen && "IntersectionObserver" in window)
    mon.seen = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) mon.visible.add(e.target.dataset.key); else mon.visible.delete(e.target.dataset.key);
      monFetch();
    }, { rootMargin: "200px 0px" });               // the page's: each column scrolls on its own
  const shown = state.home.gatherers.filter((g) => !isHidden(g)), many = shown.length > 1;
  const by = new Map(GROUPS.map((n) => [n, []]));
  for (const g of shown) for (const a of g.agents) by.get(groupOf(g, a)).push([g, a]);
  by.get("Closed").sort(([, x], [, y]) => (y.last || 0) - (x.last || 0));
  const total = shown.reduce((n, g) => n + g.agents.length, 0);
  const top = el("div", { class: "m-top" },
    el("h2", { text: `${plural(total, "actor")}${many ? ` in ${plural(shown.length, "gatherer")}` : ""}` }),
    mon.old ? el("span", { class: "m-old", role: "status",
      text: "This dashboard's server is older than its page: restart the dashboard to see each actor's calls and what it said." }) : null);
  const want = new Set(), columns = [];
  for (const n of MON_ORDER) {
    const list = by.get(n);
    if (!list.length) continue;
    const open = !monFolded.has(n);
    let s = mon.secs.get(n);
    if (!s) {
      s = { head: el("button", { class: "m-head", type: "button", onclick: () => foldSection(n) }), body: el("div", { class: "m-body" }) };
      s.node = el("section", { class: "m-col", "aria-label": n }, s.head);
      mon.secs.set(n, s);
    }
    s.node.classList.toggle("folded", !open);
    s.head.setAttribute("aria-expanded", open ? "true" : "false");
    s.head.title = open ? `Fold ${n.toLowerCase()}` : `Show ${n.toLowerCase()}`;
    const savedAll = n === "Saved" ? shown.reduce((k, g) => k + g.agents.filter((a) => !isCoordinator(a) && savedAs(g.name, a)).length, 0) : 0;
    s.head.replaceChildren(el("span", { class: "caret", text: "▶" }), groupMark(n), n,
      el("span", { class: "n", text: n === "Saved" ? `${list.length} of ${savedAll}` : String(list.length) }));
    if (n === "Saved") s.head.title += `: ${savedCount(list.length, savedAll)}`;
    if (open !== (s.body.parentNode === s.node)) { if (open) s.node.append(s.body); else s.body.remove(); }
    if (open) placeAll(s.body, monRows(n, list, many).map(([g, a, head]) => {
      if (head) return head;
      want.add(key(g.name, a.channel));
      return monCard(g, a, many);
    }));
    columns.push(s.node);
  }
  for (const [k, c] of mon.cards) if (!want.has(k)) { if (mon.seen) mon.seen.unobserve(c.node); mon.visible.delete(k); mon.cards.delete(k); }
  for (const [n, s] of mon.secs) if (!by.get(n).length) mon.secs.delete(n);
  if (!mon.box) mon.box = el("div", { class: "m-board" });
  placeAll(mon.box, columns);
  placeAll(box, [top, mon.box]);
  monFetch();
}
// A column's cards in order, Saved's under a heading for each folder (its gatherer's, by path), those in none last:
// [g, a] for a card, [g, null, heading] for a heading -- each kept, so it is not drawn again.
const monHeads = new Map();
function monRows(n, list, many) {
  if (n !== "Saved") return list;
  const at = new Map(state.home.gatherers.map((g, i) => [g.name, i]));
  const of = list.map(([g, a]) => { const fid = folderOf(g.name, a); return [g, a, fid === null ? null : folderPath(g.name, fid)]; });
  of.sort(([g, , f], [h, , e]) => (at.get(g.name) - at.get(h.name)) || (!f - !e) || byName(String(f || ""), String(e || "")));
  const out = [];
  let last = null;
  for (const [g, a, f] of of) {
    const k = f ? `${g.name}\u0000${f}` : `${g.name}\u0000`;
    if (k !== last && (f || of.some(([h, , e]) => h === g && e))) {   // "In no folder" only after some folder
      const text = `${f || "In no folder"}${many ? ` · ${titleOf(g)}` : ""}`;
      let head = monHeads.get(k);
      if (!head) monHeads.set(k, head = el("div", { class: "m-folder" }, folderMark(false), el("span")));
      head.lastChild.textContent = text;
      head.firstChild.style.visibility = f ? "" : "hidden";
      out.push([g, null, head]);
    }
    last = k;
    out.push([g, a]);
  }
  return out;
}
// A card, drawn again only when what it shows changed.
function monCard(g, a, many) {
  const k = key(g.name, a.channel), got = mon.got.get(k), d = got ? got.data : null;
  const current = isAt(focusedActor(), g.name, a.channel), open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const sig = signature([a, d, got !== undefined, many, current, open, avatarMode, savedAs(g.name, a)]);   // read, even if to no avail: no "…"
  const had = mon.cards.get(k);
  if (had && had.sig === sig) return had.node;
  const node = drawCard(g, a, d, many, current, open, got !== undefined);
  node.dataset.key = k;
  if (had && mon.seen) mon.seen.unobserve(had.node);
  if (mon.seen) mon.seen.observe(node);
  mon.cards.set(k, { sig, node });
  return node;
}
const plainWords = (t) => String(t || "").replace(/```[\s\S]*?```/g, " … ").replace(/`|\*\*|^#{1,6}\s+|^\s*[-*]\s+/gm, "").replace(/\s+/g, " ").trim();
function drawCard(g, a, d, many, current, open, read) {
  const [cls, label] = statusOf(a), live = cls === "running";
  const named = a.name && a.name.text, words = a.last_user_message;
  const pic = live ? el("div", { class: "c-pic acting", "aria-hidden": "true" }, atWork({ ...a, channel: `monitor ${a.channel}` }, { work: (d && d.work) || {} }))
    : el("div", { class: "c-pic" }, actorLogo(a));
  const size = a.real_tokens ?? a.sent_tokens;
  const meta = el("div", { class: "c-meta" },
    el("span", { class: `status ${cls}` }, el("i", { "aria-hidden": "true", style: `--spin-at: -${Date.now() % 1200}ms` }), label),
    live && d && d.at ? el("span", { title: "This turn so far" }, "for ", el("span", { "data-lasting": d.at, text: lasting(d.at) }))
      : el("span", { "data-ago": a.last || "", text: ago(a.last) }),
    size !== null && size !== undefined ? el("span", { text: `${compact(size)} tokens` }) : null,
    many ? el("span", { class: "gname", text: titleOf(g) }) : null);
  const now = nowLine(a, cls, d);
  const steps = d && d.steps && ["running", "asking", "error", "background", "building"].includes(cls) ? d.steps.filter((s) =>
    !(s.running && (cls === "asking" || (now && now.dataset.call && s.text === now.dataset.call)))) : [];   // not what the line above says
  const earlier = d && steps.length ? d.calls - d.steps.length : 0;
  const said = d && d.said && !(now && now.classList.contains("said"))
    ? el("div", { class: "c-now said" }, el("span", { class: "lbl", text: "Said:" }), el("span", { class: "tx", text: plainWords(d.said) })) : null;
  const kinds = d && d.files ? Object.entries(d.files) : [];
  return el("button", { class: `m-card ${cls}`, type: "button", "aria-current": current ? "true" : "false", ...(open ? { "data-open": "true" } : {}),
    title: `${harnessName(a.harness)} · ${g.name} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}\nClick: show it${SNAPSHOT ? "" : ` · ${BESIDE_KEY}+click: beside the one shown`}`,
    onclick: (ev) => { leaveFull(); pick(g.name, a.channel, ev); },
    oncontextmenu: (ev) => { if (MAC && ev.ctrlKey && !SNAPSHOT) leaveFull(); pickBeside(g.name, a.channel, ev); } },
    el("div", { class: "c-head" }, pic, el("div", { class: "c-who" },
      named ? el("div", { class: "c-name", text: named }) : null,
      el("div", { class: "c-asked" + (words ? "" : " none"), text: words || "No message yet" }),
      meta)),
    now,
    steps.length ? el("div", { class: "c-steps" },
      earlier > 0 ? el("div", { class: "c-step more", text: `${plural(earlier, "earlier call")}` }) : null,
      ...steps.map((s) => {
        const [gc, word] = s.error ? ["err", "failed"] : !s.running ? ["ok", "ran"] : live ? ["run", "running"] : cls === "asking" ? ["run", "waiting"] : ["stop", "stopped"];
        return el("div", { class: "c-step", title: `${word}: ${s.text}` }, el("span", { class: `g ${gc}`, "aria-label": word, text: "●" }),
          el("span", { class: "t", text: s.text }));
      })) : null,
    said,
    a.recap && a.recap.text && !live ? el("div", { class: "c-recap", title: `Recap, ${ago(a.recap.at)}:\n${a.recap.text}` },
      el("span", { class: "lbl", text: "Recap" }), a.recap.text) : null,
    d && (kinds.length || d.calls) ? el("div", { class: "c-foot" },
      ...kinds.map(([k, n]) => el("span", { class: "fk" }, el("i", { style: `background: ${(FILE_KINDS[k] || [k, "var(--muted)"])[1]}` }),
        `${n} ${(FILE_KINDS[k] || [k])[0]}`)),
      d.calls ? el("span", { text: plural(d.calls, "call") }) : null,
      d.turns > 1 ? el("span", { text: `turn ${d.turns}` }) : null) : null,
    !d && !SNAPSHOT && !read ? el("div", { class: "c-wait", "aria-hidden": "true", text: "…" }) : null);
}
// What the actor is doing, or waits on, in a line: its question, its error, its call under way or its thinking, what runs
// in the background -- or, done, what it said last. None to say: null.
function nowLine(a, cls, d) {
  const line = (kind, lbl, text, extra) => el("div", { class: `c-now ${kind}` }, el("span", { class: "lbl", text: lbl }),
    text ? el("span", { class: "tx", text }) : null, extra || null);
  const since = (t) => t ? el("span", { class: "tm", "aria-hidden": "true", "data-ago": t, text: ago(t) }) : null;
  if (cls === "asking" && a.asking) return line("ask", "Waiting for you:", a.asking.kind === "plan" ? "A plan to approve"
    : (a.asking.questions || []).map((q) => q.question).filter(Boolean).join(" · ") || "A question", since(a.asking.at));
  if (cls === "error" || cls === "failed") return line("err", "Error:", (a.failing && a.failing.error) || (a.stopped && a.stopped.text)
    || (cls === "failed" ? "Its agent failed to start" : "Its turn stopped on an error"), since((a.failing || a.stopped || {}).at));
  if (cls === "running") {
    if (a.failing) return line("err", "Retrying:", `${a.failing.error || "its call to the model failed"} (${plural(a.failing.attempts, "try")})`, since(a.failing.at));
    const n = d && d.now;
    if (n && n.kind === "call") { const l = line("run", "Running:", n.text, since(a.last)); l.dataset.call = n.text; return l; }
    return line("run", n && n.kind === "thinking" ? "Thinking…" : "Working…", null, since(a.last));
  }
  if (cls === "background" && (a.background || []).length)
    return line("bg", "In the background:", a.background.map((t) => `${TASK_KINDS[t.kind] || t.kind}: ${t.label || t.id}`).join(" · "));
  if (d && d.said) return line("said", "Said:", plainWords(d.said));
  return null;
}
// What each card in view shows of its actor's turn, read for those changed since (MON_BATCH at a time).
function monFetch(soon = 150) {
  if (SNAPSHOT || listMode !== "full" || mon.timer || mon.busy) return;
  mon.timer = setTimeout(monLoad, Math.max(soon, MON_GAP - (performance.now() - mon.last)));
}
async function monLoad() {
  mon.timer = null;
  if (listMode !== "full" || !state.home) return;
  const stale = [];
  for (const g of state.home.gatherers) for (const a of g.agents) {
    const k = key(g.name, a.channel), had = mon.got.get(k);
    if (mon.visible.has(k) && (!had || had.sig !== monSig(a))) stale.push({ k, sig: monSig(a), ask: [g.name, a.channel, a.cwd || null] });
  }
  if (!stale.length) return;
  const batch = stale.slice(0, MON_BATCH);
  mon.busy = true; mon.last = performance.now();
  try {
    const got = await get(`/api/monitor?actors=${enc(JSON.stringify(batch.map((b) => b.ask)))}`);
    batch.forEach((b, i) => { const d = (got.actors || [])[i]; mon.got.set(b.k, { sig: b.sig, data: d && !d.error ? d : null }); });
    mon.old = false;
  } catch (e) {
    if (/: 404$/.test(e.message)) mon.old = true;
    for (const b of batch) mon.got.set(b.k, { sig: b.sig, data: (mon.got.get(b.k) || {}).data || null });   // tried again once it changes
  } finally { mon.busy = false; }
  renderMonitor();
  if (stale.length > batch.length) monFetch(0);
}
(() => {                                           // as the reader left it: over the whole page, from where it came
  let v = null;
  try { v = JSON.parse(localStorage.getItem(LIST_KEY)); } catch (e) { /* none kept */ }
  if (v && (v.from === "list" || v.from === "folded")) listMode = v.from;
  setListMode(v && v.mode, false);
})();
// Where each gatherer's actors were put when the list was last drawn: channel -> place, top first.
// The list is drawn whole each time; so that an actor changing status does not jump to its new place, each
// row, group heading and gatherer is keyed (data-key), its place and status taken before the list is drawn
// again (listPlaces), and after it (slideList) set back where it was and moved to where it is now. An actor
// whose status changed, and so its group, slides over the others; one new to the list fades in; its status dot
// grows into its new state. None of it for a reader who asks for less motion.
function listPlaces(root) {
  const places = new Map();
  for (const n of root.querySelectorAll("[data-key]")) {
    const dot = n.querySelector(".meta .dot");
    places.set(n.dataset.key, { top: n.getBoundingClientRect().top, status: dot && dot.getAttribute("aria-label"), group: n.dataset.group });
  }
  return places;
}
function slideList(root, was) {
  if (!was.size || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const side = getComputedStyle(root).backgroundColor;
  for (const n of root.querySelectorAll("[data-key]")) {
    const before = was.get(n.dataset.key);
    if (!before) { n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" }); continue; }
    const dot = n.querySelector(".meta .dot"), changed = dot && before.status && dot.getAttribute("aria-label") !== before.status;
    const regrouped = changed || (before.group && n.dataset.group !== before.group);
    const dy = before.top - n.getBoundingClientRect().top;
    if (Math.abs(dy) >= 1) {
      const frames = [{ transform: `translateY(${dy}px)` }, { transform: "none" }];
      if (regrouped) {     // past the rows between: over them, on the list's own background if it has none
        n.style.position = "relative"; n.style.zIndex = "1";
        const bg = getComputedStyle(n).backgroundColor;
        if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") { frames[0].backgroundColor = side; frames[1].backgroundColor = side; }
      }
      n.animate(frames, { duration: 380, easing: "cubic-bezier(.2, .8, .2, 1)" }).onfinish = () => { n.style.position = n.style.zIndex = ""; };
    }
    if (changed)
      dot.animate([{ transform: "scale(.2)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 320, delay: 120, easing: "ease-out", fill: "backwards" });
  }
}
// Selecting an actor draws its chat as soon as it is loaded; its calls and context (the details) follow
// on the stream, which starts with them. The actor list is the stream's already.
async function select(g, c) {
  if (!isAt(state.selected, g, c)) Object.assign(kindViewId, KIND_VIEWS);   // a DocWriter's, a Browser's actor: in its own
  state.selected = [g, c]; state.readId = null; state.followLatest = true; state.context = null; state.agent = null;
  state.agentVersion = (state.agentVersion || 0) + 1;
  markSeen();
  savePanes();
  if (SNAPSHOT || state.paused) { await refresh(true); chatToEnd(); return; }
  connect();
  const main = document.getElementById("main");
  main.classList.add("stale");
  try { await loadChat(); } finally { main.classList.remove("stale"); }
  if (state.selected[0] === g && state.selected[1] === c) { render(true); chatToEnd(); }
}
