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
  const asked = homesTaken;                        // its answer kept unless a home came meanwhile (takeHome)
  try { const got = await post("/api/hiding", { gatherer: name, choice }); if (!homeSince(asked)) state.home.hiding = got; }
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
  const asked = homesTaken;
  try { const got = await post("/api/title", { gatherer: gname, title: text }); if (!homeSince(asked)) state.home.titles = got; }
  catch (err) { setLive(`Not named: ${err.message}`); }
  renderAgents();
}
async function setHidden(g, hide) {
  const kept = keepChoice(g.name, hide ? "hidden" : stale(g) ? "shown" : "");
  renderAgents();
  await kept;
  redrawList();
}
// Actors saved for later, kept by the server (saved.py, `home.saved`: {gatherer: {channel: when}}) so every
// dashboard on this home shows the same. One saved is listed in its folder's saved line once it is closed, not with
// the closed ones; while open it is listed by its status (idle among the idle), its bookmark filled. It keeps
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
  renderAgents();
  if (SNAPSHOT) return;                            // a snapshot has no server: this page only
  const asked = homesTaken;
  try { const got = await post("/api/saved", { gatherer: gname, channel, saved: save }); if (!homeSince(asked)) state.home.saved = got; }
  catch (err) { setLive(`Not saved: ${err.message}`); }
  redrawList();
}
// FOLDERS (folders.py, `home.folders`: {gatherer: {folders: [{id, parent, name}], filed: {channel: folder id}}}), kept by
// the server so every dashboard on this home shows the same: the list as a tree, each gatherer its top folder. An actor is
// in one folder, or at its gatherer's top (one filed in a folder deleted since: at the top); a folder in another, or at
// the top. Each gatherer's and each folder's BOX (boxRows) lists, in this order: its folders, by name; its actors open,
// the newest first -- each staying in its place whatever its status does, under no heading (its dot says it; a folder's
// line counts those wanting the reader, stopped on an error, running); its terminals ("N terminals"), its saved actors
// once closed ("N saved") and its other closed ones ("N closed"), each folded till opened, as before folders. A folder is folded till opened (kept in this browser);
// folded, its actors open in a pane stay in view under it. Folders only organise the list: what a gatherer's actors
// share of one another's context is the gatherer's, whatever folder each is in.
const FOLDER_CHARS = 60;
const byName = (x, y) => x.localeCompare(y, undefined, { sensitivity: "base" }) || (x < y ? -1 : x > y ? 1 : 0);
const treeOf = (gname) => (state.home.folders || {})[gname] || { folders: [], filed: {} };
const folderById = (gname, id) => id === null || id === undefined ? null : treeOf(gname).folders.find((f) => f.id === id) || null;
// the folder a folder is in: its id, or null for the gatherer's top (one gone: the top)
const parentOf = (gname, f) => folderById(gname, f.parent) ? f.parent : null;
const kidFolders = (gname, id) => treeOf(gname).folders.filter((f) => parentOf(gname, f) === id);
// The channel the actor is filed as (its own, or the one it was started under, as savedAs finds it); null: in none
const filedAs = (gname, a) => {
  const filed = treeOf(gname).filed;
  return a.channel in filed ? a.channel : a.session && a.session.started_as in filed ? a.session.started_as : null;
};
// The folder the actor is in: its id, or null for its gatherer's top
function folderOf(gname, a) {
  const at = filedAs(gname, a), id = at ? treeOf(gname).filed[at] : null;
  return folderById(gname, id) ? id : null;
}
// Whether folder `id` is folder `inside`, or in it at any depth
function within(gname, id, inside) {
  for (let f = folderById(gname, id), n = 0; f && n < 500; f = folderById(gname, f.parent), n++) if (f.id === inside) return true;
  return false;
}
// A folder's path: its name after those of the folders it is in
function folderPath(gname, id, sep = " / ") {
  const names = [], seen = new Set();
  for (let f = folderById(gname, id); f && !seen.has(f.id); f = folderById(gname, f.parent)) { seen.add(f.id); names.unshift(f.name); }
  return names.join(sep);
}
// The actors (not the gatherer agent) in folder `id`, or in a folder in it
const actorsWithin = (g, id) => g.agents.filter((a) => {
  if (isCoordinator(a)) return false;
  const at = folderOf(g.name, a);
  return at !== null && within(g.name, at, id);
});
// Those of them open in a pane: in view under the folder while it is folded
const inPane = (g, a) => openActors().some((sel) => isAt(sel, g.name, a.channel));
const openIn = (g, id) => actorsWithin(g, id).filter((a) => inPane(g, a));
// What a folder holds, its folders' too: how many actors wait on the reader, stopped on an error, run, are idle; how
// many are open, saved (closed), closed
function folderTally(g, id) {
  const t = { asking: 0, error: 0, running: 0, idle: 0, open: 0, saved: 0, closed: 0 };
  for (const a of actorsWithin(g, id)) {
    const group = groupOf(g, a);
    if (group === "Saved") t.saved++; else if (group === "Closed") t.closed++; else t.open++;
    if (group === "Waiting for you") t.asking++; else if (group === "Error") t.error++; else if (group === "Running") t.running++;
    else if (group === "Idle") t.idle++;
  }
  return t;
}
// Each folder open or not (its key: its gatherer, its id), kept in this browser; a folder made, or one an actor is put
// in, opened
const FOLDERS_OPEN_KEY = "ag-dashboard-folders-open";
const foldersOpen = (() => {
  try { const v = JSON.parse(localStorage.getItem(FOLDERS_OPEN_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) { /* none kept */ }
  return new Set();
})();
const folderKey = (gname, id) => `${gname}\u0000${id}`;
const isOpenFolder = (gname, id) => foldersOpen.has(folderKey(gname, id));
function showFolder(gname, id, open) {
  if (id === null) return;
  const k = folderKey(gname, id);
  if (open) foldersOpen.add(k); else foldersOpen.delete(k);
  try { localStorage.setItem(FOLDERS_OPEN_KEY, JSON.stringify([...foldersOpen])); } catch (e) { /* kept for this page only */ }
}
function toggleFolder(gname, id) {
  showFolder(gname, id, !isOpenFolder(gname, id));
  renderAgents();
}
// A box's folds (Closed, Saved, Terminals) open or not, by its key: a gatherer's top by its name (as before folders), a
// folder's by its gatherer and id
const boxKey = (gname, id) => id === null ? gname : `${gname}\u0000f${id}`;
// A name for a new folder in `parent` none beside it has: `base`, else `base 2`, ...
function freeName(gname, parent, base) {
  const taken = new Set(kidFolders(gname, parent).map((f) => f.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}
// The page's own copy changed as the server will change it (`change(the gatherer's tree)`), so the list shows it at
// once; the server's answer, or the next home, has the last word (whichever is newer: takeHome). -> the answer, or null.
async function folderPost(gname, body, change = null) {
  const before = state.home.folders;
  if (change) {
    const all = structuredClone(state.home.folders || {});
    change(all[gname] = all[gname] || { folders: [], filed: {} });
    state.home.folders = all;
  }
  renderAgents();
  if (SNAPSHOT) return null;                       // a snapshot has no server: this page only
  const asked = homesTaken;
  try {
    const got = await post("/api/folders", { gatherer: gname, ...body });
    if (!homeSince(asked)) state.home.folders = got.folders;
    return got;
  } catch (err) {
    if (!homeSince(asked)) state.home.folders = before;
    setLive(`Not done: ${err.message}`);
    return null;
  } finally { redrawList(); }
}
// Actors put in folder `id` (null: their gatherer's top), by the channels they are filed as (or will be): it opened
function fileActors(gname, actors, id) {
  const channels = actors.map((a) => filedAs(gname, a) || a.channel);
  if (!channels.length) return null;
  showFolder(gname, id, true);
  return folderPost(gname, { do: "file", channels, folder: id }, (tree) => {
    for (const c of channels) { if (id === null) delete tree.filed[c]; else tree.filed[c] = id; }
  });
}
// A folder made in `parent` (null: the gatherer's top), opened -- drawn once the server has made it (its id is the
// server's) -> the answer ({made: its id}), or null
async function makeFolder(gname, name, parent) {
  showFolder(gname, parent, true);
  const got = await folderPost(gname, { do: "new", name, parent });
  if (got && got.made !== undefined) { showFolder(gname, got.made, true); renderAgents(); }
  return got;
}
const renameFolder = (gname, id, to) => folderPost(gname, { do: "rename", id, to }, (tree) => {
  const f = tree.folders.find((x) => x.id === id);
  if (f) f.name = to;
});
function moveFolder(gname, id, parent) {
  showFolder(gname, parent, true);
  return folderPost(gname, { do: "move", id, parent }, (tree) => {
    const f = tree.folders.find((x) => x.id === id);
    if (f) f.parent = parent;
  });
}
// A folder deleted: what was in it -- its actors, its folders -- moved up into the one it was in
const deleteFolder = (gname, id) => folderPost(gname, { do: "delete", id }, (tree) => {
  const f = tree.folders.find((x) => x.id === id);
  if (!f) return;
  const up = tree.folders.some((x) => x.id === f.parent) ? f.parent : null;
  for (const x of tree.folders) if (x.parent === id) x.parent = up;
  for (const [c, at] of Object.entries(tree.filed)) if (at === id) { if (up === null) delete tree.filed[c]; else tree.filed[c] = up; }
  tree.folders = tree.folders.filter((x) => x.id !== id);
});
// Where the next actor started from the list goes: the folder whose "+ actor" or "+ ⋯" was pressed last, or its gatherer's
// top (null) -- set by each start button as it is pressed (startButtons; railNew, railMore in the rail's cards). Once started, the actor is filed
// there (fileStarted), as the server answers with its id; a terminal is opened there (startShell, `shellFolder`).
let startIn = { g: "", folder: null };
const aimStart = (gname, id) => { startIn = { g: gname, folder: id }; };
async function fileStarted(gname, id) {
  const fid = startIn.g === gname ? startIn.folder : null;
  if (fid === null || !id || !folderById(gname, fid)) return;
  showFolder(gname, fid, true);
  await folderPost(gname, { do: "file", channels: [id], folder: fid }, (tree) => { tree.filed[id] = fid; });
}
const shellFolder = (gname) => startIn.g === gname && folderById(gname, startIn.folder) ? startIn.folder : null;
// SELECTING several actors of one gatherer, to move them at once (or save, or close them): Shift+click adds an actor to
// the selection, or takes it out (⌘/Ctrl+click opens one beside the one shown). One selected is only tinted; from two,
// each has a check on its avatar, and a bar under the list (renderPickBar) offers Move to…, Save, Close. Dragging a
// selected actor drags them all. A selection is of one gatherer, as actors never leave theirs; Esc, or ✕, clears it.
const picks = { g: null, cs: new Set() };
const picked = (g, a) => picks.g === g.name && picks.cs.has(a.channel);
function togglePick(g, a) {
  if (picks.g !== g.name) { picks.g = g.name; picks.cs = new Set(); }
  if (picks.cs.has(a.channel)) picks.cs.delete(a.channel); else picks.cs.add(a.channel);
  if (!picks.cs.size) picks.g = null;
  renderAgents();
}
function clearPicks(draw = true) {
  if (!picks.g) return;
  picks.g = null; picks.cs = new Set();
  if (draw) renderAgents();
}
// [its gatherer, the actors selected] as the home has them now (one gone since: left out)
function pickedActors() {
  const g = picks.g && state.home.gatherers.find((x) => x.name === picks.g);
  return g ? [g, g.agents.filter((a) => picks.cs.has(a.channel) && !isCoordinator(a))] : [null, []];
}
function renderPickBar() {
  let bar = document.getElementById("pick-bar");
  if (!bar) {
    bar = el("div", { id: "pick-bar", class: "pick-bar", role: "toolbar", "aria-label": "Selected actors" });
    document.getElementById("agents").after(bar);
  }
  const [g, list] = pickedActors();
  bar.hidden = SNAPSHOT || list.length < 2;
  if (bar.hidden) { bar.replaceChildren(); return; }
  const allSaved = list.every((a) => savedAs(g.name, a));
  bar.replaceChildren(
    el("span", { class: "n", text: `${list.length} selected` }),
    el("button", { type: "button", class: "pb", "data-pop": "picks:move", "aria-haspopup": "menu", "aria-expanded": String(rowPop.key === "picks:move"),
      title: `Put them in a folder of ${titleOf(g)}, or at its top`, onclick: (ev) => openMoveMenu(g, list, ev.currentTarget) },
      strokeIcon(ICONS.folder, 14), "Move to…"),
    el("button", { type: "button", class: "pb", title: allSaved ? "Unsave them all" : "Save them all for later",
      onclick: () => savePicks(g, list, !allSaved) }, saveIcon(allSaved), allSaved ? "Unsave" : "Save"),
    el("button", { type: "button", class: "pb", title: "Close them all: their processes ended, even mid-turn",
      onclick: () => closePicks(g, list) }, closeIcon(), "Close"),
    el("button", { type: "button", class: "pb x", title: "Clear the selection (Esc)", "aria-label": "Clear the selection", onclick: () => clearPicks() }, "✕"));
}
// "Move to…": the gatherer's top, each of its folders as a tree, or a new folder (at the top, then named in its line)
function openMoveMenu(g, list, button) {
  const items = [{ mark: el("span", { class: "top-mark" }, strokeIcon(ICONS.folder, 16)), text: `Top of ${titleOf(g)}`, run: () => movePicks(g, list, null) }];
  const walk = (id, depth) => {
    for (const f of kidFolders(g.name, id)) {
      items.push({ icon: ICONS.folder, text: f.name, depth, run: () => movePicks(g, list, f.id) });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  items.push({ icon: ICONS.folderNew, text: "New folder…", note: "made at the top, the selected actors put in it: name it next",
    run: async () => {
      const got = await makeFolder(g.name, freeName(g.name, null, "New folder"), null);
      if (got && got.made !== undefined) { await movePicks(g, list, got.made); startFolderEdit(g.name, got.made); }
    } });
  openPop("picks:move", button, popMenu(`Move ${list.length} actors to`, items));
}
function movePicks(g, list, id) {
  clearPicks(false);
  return fileActors(g.name, list, id);
}
async function savePicks(g, list, save) {
  for (const a of list) if (!!savedAs(g.name, a) !== save) await setSaved(g.name, a, save);
}
async function closePicks(g, list) {
  clearPicks();
  for (const a of list) {
    if (closable(a)) await closeSession(a);
    else if (discardable(a)) await discardSession(g, a);
  }
}
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || !picks.g || rowPop.el || ev.defaultPrevented) return;
  if (ev.target.closest && ev.target.closest("input, textarea, [contenteditable], .xterm")) return;
  clearPicks();
});
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
// A gatherer's or a folder's actors as its box lists them (FOLDERS): [group, list] for each that has any -- its actors
// open ("Open"), the newest first, whatever their status; then its shells, the oldest first (SHELLS), its saved actors
// once closed ("Saved"), its other closed ones, the newest first ("Closed"). `id`: the folder; null, the gatherer's top.
// The rail (railBox) has them so too.
const OPEN = "Open";
function boxGroups(g, id) {
  const mine = g.agents.filter((a) => !isCoordinator(a) && folderOf(g.name, a) === id);
  const latest = (x, y) => (y.last || 0) - (x.last || 0);
  const groups = [[OPEN, mine.filter((a) => !["Saved", "Closed"].includes(groupOf(g, a))).sort((x, y) => (y.created || 0) - (x.created || 0))]];
  const shells = (state.home.shells || []).filter((s) => s.gatherer === g.name && (folderById(g.name, s.folder) ? s.folder : null) === id);
  groups.push([SHELLS, shells], ["Saved", mine.filter((a) => groupOf(g, a) === "Saved").sort(latest)],
    ["Closed", mine.filter((a) => groupOf(g, a) === "Closed").sort(latest)]);
  return groups.filter(([, list]) => list.length);
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
  drawn.agents = listSignature();                    // what render() compares a home's with
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
    const crew = g.agents.find(isCoordinator);
    const box = el("div", { class: "gatherer" + (picks.g === g.name && picks.cs.size > 1 ? " picking" : "") },
      dropOn(el("div", { class: "gatherer-row", "data-key": g.name },
        el("button", { class: "name", type: "button", "aria-expanded": open ? "true" : "false", onclick: () => toggleGatherer(g.name),
          title: g.policy ? `${g.name} · policy ${g.policy}` : g.name },
          el("span", { class: "caret", text: "▶" }),
          state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null) ? null
            : el("span", { class: "gname", text: titleOf(g) })),
        state.renaming && isAt([state.renaming.g, state.renaming.c], g.name, null) ? nameBox() : null,
        SNAPSHOT ? null : crewButton(g),                 // its gatherer agent, just after its name
        // how many of its actors wait on the user, how many stopped on an error, and how many run now; nothing while none does
        // -- and over them while it is hovered (or in focus), in a folder's line's order: "+ actor", "+ ⋯", a new folder,
        // rename, and hide (a folder's: delete)
        el("span", { class: "fill", onclick: () => toggleGatherer(g.name) }, ...gathererCounts(g),
          el("span", { class: "g-acts", onclick: (ev) => ev.stopPropagation() }, ...(SNAPSHOT ? [] : startButtons(g)),
            SNAPSHOT ? null : el("button", { class: "act newfolder", type: "button", title: `New folder in ${titleOf(g)}`,
              "aria-label": `New folder in ${titleOf(g)}`, onclick: () => startFolderEdit(g.name, null, null) }, strokeIcon(ICONS.folderNew, 14)),
            SNAPSHOT ? null : el("button", { class: "act rename", type: "button", title: `Rename ${titleOf(g)}`, "aria-label": `Rename ${titleOf(g)}`,
              onclick: () => retitle(g) }, strokeIcon("M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8", 14)),
            el("button", { class: "act hide", type: "button", title: `Hide ${g.name}`, "aria-label": `Hide ${g.name}`, onclick: () => setHidden(g, true) },
              hideIcon())))), g, null, () => { if (collapsed.has(g.name)) toggleGatherer(g.name); }));
    if (state.adding && state.adding.gatherer === g.name) box.append(newForm());
    if (g.error) box.append(el("div", { class: "servers", text: `Database unreadable: ${g.error}` }));
    // open: what is in it -- its gatherer agent, then its box's rows -- set in under its row, as a folder's are (g-kids)
    const kids = open ? [crew && !crewHidden.has(g.name) ? agentRow(g, crew, CREW_GROUP) : null, ...boxRows(g, null)].filter(Boolean) : [];
    if (kids.length) box.append(el("div", { class: "g-kids" }, ...kids));
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
  markDragged();                                     // drawn again mid-drag: what is dragged, still shown as it
  renderPickBar();
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
  const pk = picked(g, a);
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
  const row = el(naming ? "div" : "button", { class: "agent" + (naming ? " renaming" : "") + (isCoordinator(a) ? " coordinator" : "") + (pk ? " picked" : ""),
    ...(naming ? {} : { type: "button" }),
    "aria-current": current ? "true" : "false", "data-key": `${g.name}/${a.channel}`, "data-group": group,
    ...(open ? { "data-open": "true" } : {}), ...(naming ? {} : { "data-card": key(g.name, a.channel) }),
    // hovered, the card (actorCard) says who it is; where there is no hovering, its title
    ...(HOVERS.matches ? {} : { title: `${harnessName(a.harness)} · ${label} · ${a.channel}${a.cwd ? "\n" + a.cwd : ""}`
      + (asked && named ? `\nAsked: ${firstLine(asked, 300)}` : "") + (a.recap && a.recap.text ? `\nRecap, ${ago(a.recap.at)}: ${a.recap.text}` : "")
      + (SNAPSHOT ? "" : `\n${BESIDE_KEY}+click: open beside the one shown${isCoordinator(a) ? "" : "\nShift+click: select it, to move several"}`) }),
    ...(naming ? {} : { onclick: (ev) => {
      if (ev.shiftKey && !SNAPSHOT && !isCoordinator(a)) { ev.preventDefault(); togglePick(g, a); return; }
      pick(g.name, a.channel, ev);
    }, oncontextmenu: (ev) => pickBeside(g.name, a.channel, ev),
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startRename(g, a); } } }) },
    pickMark(g, a, actorLogo(a)),
    el("div", {},
      // just its name, else what it was last asked, on one line: what it was asked and its recap, in its title (and over
      // the whole page, the monitor's card)
      naming ? nameBox() : el("div", { class: "name" + (named ? "" : asked ? " unnamed" : " none"), ...nameIt,
        text: named || (asked ? firstLine(asked, 200) : isCoordinator(a) ? "Coordinates this gatherer's actors" : "No message yet") }),
      // the list is drawn again on every change: the glyph's turn set by the clock, not restarted each time
      el("div", { class: "meta" }, el("span", { class: `dot ${cls}`, "aria-label": label, style: `--spin-at: -${Date.now() % 1200}ms` }),
        el("span", { text: [size !== null && size !== undefined ? `${compact(size)} tokens` : null, ago(a.last)].filter(Boolean).join(" · ") }),
        saveButton(g, a), closeButton(g, a),
        !hasChat(a) ? null : a.chattable === false
          ? el("span", { class: "chat-icon held", title: "Open in another process: close it there to chat here" }, chatIcon(true))
          : el("span", { class: "chat-icon", title: a.session ? "Chat: started from the dashboard" : "Chat: can be messaged from the dashboard" }, chatIcon(false))),
      branchChip(g, a),
      (a.background || []).length ? el("div", { class: "bgline", title: a.background.map((t) => `${TASK_KINDS[t.kind] || t.kind}: ${t.label || t.id}`).join("\n") },
        `${a.background.length} in background · ${a.background.map((t) => t.label || t.id).join(", ")}`) : null));
  return naming ? row : dragRow(row, g, a);
}
// A selected actor's check, on its avatar, once two or more are selected: a click on it leaves it out
function pickMark(g, a, logo) {
  if (!picked(g, a) || picks.cs.size < 2 || !(logo instanceof HTMLElement)) return logo;
  logo.append(el("span", { class: "pick", role: "button", title: "Selected: click to leave it out", "aria-label": "Leave it out of the selection",
    onclick: (ev) => { ev.stopPropagation(); togglePick(g, a); } }, strokeIcon("M4.25 8.25l2.5 2.5 5-5.25", 11)));
  return logo;
}
// An actor's own buttons, in its row of the list and over its avatar in the rail (railActor): a press on one does only
// what it says, not showing the actor. A span the keys reach (its row a button already), Enter or Space pressing it.
const rowButton = (cls, attrs, run, icon) => el("span", { class: cls, role: "button", tabindex: "0", ...attrs,
  onclick: (ev) => { ev.stopPropagation(); run(); },
  onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); run(); } } }, icon);
