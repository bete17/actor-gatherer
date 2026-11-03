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
  if (ev.key !== "Escape" || listMode !== "full" || !document.getElementById("about").hidden || !document.getElementById("cfg-file").hidden) return;
  ev.preventDefault();
  leaveFull();
}, true);
// The list in the shape it is in: the rail, or the monitor, drawn from the home (the list itself is drawn all the same).
function renderFolded() {
  if (listMode === "folded") renderRail();
  else if (listMode === "full") renderMonitor();
}
// The rail: those waiting on the reader, stopped on an error, running, with work in the background, or finished, in that
// order, a rule between each kind; then those open in the panes, if not among them. Each its avatar, its status's dot at
// its corner; a click shows it, as in the list.
const RAIL = ["Waiting for you", "Error", "Running", "Background", "Finished"];
function renderRail() {
  const shown = state.home.gatherers.filter((g) => !isHidden(g)), rows = [];
  for (const name of RAIL) for (const g of shown) for (const a of g.agents) if (groupOf(g, a) === name) rows.push([name, g, a]);
  for (const [gname, c] of openActors()) {
    const g = state.home.gatherers.find((x) => x.name === gname), a = g && g.agents.find((x) => x.channel === c);
    if (a && !rows.some(([, h, b]) => h === g && b === a)) rows.push(["Open", g, a]);
  }
  const list = el("div", { class: "r-actors" });
  rows.forEach(([name, g, a], i) => {
    if (i && rows[i - 1][0] !== name) list.append(el("hr"));
    list.append(railActor(g, a));
  });
  if (!rows.length) list.append(el("div", { class: "r-none", text: "None at work" }));
  const gear = document.querySelector("#about-btn .gear svg").cloneNode(true);
  const live = document.getElementById("state-dot").dataset.state || "";
  document.getElementById("rail").replaceChildren(
    el("button", { class: "list-btn", type: "button", title: "Every actor over the whole page: what each is doing", "aria-label": "Full screen",
      onclick: () => setListMode("full") }, strokeIcon(LIST_ICONS.full)),
    list,
    el("button", { class: "list-btn r-about", type: "button", title: document.getElementById("about-btn").title, "aria-label": "Settings",
      onclick: () => document.getElementById("about-btn").click() }, gear, el("span", { class: "state-dot", "data-state": live })));
}
function railActor(g, a) {
  const [cls, label] = statusOf(a);
  const current = isAt(focusedActor(), g.name, a.channel);
  const open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const words = (a.name && a.name.text) || a.last_user_message || "No message yet";
  return el("button", { class: "r-actor", type: "button", "aria-current": current ? "true" : "false", ...(open ? { "data-open": "true" } : {}),
    "aria-label": `${firstLine(words, 120)}: ${label}`,
    title: `${firstLine(words, 120)}\n${label} · ${ago(a.last)} · ${g.name}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown`}`,
    onclick: (ev) => pick(g.name, a.channel, ev), oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev) },
    actorLogo(a), el("i", { class: `rd ${cls}`, "aria-hidden": "true", style: `--spin-at: -${Date.now() % 1200}ms` }));
}
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
    s.head.replaceChildren(el("span", { class: "caret", text: "▶" }), groupMark(n), n, el("span", { class: "n", text: String(list.length) }));
    if (open !== (s.body.parentNode === s.node)) { if (open) s.node.append(s.body); else s.body.remove(); }
    if (open) placeAll(s.body, list.map(([g, a]) => { want.add(key(g.name, a.channel)); return monCard(g, a, many); }));
    columns.push(s.node);
  }
  for (const [k, c] of mon.cards) if (!want.has(k)) { if (mon.seen) mon.seen.unobserve(c.node); mon.visible.delete(k); mon.cards.delete(k); }
  for (const [n, s] of mon.secs) if (!by.get(n).length) mon.secs.delete(n);
  if (!mon.box) mon.box = el("div", { class: "m-board" });
  placeAll(mon.box, columns);
  placeAll(box, [top, mon.box]);
  monFetch();
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
const listOrder = new Map();
// Each group's actors in the order they were last in, so an actor moves no further than it must: one that
// stays in its group keeps its place, and one that comes to it from another lands at the end nearest where it
// was -- the bottom of a group above it, the top of one below. One not seen before goes first, as the data has it.
function keepOrder(gatherer, groups) {
  const before = listOrder.get(gatherer) || new Map(), now = new Map();
  for (const [, list] of groups) {
    list.sort((x, y) => (before.get(x.channel) ?? -1) - (before.get(y.channel) ?? -1));
    for (const a of list) now.set(a.channel, now.size);
  }
  listOrder.set(gatherer, now);
}
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
