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
// dashboard on this home shows the same. One saved is listed under Saved in its gatherer once it is closed, not
// with the closed ones; while open it is listed by its status (idle among the idle), its bookmark filled. It keeps
// its gatherer from being hidden for having had nothing for a week. The channel it was saved as: a codex
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
  if (!save) folderGuess(gname, (_, mine) => { for (const n of Object.keys(mine)) mine[n] = mine[n].filter((c) => c !== channel); });
  renderAgents();
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  try { state.home.saved = await post("/api/saved", { gatherer: gname, channel, saved: save }); }
  catch (err) { setLive(`Not saved: ${err.message}`); }
  renderAgents();
}
// The folders of a gatherer's saved actors, kept by the server till deleted, empty or not (saved.py,
// `home.saved_folders`: {gatherer: {folder: [the channels in it, as saved]}}). A saved actor is in one or in none:
// once closed, it is listed in it under Saved -- each folder a fold of its own, folded till opened, kept in this
// browser -- and while open, by its status, its folder named beside its bookmark. An actor is put in one by
// dragging its row onto the folder's line (saved too, if it was not), and out of it onto the Saved line; the bookmark
// saves one in none. A folder is made from the Saved line, renamed and deleted from its own (deleted, its actors stay
// saved, in none) -- and all of it by the gatherer agent too (`ag actors save --folder`, `ag actors folder`).
const FOLDER_CHARS = 60;
const foldersOf = (gname) => (state.home.saved_folders || {})[gname] || {};
const byName = (x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }) || (x < y ? -1 : x > y ? 1 : 0);
const folderNames = (gname) => Object.keys(foldersOf(gname)).sort(byName);
const sameFolder = (mine, name) => Object.keys(mine).find((n) => n.toLowerCase() === String(name).toLowerCase());
function folderOf(gname, a) {
  const key = savedAs(gname, a), mine = foldersOf(gname);
  return key ? Object.keys(mine).find((n) => mine[n].includes(key)) || null : null;
}
const FOLDERS_KEY = "ag-dashboard-folders-shown";
const foldersShown = (() => {
  try { const v = JSON.parse(localStorage.getItem(FOLDERS_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
const folderKey = (gname, name) => `${gname}\u0000${String(name).toLowerCase()}`;
function showFolder(gname, name, open) {
  const k = folderKey(gname, name);
  if (open) foldersShown.add(k); else foldersShown.delete(k);
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify([...foldersShown])); } catch (e) { /* kept for this page only */ }
}
function toggleFolder(gname, name) {
  showFolder(gname, name, !foldersShown.has(folderKey(gname, name)));
  renderAgents();
}
// the page's own copy changed as the server will change it (`change(saved of the gatherer, its folders)`), so the
// list shows it at once; the server's answer, or the next home, has the last word
function folderGuess(gname, change) {
  const saved = structuredClone(state.home.saved || {}), folders = structuredClone(state.home.saved_folders || {});
  change(saved[gname] = saved[gname] || {}, folders[gname] = folders[gname] || {});
  state.home.saved = saved; state.home.saved_folders = folders;
}
async function folderPost(gname, body, change) {
  const before = [state.home.saved, state.home.saved_folders];
  folderGuess(gname, change);
  renderAgents();
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  try {
    const got = await post("/api/saved/folders", { gatherer: gname, ...body });
    state.home.saved = got.saved; state.home.saved_folders = got.folders;
  } catch (err) {
    [state.home.saved, state.home.saved_folders] = before;
    setLive(`Not done: ${err.message}`);
  }
  renderAgents();
}
// the actor saved, in `folder` (null: in none)
function fileActor(gname, a, folder) {
  const key = savedAs(gname, a) || a.channel;
  return folderPost(gname, { do: "file", channel: key, name: folder || "" }, (saved, mine) => {
    if (!saved[key]) saved[key] = new Date().toISOString();
    for (const n of Object.keys(mine)) mine[n] = mine[n].filter((c) => c !== key);
    if (folder) (mine[sameFolder(mine, folder) || folder] ||= []).push(key);
  });
}
const makeFolder = (gname, name) => folderPost(gname, { do: "new", name }, (_, mine) => { if (!sameFolder(mine, name)) mine[name] = []; });
function renameFolder(gname, name, to) {
  if (foldersShown.has(folderKey(gname, name))) { showFolder(gname, name, false); showFolder(gname, to, true); }
  return folderPost(gname, { do: "rename", name, to }, (_, mine) => {
    const was = sameFolder(mine, name), other = sameFolder(mine, to);
    if (!was || (other && other !== was)) return;
    const list = mine[was];
    delete mine[was];
    mine[to] = list;
  });
}
const deleteFolder = (gname, name) => folderPost(gname, { do: "delete", name }, (_, mine) => { delete mine[sameFolder(mine, name)]; });
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
// A gatherer's actors as the list has them: its gatherer agent (isCoordinator), apart from the groups, the actor the reader
// arranges the others through; and each group that has any (GROUPS), in that order -- the closed newest first, so drawn
// first; from then on, each group in the order its actors were last in (keepOrder) -- and its shells, oldest first, just
// above the closed actors (SHELLS). The rail (renderRail) has them so too.
function listGroups(g) {
  const crew = g.agents.find(isCoordinator);
  const groups = GROUPS.map((name) => [name, g.agents.filter((a) => a !== crew && groupOf(g, a) === name)])
    .filter(([name, list]) => list.length || (name === "Saved" && hasSaved(g)));   // Saved: with its folders, if none in it
  for (const [name, list] of groups) if (name === "Closed") list.sort((x, y) => (y.last || 0) - (x.last || 0));
  keepOrder(g.name, groups);
  const shells = (state.home.shells || []).filter((s) => s.gatherer === g.name);
  if (shells.length) {
    const at = groups.findIndex(([name]) => name === "Closed");
    groups.splice(at < 0 ? groups.length : at, 0, [SHELLS, shells]);
  }
  return { crew, groups };
}
// how many of its actors wait on the user, how many stopped on an error, and how many run now; nothing while none does
function gathererCounts(g) {
  const n = (group) => g.agents.filter((a) => groupOf(g, a) === group).length, of = plural(g.agents.length, "actor");
  const count = (k, cls, what) => k ? el("span", { class: "count" + cls, title: `${k} of ${of} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  return [count(n("Waiting for you"), " asking", "waiting for you"), count(n("Error"), " error", "stopped on an error"),
    count(n("Running"), "", "running")].filter(Boolean);
}
function renderAgents() {
  if (PANE) return;                                  // a frame has no list: the page around it has
  if (listDrag && !listDrag.force) { listDrag.later = true; return; }   // an actor dragged: once it is over
  renderFolded();
  const aside = document.getElementById("agents");
  const was = listPlaces(aside);
  const typing = nameInput && document.activeElement === nameInput && [nameInput.selectionStart, nameInput.selectionEnd];
  const folderTyping = folderInput && document.activeElement === folderInput && [folderInput.selectionStart, folderInput.selectionEnd];
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
    const { crew, groups } = listGroups(g);
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
        el("span", { class: "fill", onclick: () => toggleGatherer(g.name) }, ...gathererCounts(g)),
        ...(SNAPSHOT ? [] : startButtons(g))));
    if (state.adding && state.adding.gatherer === g.name) box.append(newForm());
    if (g.error) box.append(el("div", { class: "servers", text: `Database unreadable: ${g.error}` }));
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
      if (name === "Saved") { box.append(...savedSection(g, list)); continue; }
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
  if (hover.from === "agents") cardDraw();           // its card, said again from the new data
  nameMoving = false;
  if (state.renaming && !(nameInput && nameInput.isConnected)) { state.renaming = null; nameInput = null; }   // its row folded away
  else if (typing) { nameInput.focus({ preventScroll: true }); nameInput.setSelectionRange(...typing); }
  if (state.folderEdit && !(folderInput && folderInput.isConnected)) { state.folderEdit = null; folderInput = null; }   // folded away
  else if (folderTyping) { folderInput.focus({ preventScroll: true }); folderInput.setSelectionRange(...folderTyping); }
  if (listDrag) {                                    // drawn again mid-drag: the row dragged, still shown as it
    const row = aside.querySelector(`[data-key="${CSS.escape(`${listDrag.g}/${listDrag.c}`)}"]`);
    if (row) row.classList.add("dragging");
  }
  const servers = state.home.hook_servers || [];     // in the dashboard's panel (the header's button)
  document.getElementById("servers").textContent = servers.length
    ? servers.map((s) => `:${s.port} → ${s.upstream}`).join("\n") : "None running.";
}
// A user's message in a chat bubble: src/features/chat/Bubble.tsx (ag_dashboard/DESIGN.md, A5).
// A message between the actors of a gatherer (coordination.py's `envelope`), typed into the receiver's terminal: its first
// line who it is from -- the gatherer agent, or another actor (its id, its name as JSON) -- and how to answer, then a
// blank line, then the message (or, as the list has it, its lines made one). Or the news of a watch the actor asked for
// (coordination.py's `update`, UPDATE): which actor is done, and how, then what it was asked and said. null: neither.
// Chat draws a message with its sender's avatar and name (src/features/chat/Bubble.tsx); the list, as a line (crewLine).
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
const MANAGER = "roles/manager";             // the gatherer agent's picture (avatars.py's ROLES), before it has one
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
// in a line (the list's): who it is from, and its words
const crewLine = (env) => env.from === "update" ? `${env.name || `Actor ${crewId(env.id)}`} is done: ${env.how}`
  : `${env.from === "coordinator" ? "From the gatherer agent" : `From ${env.name || `actor ${crewId(env.id)}`}`}: ${env.text}`;
const isCoordinator = (a) => !!a && a.role === "coordinator";
function agentRow(g, a, group) {
  const [cls, label] = statusOf(a);
  const saved = !!savedAs(g.name, a), folder = saved ? folderOf(g.name, a) : null;
  const current = isAt(focusedActor(), g.name, a.channel);
  const open = !current && openActors().some((sel) => isAt(sel, g.name, a.channel));
  const size = a.real_tokens ?? a.sent_tokens;
  const naming = !!state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, a.channel);
  const named = a.name && a.name.text;
  // its top line -- its name, else what it was last asked -- clicked once it is the one shown: named there
  const nameIt = SNAPSHOT || !current ? {} : { ...(HOVERS.matches ? {} : { title: `${nameNote(g, a)}Click to ${named ? "rename" : "name"} it` }),
    onclick: (ev) => { if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return; ev.stopPropagation(); startRename(g, a); } };
  const env = envelope(a.last_user_message);         // a message from another actor: who from, and its words
  const asked = env ? crewLine(env) : a.last_user_message;
  const row = el(naming ? "div" : "button", { class: "agent" + (naming ? " renaming" : "") + (isCoordinator(a) ? " coordinator" : ""),
    ...(naming ? {} : { type: "button" }),
    "aria-current": current ? "true" : "false", "data-key": `${g.name}/${a.channel}`, "data-group": group,
    ...(open ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": key(g.name, a.channel) }),
    // hovered, the card (actorCard) says who it is; where there is no hovering, its title
    ...(HOVERS.matches ? {} : { title: `${harnessName(a.harness)} · ${label} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}`
      + (asked && named ? `\nAsked: ${firstLine(asked, 300)}` : "") + (a.recap && a.recap.text ? `\nRecap, ${ago(a.recap.at)}: ${a.recap.text}` : "")
      + (SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown`) }),
    ...(naming ? {} : { onclick: (ev) => pick(g.name, a.channel, ev), oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev),
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startRename(g, a); } } }) },
    actorLogo(a),
    el("div", {},
      // just its name, else what it was last asked, on one line: what it was asked and its recap, in its title (and over
      // the whole page, the monitor's card)
      naming ? nameBox() : el("div", { class: "name" + (named ? "" : asked ? " unnamed" : " none"), ...nameIt,
        text: named || (asked ? firstLine(asked, 200) : isCoordinator(a) ? "Coordinates this gatherer's actors" : "No message yet") }),
      // the list is drawn again on every change: the glyph's turn set by the clock, not restarted each time
      el("div", { class: "meta" }, el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
        el("span", { ...(folder && group !== "Saved" ? { class: "when" } : {}),
          text: [size !== null && size !== undefined ? `${compact(size)} tokens` : null, ago(a.last)].filter(Boolean).join(" · ") }),
        isCoordinator(a) && !SNAPSHOT ? el("span", { class: "save-btn", role: "button", tabindex: "0",     // not saved: hidden
          title: "Hide the gatherer agent from the list: its face on the gatherer's row shows it again, and opens it",
          "aria-label": "Hide the gatherer agent", onclick: (ev) => { ev.stopPropagation(); setCrewHidden(g.name, true); },
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); setCrewHidden(g.name, true); } } },
          hideIcon())
        : null,
        // its folder, where it is not listed in it: open, it is listed by its status
        folder && group !== "Saved" ? el("span", { class: "in-folder-chip", title: `Saved in the folder ${folder}: listed in it once closed` },
          folderMark(), el("span", { text: folder })) : null,
        isCoordinator(a) && !SNAPSHOT ? null
        : SNAPSHOT ? (saved ? el("span", { class: "save-btn on", title: folder ? `Saved for later, in the folder ${folder}` : "Saved for later" }, saveIcon(true)) : null)
          : el("span", { class: "save-btn" + (saved ? " on" : ""), role: "button", tabindex: "0", "aria-pressed": saved ? "true" : "false",
            title: saved ? `Saved for later${folder ? `, in the folder ${folder}` : ""}: click to unsave`
              : "Save for later: once closed, kept under Saved, at the top of its gatherer (drag it onto one of its folders to put it there)",
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
  return naming ? row : dragRow(row, g, a);
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
// A gatherer's Saved section: its line ("N saved · K folders", folded till opened, as Closed is) -- shown while the
// gatherer has an actor saved, open or closed, or a folder -- then, opened, its folders, each a line of its own with its
// actors under it once opened, then the saved actors in none. Folded, the ones open in a pane stay in view. The Saved
// line takes an actor dropped on it out of its folder; a folder's line, into it; each opens when one is held over it.
const hasSaved = (g) => Object.keys(foldersOf(g.name)).length > 0 || g.agents.some((a) => !isCoordinator(a) && savedAs(g.name, a))
  || !!(state.folderEdit && state.folderEdit.g === g.name);
function savedSection(g, list) {
  const shown = foldOpen.Saved.has(g.name), mine = foldersOf(g.name), names = folderNames(g.name);
  const inPane = (a) => openActors().some((sel) => isAt(sel, g.name, a.channel));
  // counted: those listed here (closed) of every one saved, those still open (listed by their status) too
  const all = g.agents.filter((a) => !isCoordinator(a) && savedAs(g.name, a));
  const label = `${shown ? "▾" : "▸"} ${all.length ? `${list.length} of ${all.length} saved` : "Saved"}`
    + `${names.length ? ` · ${plural(names.length, "folder")}` : ""}`;
  const out = [dropOn(el("button", { class: "agent-group saved-line", type: "button", "aria-expanded": shown ? "true" : "false",
    "data-key": `${g.name}/Saved`, title: `${shown ? "Hide" : "Show"} saved actors: ${savedCount(list.length, all.length)}`,
    onclick: () => toggleFold("Saved", g.name) },
    el("span", { class: "label", text: label }),
    SNAPSHOT ? null : folderAct("new", "New folder", strokeIcon(ICONS.folderNew, 13), () => startFolderEdit(g.name))),
  g, null, () => !shown && toggleFold("Saved", g.name))];
  const by = new Map(names.map((n) => [n, []])), loose = [], inAll = new Map(names.map((n) => [n, 0]));
  for (const a of all) { const f = folderOf(g.name, a); if (inAll.has(f)) inAll.set(f, inAll.get(f) + 1); }
  for (const a of list) { const f = folderOf(g.name, a); (f && by.has(f) ? by.get(f) : loose).push(a); }
  if (!shown) return [...out, ...list.filter(inPane).map((a) => agentRow(g, a, "Saved"))];
  const edit = state.folderEdit && state.folderEdit.g === g.name ? state.folderEdit : null;
  if (edit && edit.name === null)
    out.push(el("div", { class: "agent-group folder-line editing", "data-key": `${g.name}/folder\u0000new` }, folderMark(), folderBox()));
  for (const n of names) {
    const open = foldersShown.has(folderKey(g.name, n)), xs = by.get(n);
    out.push(edit && edit.name === n
      ? el("div", { class: "agent-group folder-line editing", "data-key": `${g.name}/folder\u0000${n}` }, folderMark(), folderBox())
      : folderLine(g, n, xs.length, inAll.get(n), open));
    for (const a of open ? xs : xs.filter(inPane)) { const row = agentRow(g, a, "Saved"); row.classList.add("in-folder"); out.push(row); }
  }
  return [...out, ...loose.map((a) => agentRow(g, a, "Saved"))];
}
const folderMark = () => el("span", { class: "folder-mark", "aria-hidden": "true" }, strokeIcon(ICONS.folder, 13));
// a small button on a line: a span, as a line is a button already
const folderAct = (cls, title, icon, fn) => el("span", { class: `folder-act ${cls}`, role: "button", tabindex: "0", title, "aria-label": title,
  onclick: (ev) => { ev.stopPropagation(); fn(); },
  onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); fn(); } } }, icon);