// Its bookmark: saved for later (filled), or to be, a press either way -- in a snapshot, filled if saved, and nothing to
// press. The gatherer agent's, in its place: hidden from the list (its face on the gatherer's row shows it again).
function saveButton(g, a) {
  if (isCoordinator(a)) return SNAPSHOT ? null : rowButton("save-btn", { title: "Hide the gatherer agent from the list: its face on the gatherer's row shows it again, and opens it",
    "aria-label": "Hide the gatherer agent" }, () => setCrewHidden(g.name, true), hideIcon());
  const saved = !!savedAs(g.name, a);
  if (SNAPSHOT) return saved ? el("span", { class: "save-btn on", title: "Saved for later" }, saveIcon(true)) : null;
  return rowButton("save-btn" + (saved ? " on" : ""), { "aria-pressed": saved ? "true" : "false",
    title: saved ? "Saved for later: click to unsave (it stays in its folder)"
      : "Save for later: once closed, kept in its folder's saved line, apart from the closed ones",
    "aria-label": saved ? "Unsave" : "Save for later" }, () => setSaved(g.name, a, !saved), saveIcon(saved));
}
// Its ×: its process closed (closable), or, one that never started, it discarded (discardable); null: neither.
function closeButton(g, a) {
  return closable(a) ? rowButton("close-btn", { title: "Close this session's process (the dashboard's agent or terminal), even mid-turn",
      "aria-label": "Close session" }, () => closeSession(a), closeIcon())
    : discardable(a) ? rowButton("close-btn", { title: "Close: it never started, so it goes from the list, and nothing of it is kept",
      "aria-label": "Close session" }, () => discardSession(g, a), closeIcon()) : null;
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
// A box's rows (FOLDERS): its folders -- each a line, and under it, opened, its own box, indented -- then its actors open,
// then its folds. `id`: the folder; null, the gatherer's top.
function boxRows(g, id) {
  const out = [], edit = state.folderEdit;
  if (edit && edit.g === g.name && edit.id === null && edit.parent === id)
    out.push(el("div", { class: "folder-line editing", "data-key": `${g.name}/folder:new` }, folderBox()));
  for (const f of kidFolders(g.name, id)) {
    out.push(folderLine(g, f));
    if (isOpenFolder(g.name, f.id)) {
      const rows = boxRows(g, f.id);
      out.push(el("div", { class: "f-kids" }, ...(rows.length ? rows
        : [el("div", { class: "f-empty", text: SNAPSHOT ? "Empty" : "Empty: drag actors here, or start one with its +" })])));
    } else {
      const peek = openIn(g, f.id);                  // folded: those open in a pane, in view under it
      if (peek.length) out.push(el("div", { class: "f-kids peek" }, ...peek.map((a) => agentRow(g, a, groupOf(g, a)))));
    }
  }
  for (const [name, list] of boxGroups(g, id)) {
    if (name in FOLD_KEYS) { out.push(...foldRows(g, id, name, list)); continue; }
    for (const a of list) out.push(agentRow(g, a, name));
  }
  return out;
}
// A box's fold: its line ("▸ N closed"), and under it, once opened, its actors (or shells) -- folded, those open in a
// pane (no shell) -- open or not kept in this browser, for each box (boxKey).
function foldRows(g, id, name, list) {
  const k = boxKey(g.name, id), shown = foldOpen[name].has(k), shells = name === SHELLS;
  const line = el("button", { class: "agent-group fold-line", type: "button", "aria-expanded": shown ? "true" : "false",
    "data-key": `${g.name}/${id === null ? "" : id}/${name}`,
    title: shells ? (shown ? "Hide the terminals" : "Show the terminals")
      : name === "Saved" ? `${shown ? "Hide" : "Show"} the saved actors that are closed: kept here, apart from the closed ones, till unsaved`
      : `${shown ? "Hide" : "Show"} the closed actors`,
    onclick: () => toggleFold(name, k) },
    `${shown ? "▾" : "▸"} `, name === "Saved" ? el("span", { class: "fold-mark", "aria-hidden": "true" }, saveIcon(true)) : null,
    shells ? plural(list.length, "terminal") : `${list.length} ${name.toLowerCase()}`);
  if (shells) return [line, ...(shown ? list.map((s) => shellRow(g, s)) : [])];
  return [line, ...(shown ? list : list.filter((a) => inPane(g, a))).map((a) => agentRow(g, a, name))];
}
// a folder's icon: the full-page view's folder headings (the list's lines have none, its caret and indent enough)
const folderMark = (open) => el("span", { class: "folder-mark", "aria-hidden": "true" }, strokeIcon(open ? ICONS.folderOpen : ICONS.folder, 14));
// a small button on a folder's line, beside its start buttons
const folderAct = (cls, title, icon, fn) => el("button", { class: `act folder-act ${cls}`, type: "button", title, "aria-label": title,
  onclick: (ev) => { ev.stopPropagation(); fn(); } }, icon);
// how many of a folder's actors wait on the reader, stopped on an error, run: as a gatherer's row counts its own -- and,
// on its line in the list (idle), how many are idle, a grey dot as an idle actor's
function tallyChips(t, of, idle = false) {
  const count = (k, cls, what) => k ? el("span", { class: "count" + cls, title: `${k} of ${of} ${what}` }, el("i", { "aria-hidden": "true" }), String(k)) : null;
  return [count(t.asking, " asking", "waiting for you"), count(t.error, " error", "stopped on an error"), count(t.running, "", "running"),
    idle ? count(t.idle, " idle", "idle") : null].filter(Boolean);
}
const folderSays = (f, t) => `${f.name}: ${plural(t.open, "actor")} open${t.saved ? `, ${t.saved} saved` : ""}${t.closed ? `, ${t.closed} closed` : ""}`
  + " (its folders' too)";
// A folder's line: a button opening or folding it -- its caret, its name -- and at its right how many of the actors it
// holds open (its folders' too) wait on the reader, stopped on an error, run, are idle (a click there too opens or
// folds it). Hovered or in focus, its buttons over those counts: "+ actor" and "+ ⋯", started in it (startButtons), a
// folder made in it, it renamed (F2), it deleted. Dragged: put in another folder, or onto its gatherer's row, at its
// top; actors dropped on it are put in it, and it opens when one is held over it.
function folderLine(g, f) {
  const open = isOpenFolder(g.name, f.id), t = folderTally(g, f.id), edit = state.folderEdit;
  if (edit && edit.g === g.name && edit.id === f.id)
    return el("div", { class: "folder-line editing", "data-key": `${g.name}/folder:${f.id}` }, folderBox());
  const toggle = () => toggleFolder(g.name, f.id);
  const line = el("div", { class: "folder-line", "data-key": `${g.name}/folder:${f.id}`, "data-card": key(g.name, `folder:${f.id}`) },
    el("button", { class: "fbtn", type: "button", "aria-expanded": open ? "true" : "false",
      ...(HOVERS.matches ? {} : { title: folderSays(f, t) }), onclick: toggle,
      onkeydown: (ev) => { if (ev.key === "F2" && !SNAPSHOT) { ev.preventDefault(); startFolderEdit(g.name, f.id); } } },
      el("span", { class: "caret", "aria-hidden": "true", text: "▶" }), el("span", { class: "fname", text: f.name })),
    el("span", { class: "fill", onclick: toggle }, ...tallyChips(t, plural(t.open, "actor"), true),
      SNAPSHOT ? null : el("span", { class: "f-acts", onclick: (ev) => ev.stopPropagation() }, ...startButtons(g, f),
        folderAct("new", `New folder in ${f.name}`, strokeIcon(ICONS.folderNew, 14), () => startFolderEdit(g.name, null, f.id)),
        folderAct("rename", `Rename ${f.name} (F2)`, strokeIcon(ICONS.pencil, 13), () => startFolderEdit(g.name, f.id)),
        folderAct("delete", `Delete ${f.name}: what is in it moves up a level`, closeIcon(), () => deleteFolder(g.name, f.id)))));
  return dropOn(dragFolder(line, g, f), g, f.id, () => { if (!isOpenFolder(g.name, f.id)) toggle(); });
}
// Naming a folder, new (`state.folderEdit.id` null, made in its `parent`) or not: a box in its line, kept through the
// list's redraws as the actor's is (`folderInput`, `nameMoving`); Enter or leaving it keeps what is typed, Esc or nothing
// typed leaves it. A name another folder beside it has (whatever its case), or one with "/", is refused, and said why.
let folderInput = null;
function startFolderEdit(gname, id = null, parent = null) {
  const f = id === null ? null : folderById(gname, id);
  state.folderEdit = { g: gname, id, parent: f ? parentOf(gname, f) : parent, value: f ? f.name : "" };
  folderInput = null;
  if (collapsed.has(gname)) {
    collapsed.delete(gname);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch (e) { /* kept for this page only */ }
  }
  showFolder(gname, state.folderEdit.parent, true);
  renderAgents();
  if (folderInput) { folderInput.focus(); folderInput.select(); }
}
function folderBox() {
  if (folderInput) return folderInput;
  const f = state.folderEdit;
  folderInput = el("input", { class: "name-box folder-box", type: "text", maxlength: String(FOLDER_CHARS), spellcheck: "false",
    autocomplete: "off", placeholder: "Folder name", "aria-label": f.id === null ? "The new folder's name" : "The folder's name" });
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
  if (!keep || !nameFolder(f.g, f.id, f.parent, f.value)) renderAgents();
}
// The folder `id` named `text` (`id` null: one made in `parent`), as typed in the list's box or a card's: none typed,
// or the name it has, is nothing done; a name another folder beside it has (whatever its case), or one with "/", is
// refused, and said why. -> whether something was done.
function nameFolder(gname, id, parent, text) {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, FOLDER_CHARS);
  const was = id === null ? null : folderById(gname, id);
  if (!text || (was && text === was.name)) return false;
  const other = kidFolders(gname, parent).find((x) => x.id !== id && x.name.toLowerCase() === text.toLowerCase());
  if (text.includes("/") || other) {
    setLive(other ? `There is a folder "${other.name}" there already` : 'A folder\'s name can\'t hold "/"');
    return false;
  }
  if (was) renameFolder(gname, id, text); else makeFolder(gname, text, parent);
  return true;
}
// DRAGGING an actor's row -- every selected one's, if it is selected -- or a folder's line, onto a folder's line (into
// it) or its gatherer's row (to its top): `listDrag`, what is dragged, of its gatherer only. While one is, the list is
// not drawn again (`later`, drawn once it is over) -- but to open the folder held over for DROP_OPEN_MS (`force`) -- so
// the lines stay under the pointer. Over when its row says (dragend), or, its row drawn again meanwhile, once the page
// has heard of the drag for DRAG_LOST_MS no more.
let listDrag = null;
const DROP_OPEN_MS = 700, DRAG_LOST_MS = 3000;
function startDrag(ev, g, what) {
  if (listDrag) endDrag();
  listDrag = { g: g.name, cs: what.cs || null, folder: what.folder ?? null, later: false, force: false, seen: Date.now(), spring: null,
    watch: setInterval(() => { if (listDrag && Date.now() - listDrag.seen > DRAG_LOST_MS) endDrag(); }, 500) };
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("text/plain", what.cs ? what.cs.join(",") : `folder:${what.folder}`);
  if (what.cs && what.cs.length > 1) {               // several: said on what is dragged
    const ghost = el("div", { class: "drag-ghost", text: `${what.cs.length} actors` });
    document.body.append(ghost);
    ev.dataTransfer.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove(), 0);
  }
  markDragged();
  cardHide();
}
// what is dragged, shown so -- again after the list is drawn mid-drag
function markDragged() {
  if (!listDrag) return;
  const keys = listDrag.cs ? listDrag.cs.map((c) => `${listDrag.g}/${c}`) : [`${listDrag.g}/folder:${listDrag.folder}`];
  for (const k of keys) for (const n of document.querySelectorAll(`#agents [data-key="${CSS.escape(k)}"]`)) n.classList.add("dragging");
}
function dragRow(row, g, a) {
  if (SNAPSHOT || isCoordinator(a)) return row;
  row.draggable = true;
  row.addEventListener("dragstart", (ev) => startDrag(ev, g, { cs: picked(g, a) && picks.cs.size > 1 ? [...picks.cs] : [a.channel] }));
  row.addEventListener("dragend", endDrag);
  return row;
}
function dragFolder(line, g, f) {
  if (SNAPSHOT) return line;
  line.draggable = true;
  line.addEventListener("dragstart", (ev) => startDrag(ev, g, { folder: f.id }));
  line.addEventListener("dragend", endDrag);
  return line;
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
// Whether what is dragged may go into folder `id` (null: the gatherer's top): of that gatherer; a folder, not into
// itself nor one of its own, nor where it is; actors, one of them at least not there yet.
function canDrop(g, id) {
  const d = listDrag;
  if (!d || d.g !== g.name) return false;
  if (d.folder !== null) {
    const f = folderById(g.name, d.folder);
    return !!f && parentOf(g.name, f) !== id && !(id !== null && within(g.name, id, d.folder));
  }
  return d.cs.some((c) => { const a = g.agents.find((x) => x.channel === c); return !!a && folderOf(g.name, a) !== id; });
}
// `id`: the folder what is dropped on `n` goes into (null: the gatherer's top); `open`, what opens when one is held over it
function dropOn(n, g, id, open) {
  if (SNAPSHOT) return n;
  n.addEventListener("dragenter", (ev) => {
    if (!canDrop(g, id)) return;
    ev.preventDefault();
    n.classList.add("drop-on");
    clearTimeout(listDrag.spring);
    listDrag.spring = setTimeout(() => {
      if (!listDrag || listDrag.g !== g.name) return;
      listDrag.force = true;
      try { open(); } finally { if (listDrag) listDrag.force = false; }
    }, DROP_OPEN_MS);
  });
  n.addEventListener("dragover", (ev) => { if (canDrop(g, id)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; } });
  n.addEventListener("dragleave", (ev) => {
    if (n.contains(ev.relatedTarget)) return;
    n.classList.remove("drop-on");
    if (listDrag) clearTimeout(listDrag.spring);
  });
  n.addEventListener("drop", (ev) => {
    if (!canDrop(g, id)) return;
    ev.preventDefault();
    const d = listDrag, now = state.home.gatherers.find((x) => x.name === g.name) || g;
    d.later = false;                                 // drawn by the move, next
    endDrag();
    if (d.folder !== null) { moveFolder(g.name, d.folder, id); return; }
    const actors = d.cs.map((c) => now.agents.find((x) => x.channel === c)).filter((a) => a && folderOf(g.name, a) !== id);
    if (d.cs.length > 1) clearPicks(false);
    fileActors(g.name, actors, id);
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

