// ------------------------------------------------------------------ the agent list
const COLLAPSED_KEY = "ag-dashboard-collapsed-gatherers";
const collapsed = (() => {                        // gatherers the reader folded, kept in this browser
  try { const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
// Closed actors (their process gone), and those saved for later, are each folded away under a line ("N closed",
// "N saved"), unless the reader opened that gatherer's, kept in this browser. A selected one stays in view. So are the
// gatherer's shells ("N terminals", SHELLS) -- but none in view while folded, even one open in a pane.
const FOLD_KEYS = { Closed: "ag-dashboard-closed-shown", Saved: "ag-dashboard-saved-shown", Terminals: "ag-dashboard-terminals-shown" };
const foldOpen = Object.fromEntries(Object.entries(FOLD_KEYS).map(([group, key]) => {
  try { const v = JSON.parse(localStorage.getItem(key)); if (Array.isArray(v)) return [group, new Set(v)]; } catch (e) { /* none kept */ }
  return [group, new Set()];
}));
function toggleFold(group, name) {
  const open = foldOpen[group];
  if (open.has(name)) open.delete(name); else open.add(name);
  try { localStorage.setItem(FOLD_KEYS[group], JSON.stringify([...open])); } catch (e) { /* kept for this page only */ }
  renderAgents();
}
// The gatherer agents the reader hid from the list, by their gatherer, kept in this browser: its face on the gatherer's row
// (startButtons) shows it again, and opens it.
const CREW_HIDDEN_KEY = "ag-dashboard-crew-hidden";
const crewHidden = (() => {
  try { const v = JSON.parse(localStorage.getItem(CREW_HIDDEN_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
function setCrewHidden(name, hide) {
  if (hide) crewHidden.add(name); else crewHidden.delete(name);
  try { localStorage.setItem(CREW_HIDDEN_KEY, JSON.stringify([...crewHidden])); } catch (e) { /* kept for this page only */ }
  renderAgents();
}
// The actor shown when none is chosen: the newest not closed, else the newest.
const firstAgent = (g) => g.agents.find((a) => a.status !== "closed") || g.agents[0];
function toggleGatherer(name) {
  if (collapsed.has(name)) collapsed.delete(name); else collapsed.add(name);
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch (e) { /* kept for this page only */ }
  renderAgents();
}
// Hidden gatherers, kept by the server (hiding.py, `home.hiding`) so every dashboard on this home
// hides the same ones: those the reader hid ("hidden"), and those with nothing for a week
// (STALE_SECONDS) unless the reader kept them in view ("shown").
const HIDDEN_KEY = "ag-dashboard-hidden-gatherers";   // where this browser kept them before
const STALE_SECONDS = 7 * 86400;
const choiceOf = (g) => (state.home.hiding || {})[g.name] || "";
const stale = (g) => !!g.last && (state.home.now || Date.now() / 1000) - g.last > STALE_SECONDS;
const isHidden = (g) => choiceOf(g) === "hidden" || (stale(g) && choiceOf(g) !== "shown" && !g.agents.some((a) => savedAs(g.name, a)));
async function keepChoice(name, choice) {
  state.home.hiding = { ...(state.home.hiding || {}) };
  if (choice) state.home.hiding[name] = choice; else delete state.home.hiding[name];
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  try { state.home.hiding = await post("/api/hiding", { gatherer: name, choice }); }
  catch (err) { setLive(`Not saved: ${err.message}`); }
}
// The reader's name for a gatherer, kept by the server (titles.py, `home.titles`) and shown in place of its own, which
// everything else -- its directory, its actors, `ag` -- still goes by.
const titleOf = (g) => (state.home.titles || {})[g.name] || g.name;
// Named in the actor's name box (nameBox), its channel null: Enter keeps it, Esc leaves it, empty gives its own back.
function retitle(g) {
  state.renaming = { g: g.name, c: null, value: titleOf(g), was: "" };
  nameInput = null;
  renderAgents();
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}
async function keepTitle(gname, text) {
  try { state.home.titles = await post("/api/title", { gatherer: gname, title: text }); }
  catch (err) { setLive(`Not named: ${err.message}`); }
  renderAgents();
}
async function setHidden(g, hide) {
  const kept = keepChoice(g.name, hide ? "hidden" : stale(g) ? "shown" : "");
  renderAgents();
  await kept;
  renderAgents();
}
// Actors saved for later, kept by the server (saved.py, `home.saved`: {gatherer: {channel: when}}) so every
// dashboard on this home shows the same. One saved is listed under Saved in its gatherer while it has nothing
// for the reader (so not running, waiting or finished), not with the idle or closed ones, and keeps its
// gatherer from being hidden for having had nothing for a week. The channel it was saved as: a codex
// session's, renamed to its thread since, its first.
const savedAs = (gname, a) => {
  const kept = (state.home.saved || {})[gname] || {};
  return a.channel in kept ? a.channel : a.session && a.session.started_as in kept ? a.session.started_as : null;
};
async function setSaved(gname, a, save) {
  const channel = savedAs(gname, a) || a.channel;
  const kept = { ...((state.home.saved || {})[gname] || {}) };
  if (save) kept[channel] = new Date().toISOString(); else delete kept[channel];
  state.home.saved = { ...(state.home.saved || {}), [gname]: kept };
  renderAgents();
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  try { state.home.saved = await post("/api/saved", { gatherer: gname, channel, saved: save }); }
  catch (err) { setLive(`Not saved: ${err.message}`); }
  renderAgents();
}
// Choices this browser kept before the server did: handed to the server once, then dropped here.
async function moveHidingToServer() {
  let v = null;
  try { v = JSON.parse(localStorage.getItem(HIDDEN_KEY)); } catch (e) { /* none kept */ }
  if (SNAPSHOT || !v) return;
  const had = state.home.hiding || {};
  for (const name of v.hidden || []) if (!had[name]) await keepChoice(name, "hidden");
  for (const name of v.shown || []) if (!had[name]) await keepChoice(name, "shown");
  try { localStorage.removeItem(HIDDEN_KEY); } catch (e) { /* stays; the server's choices win */ }
  renderAgents();
}
function renderAgents() {
  if (PANE) return;                                  // a frame has no list: the page around it has
  renderFolded();
  const aside = document.getElementById("agents");
  const was = listPlaces(aside);
  const typing = nameInput && document.activeElement === nameInput && [nameInput.selectionStart, nameInput.selectionEnd];
  nameMoving = true;                                 // taken out and put back: not a blur that names it
  document.getElementById("home").textContent = document.getElementById("home").title = state.home.home;
  const shown = state.home.gatherers.filter((g) => !isHidden(g)), hidden = state.home.gatherers.filter(isHidden);
  aside.replaceChildren(el("div", { class: "aside-head" }, el("h2", { text: "Agents" }),
    SNAPSHOT ? null : el("button", { type: "button", onclick: () => openForm(""), title: "Make a new gatherer" }, "+ New gatherer"),
    el("span", { class: "list-btns" }, ...listButtons())));
  if (state.adding && state.adding.gatherer === "") aside.append(gathererForm());
  if (!state.home.gatherers.length) aside.append(el("div", { class: "servers", text: "No gatherers in this home yet." }));
  else if (!shown.length) aside.append(el("div", { class: "servers", text: "Every gatherer is hidden." }));
  for (const g of shown) {
    const open = !collapsed.has(g.name);
    // its gatherer agent (isCoordinator) first, apart from the groups: the actor the reader arranges the others through
    const crew = g.agents.find(isCoordinator);
    const groups = GROUPS.map((name) => [name, g.agents.filter((a) => a !== crew && groupOf(g, a) === name)]).filter(([, list]) => list.length);
    const live = g.agents.filter((a) => groupOf(g, a) === "Running").length;
    const waiting = g.agents.filter((a) => groupOf(g, a) === "Waiting for you").length;
    const failed = g.agents.filter((a) => groupOf(g, a) === "Error").length;
    const box = el("div", { class: "gatherer" },
      el("div", { class: "gatherer-row", "data-key": g.name },
        el("button", { class: "name", type: "button", "aria-expanded": open ? "true" : "false", onclick: () => toggleGatherer(g.name),
          title: g.policy ? `${g.name} · policy ${g.policy}` : g.name },
          el("span", { class: "caret", text: "▶" }), state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null) ? null
            : el("span", { class: "gname", text: titleOf(g) })),
        state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null) ? nameBox() : null,
        SNAPSHOT ? null : el("button", { class: "act rename", type: "button", title: `Rename ${titleOf(g)}`, "aria-label": `Rename ${titleOf(g)}`,
          onclick: () => retitle(g) }, strokeIcon("M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8", 14)),
        el("button", { class: "act hide", type: "button", title: `Hide ${g.name}`, "aria-label": `Hide ${g.name}`, onclick: () => setHidden(g, true) },
          hideIcon()),
        // how many of its actors wait on the user, how many stopped on an error, and how many run now; nothing while none does
        el("span", { class: "fill", onclick: () => toggleGatherer(g.name) },
          waiting ? el("span", { class: "count asking", title: `${waiting} of ${plural(g.agents.length, "actor")} waiting for you` },
            el("i", { "aria-hidden": "true" }), String(waiting)) : null,
          failed ? el("span", { class: "count error", title: `${failed} of ${plural(g.agents.length, "actor")} stopped on an error` },
            el("i", { "aria-hidden": "true" }), String(failed)) : null,
          live ? el("span", { class: "count", title: `${live} of ${plural(g.agents.length, "actor")} running` },
            el("i", { "aria-hidden": "true" }), String(live)) : null),
        ...(SNAPSHOT ? [] : startButtons(g))));
    if (state.adding && state.adding.gatherer === g.name) box.append(newForm());
    if (g.error) box.append(el("div", { class: "servers", text: `Database unreadable: ${g.error}` }));
    for (const [name, list] of groups) if (name === "Closed") list.sort((x, y) => (y.last || 0) - (x.last || 0));
    keepOrder(g.name, groups);   // so drawn first; from then on, each group in the order its actors were last in
    const shells = (state.home.shells || []).filter((s) => s.gatherer === g.name);
    if (shells.length) {         // its shells, oldest first, just above the closed actors
      const at = groups.findIndex(([name]) => name === "Closed");
      groups.splice(at < 0 ? groups.length : at, 0, [SHELLS, shells]);
    }
    if (open && crew && !crewHidden.has(g.name)) box.append(agentRow(g, crew, CREW_GROUP));
    for (const [name, list] of open ? groups : []) {
      if (name === SHELLS) {
        const shown = foldOpen[name].has(g.name);
        box.append(el("button", { class: "agent-group", type: "button", "aria-expanded": shown ? "true" : "false", "data-key": `${g.name}/${name}`,
          title: shown ? "Hide the terminals" : "Show the terminals", onclick: () => toggleFold(name, g.name) },
          `${shown ? "▾" : "▸"} ${plural(list.length, "terminal")}`));
        for (const s of shown ? list : []) box.append(shellRow(g, s));
        continue;
      }
      if (name in FOLD_KEYS) {
        const shown = foldOpen[name].has(g.name), what = name.toLowerCase();
        const selected = list.filter((a) => openActors().some((sel) => isAt(sel, g.name, a.channel)));
        box.append(el("button", { class: "agent-group", type: "button", "aria-expanded": shown ? "true" : "false", "data-key": `${g.name}/${name}`,
          title: shown ? `Hide ${what} actors` : `Show ${what} actors`, onclick: () => toggleFold(name, g.name) },
          `${shown ? "▾" : "▸"} ${list.length} ${what}`));
        for (const a of shown ? list : selected) box.append(agentRow(g, a, name));
        continue;
      }
      if (groups.length > 1) box.append(el("div", { class: "agent-group", "data-key": `${g.name}/${name}`, text: name }));
      for (const a of list) box.append(agentRow(g, a, name));
    }
    aside.append(box);
  }
  if (hidden.length) {
    const list = el("details", { class: "hidden-list", id: "hidden-gatherers" },
      el("summary", { text: `${hidden.length} hidden gatherer${hidden.length === 1 ? "" : "s"}` }));
    for (const g of hidden) list.append(el("div", { class: "hidden-row" }, el("span", { class: "gname", text: titleOf(g) }),
      el("span", { class: "why", text: choiceOf(g) === "hidden" ? "hidden" : `nothing for ${ago(g.last).replace(" ago", "")}` }),
      el("button", { type: "button", onclick: () => setHidden(g, false) }, "Show")));
    const wasOpen = document.getElementById("hidden-gatherers");
    if (wasOpen && wasOpen.open) list.open = true;
    aside.append(list);
  }
  slideList(aside, was);
  nameMoving = false;
  if (state.renaming && !(nameInput && nameInput.isConnected)) { state.renaming = null; nameInput = null; }   // its row folded away
  else if (typing) { nameInput.focus({ preventScroll: true }); nameInput.setSelectionRange(...typing); }
  const servers = state.home.hook_servers || [];     // in the dashboard's panel (the header's button)
  document.getElementById("servers").textContent = servers.length
    ? servers.map((s) => `:${s.port} → ${s.upstream}`).join("\n") : "None running.";
}
// A user's message in a chat bubble: as the server gives it -- the user's words as their harness's rules read them
// (harness_kit: a command run with `!` as "! ls", a /name as "/greet Bob", a message sent mid-turn unwrapped) -- a
// command (its `kind` "user_command") in the terminal's type, as is one typed in this page's box ("!ls"), which Claude
// Code runs as one. A `!` command's bubble is a bash bubble (bubbleClass): its `!` in bash mode's colour, as Claude Code
// marks it, and under it, once run, what it printed.
const isBash = (text) => !!text && /^\s*!/.test(text);
const bubbleClass = (text) => isBash(text) ? " bash" : !envelope(text) ? "" : envelope(text).from === "update" ? " crew update" : " crew";
const userWords = (text, kind) => isBash(text)
  ? el("span", { class: "tx bang" }, el("span", { class: "bash-mark", "aria-hidden": "true", text: "!" }),
    " ", shellSpan(String(text).trim().replace(/^!\s*/, "")))
  : envelope(text) ? crewWords(envelope(text))
  : BW_BLOCK.test(text) ? bwWords(text)
  : el("span", { class: "tx" + (kind === "user_command" ? " bang" : ""), text: text });
// A message between the actors of a gatherer (coordination.py's `envelope`), typed into the receiver's terminal: its first
// line who it is from -- the gatherer agent, or another actor (its id, its name as JSON) -- and how to answer, then a
// blank line, then the message (or, as the list has it, its lines made one). Or the news of a watch the actor asked for
// (coordination.py's `update`, UPDATE): which actor is done, and how, then what it was asked and said. null: neither.
// A message is drawn with its sender's avatar and name -- the gatherer agent's, the manager -- folded to its first lines
// (crewFold); news, as a quiet line with the avatar of the actor it is about.
const ENVELOPE = /^Message from (the gatherer agent|actor ([\w-]+)(?:, ("(?:[^"\\]|\\.)*"))?)(?: \(answer it with: [^\n]*?\))?:\s+([\s\S]*)$/;
const UPDATE = /^Update \(you asked with `ag actors when`, watch (\d+)\): actor ([\w-]+)(?: \(("(?:[^"\\]|\\.)*")\))? is done: ([^\n]*?)\.(?:\s+([\s\S]*))?$/;
function envelope(text) {
  const s = String(text ?? "");
  const named = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } };
  let m = UPDATE.exec(s);
  if (m) return { from: "update", id: m[2], name: named(m[3]), how: m[4], watch: +m[1], text: m[5] || "" };
  m = ENVELOPE.exec(s);
  return m && { from: m[1] === "the gatherer agent" ? "coordinator" : "actor", id: m[2] || null, name: named(m[3]), text: m[4] };
}
const COORDINATOR_NAME = "Gatherer agent";
const MANAGER = "roles/manager";             // the gatherer agent's picture (avatars.py's ROLES), before it has one
// The actor of the gatherer shown that an envelope names: the gatherer agent, or the one whose id starts with `id`.
function crewActor(coordinator, id) {
  const g = state.home && state.selected && state.home.gatherers.find((x) => x.name === state.selected[0]);
  return !g ? null : coordinator ? g.agents.find(isCoordinator) || null
    : g.agents.find((a) => id && (a.channel.startsWith(id) || (a.session && (a.session.started_as || "").startsWith(id)))) || null;
}
// An actor's avatar, small, as the list draws it (actorLogo) less its harness's mark: `fallback`, the picture with none.
function crewFace(a, fallback = null) {
  const name = (a && a.avatar) || fallback;
  const svg = SNAPSHOT && name && (SNAPSHOT.avatars || {})[name];
  const src = !name ? null : SNAPSHOT ? svg && "data:image/svg+xml," + encodeURIComponent(svg) : `/avatars/${name}.svg`;
  return src ? el("img", { class: "crew-face", src, alt: "", draggable: "false" })
    : el("span", { class: "crew-face none", "aria-hidden": "true" }, strokeIcon(ICONS.crew, 12));
}
// An actor's id as a label shows it: its first characters. Messages name ids whole (coordination.py's `_view`), for
// the actors to answer by; the page finds the actor by the whole id.
const crewId = (id) => String(id || "").slice(0, 8);
const crewName = (coordinator, a, env) => coordinator ? COORDINATOR_NAME : (a && a.name && a.name.text) || (env && env.name)
  || `Actor ${env ? crewId(env.id) : ""}`;
// in a line (the list's): who it is from, and its words
const crewLine = (env) => env.from === "update" ? `${env.name || `Actor ${crewId(env.id)}`} is done: ${env.how}`
  : `${env.from === "coordinator" ? "From the gatherer agent" : `From ${env.name || `actor ${crewId(env.id)}`}`}: ${env.text}`;
function crewWords(env) {
  const coordinator = env.from === "coordinator", a = crewActor(coordinator, env.id);
  if (env.from === "update")
    return el("span", { class: "tx crew" }, crewFace(a), el("span", { class: "crew-body" },
      el("span", { class: "crew-from" }, `${crewName(false, a, env)} is done`, el("span", { class: "crew-how", text: ` · ${env.how}` })),
      env.text ? crewText(env.text) : null));
  return el("span", { class: "tx crew" }, crewFace(a, coordinator ? MANAGER : null), el("span", { class: "crew-body" },
    el("span", { class: "crew-from", text: crewName(coordinator, a, env) }), crewText(env.text)));
}
// A message between actors, long as they mostly are, folded to its first three lines (.crew-fold; news, two) with a toggle under it to
// show the rest: opened, kept so (crewOpen) by the actor shown and the message's words -- across redraws, and once ag
// stores a message sent from its pending bubble. Whether its words run past those lines is measured where it is drawn,
// and again when its width changes (crewSizes): the toggle is there (.long) only then, and kept by the message
// (crewLong) so that a redraw builds the same node.
const crewOpen = new Set(), crewLong = new Map();
const crewKey = (text) => `${state.selected ? key(...state.selected) : ""}\u0000${String(text).length}\u0000${String(text).slice(0, 200)}`;
function crewText(text) {
  const n = el("span", { class: "crew-text", text });
  n.crewKey = crewKey(text);
  return n;
}
const crewFold = (k) => " crew-fold" + (crewLong.get(k) || crewOpen.has(k) ? " long" : "") + (crewOpen.has(k) ? " open" : "");
function crewMore(k) {
  const open = crewOpen.has(k);
  return el("button", { type: "button", class: "crew-more", "aria-expanded": open ? "true" : "false",
    title: open ? "Fold the message to its first lines" : "Show the whole message",
    onclick: (ev) => {
      if (crewOpen.has(k)) crewOpen.delete(k); else crewOpen.add(k);
      ev.currentTarget.closest(".crew-fold").classList.toggle("open", crewOpen.has(k));
      ev.currentTarget.replaceWith(crewMore(k));
    } }, open ? "Show less" : "Show all");
}
// A message between actors, or a watch's news, in a bubble (`bubble`, of a turn's message `text`): in a band, with its
// toggle under the bubble, which a button (a turn's, picking it) cannot hold. Any other message: the bubble as it is.
function crewBand(text, bubble) {
  const env = envelope(text);
  if (!env || !env.text) return bubble;
  const k = crewKey(env.text), joined = bubble.classList.contains("joined");
  bubble.classList.remove("joined");
  return el("div", { class: "fl-crew" + (env.from === "update" ? " update" : "") + (joined ? " joined" : "") + crewFold(k) },
    bubble, crewMore(k));
}
const crewSizes = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((seen) => {
  for (const { target: t } of seen) {
    const box = t.isConnected && t.closest(".crew-fold");
    if (!box) { crewSizes.unobserve(t); continue; }
    if (box.classList.contains("open")) continue;
    const long = t.scrollHeight > t.clientHeight + 1;
    if (crewLong.size > 500) crewLong.clear();
    crewLong.set(t.crewKey, long);
    box.classList.toggle("long", long);
  }
});
const crewWatched = new WeakSet();
function watchCrew() {   // the messages drawn since: measured from now on
  if (crewSizes) for (const t of document.querySelectorAll(".crew-fold .crew-text"))
    if (!crewWatched.has(t)) { crewWatched.add(t); crewSizes.observe(t); }
}
// A message the actor sent another (files.py's `sent`: `ag actors send`, or a new actor started with it), in its turn:
// with its receiver's avatar and name.
function sentBubble(m) {
  const coordinator = m.to_name === COORDINATOR_NAME, to = crewActor(coordinator, String(m.to || ""));
  const who = coordinator ? "the gatherer agent" : (to && to.name && to.name.text) || m.to_name || `actor ${crewId(m.to)}`;
  const k = crewKey(m.text);
  return el("div", { class: "fl-sent crew" + crewFold(k), title: m.kind === "new" ? "A new actor, started with this message" : "Sent with `ag actors send`" },
    crewFace(to, coordinator ? MANAGER : null), el("span", { class: "crew-body" },
      el("span", { class: "crew-from", text: m.kind === "new" ? `Started ${who}` : `To ${who}` }), crewText(m.text), crewMore(k)));
}
const isCoordinator = (a) => !!a && a.role === "coordinator";
function agentRow(g, a, group) {
  const [cls, label] = statusOf(a);
  const saved = !!savedAs(g.name, a);
  const current = isAt(focusedActor(), g.name, a.channel);
  const open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const size = a.real_tokens ?? a.sent_tokens;
  const naming = !!state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, a.channel);
  const named = a.name && a.name.text;
  // its top line -- its name, else what it was last asked -- clicked once it is the one shown: named there
  const nameIt = SNAPSHOT || !current ? {} : { title: `${nameNote(g, a)}Click to ${named ? "rename" : "name"} it`,
    onclick: (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.stopPropagation(); startRename(g, a); } };
  const env = envelope(a.last_user_message);         // a message from another actor: who from, and its words
  const asked = env ? crewLine(env) : a.last_user_message;
  return el(naming ? "div" : "button", { class: "agent" + (naming ? " renaming" : "") + (isCoordinator(a) ? " coordinator" : ""),
    ...(naming ? {} : { type: "button" }),
    "aria-current": current ? "true" : "false", "data-key": `${g.name}/${a.channel}`, "data-group": group,
    ...(open ? { "data-open": "true" } : {}),
    title: `${harnessName(a.harness)} · ${label} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown`}`,
    ...(naming ? {} : { onclick: (ev) => pick(g.name, a.channel, ev), oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev),
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startRename(g, a); } } }) },
    actorLogo(a),
    el("div", {},
      naming ? nameBox() : named ? el("div", { class: "name", ...nameIt },
        named) : null,
      el("div", { class: "asked" + (asked ? "" : " none"), ...(naming || named ? {} : nameIt),
        text: asked || (isCoordinator(a) ? "Coordinates this gatherer's actors: ask it to arrange their work" : "No message yet") }),
      a.recap && a.recap.text ? el("div", { class: "recap", title: `Recap, ${ago(a.recap.at)}:\n${a.recap.text}` },
        el("span", { class: "lbl", text: "Recap" }), a.recap.text) : null,
      // the list is drawn again on every change: the glyph's turn set by the clock, not restarted each time
      el("div", { class: "meta" }, el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
        el("span", { text: [size !== null && size !== undefined ? `${compact(size)} tokens` : null, ago(a.last)].filter(Boolean).join(" · ") }),
        isCoordinator(a) && !SNAPSHOT ? el("span", { class: "save-btn", role: "button", tabindex: "0",     // not saved: hidden
          title: "Hide the gatherer agent from the list: its face on the gatherer's row shows it again, and opens it",
          "aria-label": "Hide the gatherer agent", onclick: (ev) => { ev.stopPropagation(); setCrewHidden(g.name, true); },
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); setCrewHidden(g.name, true); } } },
          hideIcon())
        : SNAPSHOT ? (saved ? el("span", { class: "save-btn on", title: "Saved for later" }, saveIcon(true)) : null)
          : el("span", { class: "save-btn" + (saved ? " on" : ""), role: "button", tabindex: "0", "aria-pressed": saved ? "true" : "false",
            title: saved ? "Saved for later: click to unsave" : "Save for later: kept under Saved, at the top of its gatherer",
            "aria-label": saved ? "Unsave" : "Save for later", onclick: (ev) => { ev.stopPropagation(); setSaved(g.name, a, !saved); },
            onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); setSaved(g.name, a, !saved); } } },
            saveIcon(saved)),
        closable(a) ? el("span", { class: "close-btn", role: "button", tabindex: "0", title: "Close this session's process (the dashboard's agent or terminal), even mid-turn",
          "aria-label": "Close session", onclick: (ev) => { ev.stopPropagation(); closeSession(a); },
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); closeSession(a); } } },
          closeIcon())
        : discardable(a) ? el("span", { class: "close-btn", role: "button", tabindex: "0",
          title: "Close: it never started, so it goes from the list, and nothing of it is kept",
          "aria-label": "Close session", onclick: (ev) => { ev.stopPropagation(); discardSession(g, a); },
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); discardSession(g, a); } } },
          closeIcon()) : null,
        !hasChat(a) ? null : a.chattable === false
          ? el("span", { class: "chat-icon held", title: "Open in another process: close it there to chat here" }, chatIcon(true))
          : el("span", { class: "chat-icon", title: a.session ? "Chat: started from the dashboard" : "Chat: can be messaged from the dashboard" }, chatIcon(false))),
      branchChip(g, a),
      (a.background || []).length ? el("div", { class: "bgline", title: a.background.map((t) => `${TASK_KINDS[t.kind] || t.kind}: ${t.label || t.id}`).join("\n") },
        `${a.background.length} in background · ${a.background.map((t) => t.label || t.id).join(", ")}`) : null));
}
// Naming an actor: its top line in the list, clicked once it is the one shown, becomes a box with its name in it;
// Enter (or a press anywhere else in the page, or Tab away) keeps what is typed, Esc leaves it as it was, and nothing
// typed takes the reader's name back -- the harness's own, or what it was last asked, shows again. Kept as an event in
// its gatherer and given to its harness (POST /api/name): Claude Code's or codex's own list of sessions shows it, and
// a session in the dashboard's terminal is told with its harness's /rename once its turn is over. The box is one
// element for as long as it is open (`nameInput`), put back in each redraw of the list (`nameMoving`), its caret kept.
let nameInput = null, nameMoving = false;
// A press anywhere but in the box ends it -- also where the keys stay put (History's rows, a scroll bar) or go into a
// pane's frame (agPanes.focus) -- and the list is drawn again only once the press is over (`pressHeld`: what waits
// for it), so its click still lands on the row it was pressed on: another actor's shows that actor.
let pressHeld = null;
document.addEventListener("pointerdown", (ev) => {
  if (!state.renaming || ev.target === nameInput) return;
  pressHeld = pressHeld || new Set();
  const over = () => {
    removeEventListener("pointerup", over, true); removeEventListener("pointercancel", over, true); clearTimeout(late);
    setTimeout(() => { const waiting = pressHeld; pressHeld = null; for (const fn of waiting || []) fn(); }, 0);   // after its click
  };
  addEventListener("pointerup", over, true); addEventListener("pointercancel", over, true);
  const late = setTimeout(over, 3000);               // released where this page never hears it
  endRename(true);
}, true);
function drawNamed() { renderAgents(); drawWho(); }
const redrawNamed = () => pressHeld ? pressHeld.add(drawNamed) : drawNamed();
const nameAnswers = new Map();                       // what came of each name given from this page: actor -> the answer
const nameKey = (gname, c) => `${gname}\u0000${c}`;
function nameNote(g, a) {
  if (!a.name || !a.name.text) return "";
  if (a.name.by !== "user") return `${harnessInfo(a.name.by) ? `${harnessName(a.name.by)}'s` : "Its harness's"} name for it\n`;
  const how = nameAnswers.get(nameKey(g.name, a.channel));
  return "Named by you" + (!how ? "" : how.error ? ` · not in ${harnessName(a.harness)}: ${how.error}`
    : how.store || how.terminal ? ` · in ${harnessName(a.harness)} too` : "") + "\n";
}
function startRename(g, a) {
  if (state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, a.channel)) return;
  const was = (a.name && a.name.by === "user" && a.name.text) || "";
  state.renaming = { g: g.name, c: a.channel, value: (a.name && a.name.text) || "", was };
  nameInput = null;
  renderAgents();
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}
function nameBox() {
  if (nameInput) return nameInput;
  const r = state.renaming;
  nameInput = el("input", { class: "name-box", type: "text", maxlength: "120", spellcheck: "false", autocomplete: "off",
    placeholder: r.c === null ? r.g : "Name this actor", "aria-label": r.c === null ? "This gatherer's name" : "This actor's name" });
  nameInput.value = r.value;
  nameInput.addEventListener("input", () => { r.value = nameInput.value; });
  nameInput.addEventListener("keydown", (ev) => {
    ev.stopPropagation();                            // the page's own keys are not this box's
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); endRename(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); endRename(false); }
  });
  // Tab away keeps it (a press has ended it already); not a redraw (`nameMoving`), nor the window going to the back
  // (it comes back focused)
  nameInput.addEventListener("blur", () => { if (!nameMoving && document.hasFocus() && state.renaming === r) endRename(true); });
  return nameInput;
}
async function endRename(keep) {
  const r = state.renaming;
  if (!r) return;
  state.renaming = null; nameInput = null;
  const g = state.home.gatherers.find((x) => x.name === r.g), a = g && g.agents.find((x) => x.channel === r.c);
  const text = r.value.replace(/\s+/g, " ").trim().slice(0, 120);
  if (r.c === null) return keep && g && text !== titleOf(g) ? keepTitle(r.g, text) : redrawNamed();
  if (!keep || !a || text === ((a.name && a.name.text) || "") || (!text && !r.was)) { redrawNamed(); return; }
  const before = a.name;
  a.name = text ? { text, by: "user" } : null;     // shown at once; the gatherer's event confirms it (the harness's own back)
  redrawNamed();
  try {
    const got = await post("/api/name", { gatherer: r.g, channel: r.c, name: text, harness: a.harness, cwd: a.cwd });
    nameAnswers.set(nameKey(r.g, r.c), got);
    if (got.error) setLive(`${text ? "Named" : "Name taken back"} here; not in ${harnessName(a.harness)}: ${got.error}`);
  } catch (err) {
    a.name = before;
    setLive(`Not named: ${err.message}`);
  }
  redrawNamed();
}
// A shell's row (isShell): where it was opened, and when; its close button closes its terminal, as a window's does.
const SHELLS = "Terminals";
function shellRow(g, s) {
  const current = isAt(focusedActor(), g.name, s.id);
  const open = !current && openActors().some((sel) => isAt(sel, g.name, s.id));
  const where = shellPath(s), close = (ev) => { ev.stopPropagation(); closeShell(s); };
  return el("button", { class: "agent shell", type: "button", "aria-current": current ? "true" : "false", "data-key": `${g.name}/${s.id}`,
    "data-group": SHELLS, ...(open ? { "data-open": "true" } : {}),
    title: `Terminal · ${s.cwd}${SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown`}`,
    onclick: (ev) => pick(g.name, s.id, ev), oncontextmenu: (ev) => pickBeside(g.name, s.id, ev) },
    shellLogo(),
    el("div", {},
      el("div", { class: "name", text: where.split("/").filter(Boolean).pop() || where }),
      el("div", { class: "asked", text: where }),
      el("div", { class: "meta" }, el("span", { text: `Terminal · opened ${ago(s.since)}` }),
        el("span", { class: "close-btn", role: "button", tabindex: "0", title: "Terminate: end the shell, and whatever runs in it",
          "aria-label": "Terminate the terminal", onclick: close,
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); close(ev); } } }, closeIcon()))));
}
const shellLogo = () => el("span", { class: "logo shell-logo", "aria-hidden": "true" }, strokeIcon(ICONS.terminal, 18));
async function closeShell(s) {
  try { await post("/api/shells/close", { id: s.id }); }
  catch (err) { setLive(`Not closed: ${err.message}`); }
}
// The group an actor is listed under: those waiting on the user first, then those stopped on an error, then saved for later
// (idle or closed, saved by the reader), then running, then those whose turn is over but something they started still runs,
// then finished (not yet looked at), then idle, then closed; in the list, each in the order the data has them, newest created
// first, so an actor stays in its place, and moves only between them -- but closed, the latest active first: nothing moves
// there once closed
const GROUPS = ["Waiting for you", "Error", "Saved", "Running", "Background", "Finished", "Idle", "Closed"];
const BY_STATUS = { "Waiting for you": "Waiting for you", Error: "Error", Failed: "Error", Building: "Running", Running: "Running",
  Starting: "Running", Background: "Background", Finished: "Finished", Closed: "Closed" };
function groupOf(g, a) {
  const by = BY_STATUS[statusOf(a)[1]] || "Idle";
  return (by === "Idle" || by === "Closed") && savedAs(g.name, a) ? "Saved" : by;
}
// each group's mark, as the list marks its actors
const GROUP_CLS = { "Waiting for you": "asking", Error: "error", Running: "running", Background: "background", Finished: "finished",
  Idle: "idle", Closed: "closed" };
const groupMark = (name) => name === "Saved" ? saveIcon(true) : el("span", { class: `status ${GROUP_CLS[name]}`, "aria-hidden": "true" },
  el("i", { style: `--spin-at: -${Date.now() % 1200}ms` }));