// "N listed here (closed), of M saved in it: K still open, listed by their status"
const savedCount = (n, m) => !m ? "none" : `${n} listed here (closed), of ${m} in all`
  + (m > n ? `: ${m - n} still open, listed by ${m - n === 1 ? "its" : "their"} status` : "");
// a folder's line: `n` of its actors listed in it (closed), of `m` in it in all
function folderLine(g, name, n, m, open) {
  return dropOn(el("button", { class: "agent-group folder-line", type: "button", "aria-expanded": open ? "true" : "false",
    "data-key": `${g.name}/folder\u0000${name}`, title: `${name}: ${m ? savedCount(n, m) : "empty"}`
      + `${SNAPSHOT ? "" : "\nDrag an actor here to put it in"}`, onclick: () => toggleFolder(g.name, name) },
    el("span", { class: "caret", text: open ? "▾" : "▸" }), folderMark(), el("span", { class: "fname", text: name }),
    el("span", { class: "n", text: m ? `${n} of ${m}` : "empty" }),
    SNAPSHOT ? null : folderAct("rename", `Rename the folder ${name}`, strokeIcon(ICONS.pencil, 13), () => startFolderEdit(g.name, name)),
    SNAPSHOT ? null : folderAct("delete", `Delete the folder ${name}: its actors stay saved, in no folder`, closeIcon(), () => deleteFolder(g.name, name))),
  g, name, () => { if (!open) toggleFolder(g.name, name); });
}
// Naming a folder, new (`state.folderEdit.name` null) or not: a box in its line, kept through the list's redraws as the
// actor's is (`folderInput`, `nameMoving`); Enter or leaving it keeps what is typed, Esc or nothing typed leaves it.
let folderInput = null;
function startFolderEdit(gname, name = null) {
  state.folderEdit = { g: gname, name, value: name || "" };
  folderInput = null;
  if (!foldOpen.Saved.has(gname)) toggleFold("Saved", gname); else renderAgents();
  if (folderInput) { folderInput.focus(); folderInput.select(); }
}
function folderBox() {
  if (folderInput) return folderInput;
  const f = state.folderEdit;
  folderInput = el("input", { class: "name-box folder-box", type: "text", maxlength: String(FOLDER_CHARS), spellcheck: "false",
    autocomplete: "off", placeholder: "Folder name", "aria-label": f.name === null ? "The new folder's name" : `Rename the folder ${f.name}` });
  folderInput.value = f.value;
  folderInput.addEventListener("input", () => { f.value = folderInput.value; });
  folderInput.addEventListener("keydown", (ev) => {
    ev.stopPropagation();                            // the page's own keys are not this box's
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); endFolderEdit(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); endFolderEdit(false); }
  });
  folderInput.addEventListener("blur", () => { if (!nameMoving && document.hasFocus() && state.folderEdit === f) endFolderEdit(true); });
  return folderInput;
}
function endFolderEdit(keep) {
  const f = state.folderEdit;
  if (!f) return;
  state.folderEdit = null; folderInput = null;
  const text = f.value.replace(/\s+/g, " ").trim().slice(0, FOLDER_CHARS);
  if (!keep || !text || text === f.name) { renderAgents(); return; }
  const other = sameFolder(foldersOf(f.g), text);
  if (other && (f.name === null || other.toLowerCase() !== f.name.toLowerCase())) {
    setLive(`There is a folder "${other}" already`);
    renderAgents();
    return;
  }
  if (f.name === null) makeFolder(f.g, text); else renameFolder(f.g, f.name, text);
}
// Dragging an actor's row onto a folder's line, or the Saved line (dropOn): `listDrag`, the actor dragged, of its gatherer
// only. While one is, the list is not drawn again (`later`, drawn once it is over) -- but to open the fold held over for
// DROP_OPEN_MS (`force`) -- so the lines stay under the pointer. Over when its row says (dragend), or, its row drawn again
// meanwhile, once the page has heard of the drag for DRAG_LOST_MS no more.
let listDrag = null;
const DROP_OPEN_MS = 700, DRAG_LOST_MS = 3000;
function dragRow(row, g, a) {
  if (SNAPSHOT || isCoordinator(a)) return row;
  row.draggable = true;
  row.addEventListener("dragstart", (ev) => {
    if (listDrag) endDrag();
    listDrag = { g: g.name, c: a.channel, later: false, force: false, seen: Date.now(), spring: null,
      watch: setInterval(() => { if (listDrag && Date.now() - listDrag.seen > DRAG_LOST_MS) endDrag(); }, 500) };
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", a.channel);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", endDrag);
  return row;
}
function endDrag() {
  const d = listDrag;
  if (!d) return;
  listDrag = null;
  clearTimeout(d.spring); clearInterval(d.watch);
  for (const n of document.querySelectorAll("#agents :is(.dragging, .drop-on)")) n.classList.remove("dragging", "drop-on");
  if (d.later) renderAgents();
}
document.addEventListener("dragover", () => { if (listDrag) listDrag.seen = Date.now(); }, true);
document.addEventListener("drop", () => { if (listDrag) setTimeout(endDrag, 0); }, true);   // anywhere: after the line's own
// `folder`: the folder it puts an actor in (null: none, still saved); `open`, what opens when one is held over it
function dropOn(n, g, folder, open) {
  if (SNAPSHOT) return n;
  const mine = () => !!listDrag && listDrag.g === g.name;
  n.addEventListener("dragenter", (ev) => {
    if (!mine()) return;
    ev.preventDefault();
    n.classList.add("drop-on");
    clearTimeout(listDrag.spring);
    listDrag.spring = setTimeout(() => {
      if (!mine()) return;
      listDrag.force = true;
      try { open(); } finally { if (listDrag) listDrag.force = false; }
    }, DROP_OPEN_MS);
  });
  n.addEventListener("dragover", (ev) => { if (mine()) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  n.addEventListener("dragleave", (ev) => {
    if (n.contains(ev.relatedTarget)) return;
    n.classList.remove("drop-on");
    if (listDrag) clearTimeout(listDrag.spring);
  });
  n.addEventListener("drop", (ev) => {
    if (!mine()) return;
    ev.preventDefault();
    const c = listDrag.c, a = (state.home.gatherers.find((x) => x.name === g.name) || { agents: [] }).agents.find((x) => x.channel === c);
    listDrag.later = false;                          // drawn by the filing, next
    endDrag();
    if (a && (folder ? folderOf(g.name, a) !== folder : folderOf(g.name, a) || !savedAs(g.name, a))) fileActor(g.name, a, folder);
    else renderAgents();
  });
  return n;
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
// (closed, saved by the reader: one saved but still open is listed by its status), then running, then those whose turn is over but something they started still runs,
// then finished (not yet looked at), then idle, then closed; in the list, each in the order the data has them, newest created
// first, so an actor stays in its place, and moves only between them -- but closed, the latest active first: nothing moves
// there once closed
const GROUPS = ["Waiting for you", "Error", "Saved", "Running", "Background", "Finished", "Idle", "Closed"];
const BY_STATUS = { "Waiting for you": "Waiting for you", Error: "Error", Failed: "Error", Building: "Running", Running: "Running",
  Starting: "Running", Background: "Background", Finished: "Finished", Closed: "Closed" };
function groupOf(g, a) {
  const by = BY_STATUS[statusOf(a)[1]] || "Idle";
  return by === "Closed" && savedAs(g.name, a) ? "Saved" : by;
}
// each group's mark, as the list marks its actors
const GROUP_CLS = { "Waiting for you": "asking", Error: "error", Running: "running", Background: "background", Finished: "finished",
  Idle: "idle", Closed: "closed" };
const groupMark = (name) => name === "Saved" ? saveIcon(true) : el("span", { class: `status ${GROUP_CLS[name]}`, "aria-hidden": "true" },
  el("i", { style: `--spin-at: -${Date.now() % 1200}ms` }));

