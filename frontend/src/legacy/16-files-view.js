// ------------------------------------------------------------------ the Files view
// A turn's files instead of its conversation: each file the agent read, searched or changed in it, the
// lines it saw at their numbers and its changes in place among them (files.py); the commands that were
// not just reading a file listed under them. One turn at a time: the latest, followed, unless one is picked.
const FILE_KINDS = { read: ["read", "var(--s1)"], hit: ["search hit", "var(--s4)"], edit: ["edited", "var(--s2)"],
  write: ["written", "var(--s3)"], delete: ["deleted", "var(--critical)"] };
// Each kind of file by a mark, in its colour, the same wherever a file shows -- in the tree, its legend, the folded bar,
// a call of the file, a command's files: a book read, a glass searched, a pencil edited, a page with a plus written
// whole, a bin deleted; and what git changed as a command ran, a branch.
const MARKS = {
  read: "M8 4.25C6.6 3.2 4.6 2.9 2 3.1v9.2c2.6-.2 4.6.1 6 1.15 1.4-1.05 3.4-1.35 6-1.15V3.1c-2.6-.2-4.6.1-6 1.15zM8 4.25v9.2",
  hit: "M6.75 2.5a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM9.9 9.9l3.6 3.6",
  edit: "M10.6 2.6l2.8 2.8-7.9 7.9-3.4.6.6-3.4zM9.1 4.1l2.8 2.8",
  write: "M4.25 1.75h5l3 3v9a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-11.5a.5.5 0 0 1 .5-.5zM9 1.75v3.25h3.25M8 7.25v4.5M5.75 9.5h4.5",
  delete: "M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.65 9.1a.75.75 0 0 0 .75.65h4.7a.75.75 0 0 0 .75-.65l.65-9.1M6.75 6.75v4.5M9.25 6.75v4.5",
  git: "M5 5v6M11 7c0 2.6-6 1.4-6 4M5 1.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM5 11a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5zM11 3.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z",
};
// a kind of file's mark, `title` said on hover (its name unless given)
function kindMark(kind, size = 12, title) {
  const [name, color] = FILE_KINDS[kind] || [kind, "var(--muted)"];
  const svg = MARKS[kind] ? strokeIcon(MARKS[kind], size) : el("i", { class: "fb", style: `background: ${color}` });
  svg.style.color = color;
  return el("span", { class: "km", title: title === undefined ? name : title }, svg);
}
// what git changed of a file (files.py's `git`: its kinds) by git's mark
const gitMark = (kinds, size = 12) => kindMark("git", size, "by git: " + kinds.map((k) => (FILE_KINDS[k] || [k])[0]).join(", "));
// the lines a change added and removed, as a diff's +N −M (files.py's `changed`); none for none
const changedCount = (ch) => !ch || !(ch[0] || ch[1]) ? null
  : el("span", { class: "chg", title: `${plural(ch[0], "line")} added, ${plural(ch[1], "line")} removed` },
    ch[0] ? el("span", { class: "a", text: `+${full(ch[0])}` }) : null, ch[1] ? el("span", { class: "r", text: `−${full(ch[1])}` }) : null);
const addChanged = (all) => all.reduce((a, x) => !x ? a : !a ? [...x] : [a[0] + x[0], a[1] + x[1]], null);
// What the disk said of a call, where ag's hook server checked it as it ran (files.py's `checked`)
const CHECKED = { true: ["checked", "What the call showed of this file matched the file on disk right after it ran"],
  false: ["not as on disk", "What the call showed of this file did not match the file on disk right after it ran"] };
let filesLoading = Promise.resolve();
function loadFiles() {
  filesLoading = filesLoading.then(loadFilesNow, loadFilesNow);
  return filesLoading;
}
async function loadFilesNow() {
  if (!state.selected || SNAPSHOT) return;
  const [g, c] = state.selected, k = key(g, c);
  if (!state.files || state.files.key !== k) state.files = { key: k, turn: null, sel: null, data: null };
  const f = state.files, info = selectedInfo();
  const cwd = (info && (info.cwd || (info.session && info.session.cwd))) || "";
  const got = await get(`/api/files?gatherer=${encodeURIComponent(g)}&channel=${encodeURIComponent(c)}`
    + `${f.turn === null ? "" : `&turn=${f.turn}`}&cwd=${encodeURIComponent(cwd)}`);
  if (state.files !== f) return;
  if (!got.error) f.data = got;                      // no database yet (none before the gatherer's first call): no turns
  else if (got.error.startsWith("no database")) f.data = { turns: [], turn: null, files: [], commands: [], home: "" };
}
CHAT_FEEDS.files = {
  load: loadFiles,
  data: () => state.files && state.selected && state.files.key === key(...state.selected) && state.files.data
    ? { items: state.files.data.turns, pending: [], earlier: false } : null,
  signature: () => state.files ? [state.files.key, state.files.turn, state.files.sel, signature(state.files.data), sentHere.length] : null,
};
async function setFilesTurn(n) {
  if (!state.files || !state.files.data) return;
  const last = state.files.data.turns.length - 1;
  state.files.turn = n === null || n >= last ? null : Math.max(0, n);
  state.files.sel = null;
  await loadFiles();
  keepingPlace(renderMain);
}
// The kinds of file in the tree, switched in its legend: a file shows while any of its kinds is on. Search
// hits are off until switched on (a file only matched by a search is left out); the choice kept in this browser.
const KINDS_KEY = "ag-dashboard-files-hidden-kinds";
let hiddenKinds = (() => {
  try { const v = JSON.parse(localStorage.getItem(KINDS_KEY)); return new Set(Array.isArray(v) ? v : ["hit"]); }
  catch (e) { return new Set(["hit"]); }
})();
function kindSwitches(gitFiles) {
  return el("div", { class: "fl-legend fl-kinds" }, ...Object.entries(FILE_KINDS).map(([k, [name, color]]) => {
    const on = !hiddenKinds.has(k);
    return el("button", { type: "button", class: "kind" + (on ? "" : " off"), "aria-pressed": on ? "true" : "false",
      title: on ? `Leave out the files only ${name}` : `Show the files ${name}`,
      onclick: () => {
        on ? hiddenKinds.add(k) : hiddenKinds.delete(k);
        try { localStorage.setItem(KINDS_KEY, JSON.stringify([...hiddenKinds])); } catch (e) { /* this page only */ }
        keepingPlace(renderMain);
      } }, kindMark(k, 12, ""), name);
  }), gitFiles ? gitSwitch(gitFiles) : null);
}
// The files in temporary folders (/tmp, $TMPDIR: scratchpads, tests' folders): hidden until asked for, the choice
// kept in this browser. The commands are all listed, whatever folders they touched.
const TMP_KEY = "ag-dashboard-files-tmp";
let showTmp = (() => { try { return localStorage.getItem(TMP_KEY) === "1"; } catch (e) { return false; } })();
function tmpSwitch(n) {
  const box = el("input", { type: "checkbox" });
  box.checked = showTmp;
  box.addEventListener("change", () => {
    showTmp = box.checked;
    try { localStorage.setItem(TMP_KEY, showTmp ? "1" : "0"); } catch (e) { /* this page only */ }
    keepingPlace(renderMain);
  });
  return el("label", { class: "tmp", title: "Files in temporary folders (/tmp, $TMPDIR: scratchpads, tests' folders)" },
    box, `tmp (${n})`);
}
// What git changed as the commands ran -- a pull, a merge, a checkout, a new work tree; in this session's commands or
// another's running then (files.py's `git`): left out until switched on in the files' legend, of the files, a file's
// calls and a command's files; the choice kept in this browser.
const GIT_KEY = "ag-dashboard-files-git";
let showGit = (() => { try { return localStorage.getItem(GIT_KEY) === "1"; } catch (e) { return false; } })();
const gitOnly = (f) => !f.kinds.length && !!(f.git || []).length;   // a file only git changed
function gitSwitch(n) {
  return el("button", { type: "button", class: "kind" + (showGit ? "" : " off"), "aria-pressed": showGit ? "true" : "false",
    title: `${showGit ? "Leave out" : "Show"} what git changed as the commands ran (a pull, a merge, a checkout, a new work tree): `
      + plural(n, "file"),
    onclick: () => {
      showGit = !showGit;
      try { localStorage.setItem(GIT_KEY, showGit ? "1" : "0"); } catch (e) { /* this page only */ }
      keepingPlace(renderMain);
    } }, kindMark("git", 12, ""), `by git (${full(n)})`);
}
// The files and commands at the left, folded to a thin bar of what they hold until opened: by a click on the
// bar or on a message's button for them (or ⌘+click on it), and folded again by the button in their heading or that button
// of the turn they show. The choice kept in this browser.
const SIDE_KEY = "ag-dashboard-files-side-folded-2";   // -2: folded by default
let sideFolded = (() => { try { return localStorage.getItem(SIDE_KEY) !== "0"; } catch (e) { return true; } })();
function foldSide(fold, draw = true) {
  sideFolded = fold;
  try { localStorage.setItem(SIDE_KEY, fold ? "1" : "0"); } catch (e) { /* this page only */ }
  if (fold && state.files && state.files.turn !== null) return setFilesTurn(null);   // folded: the latest turn, which its bar counts
  if (draw) keepingPlace(renderMain);
}
// The background's section under the commands: folded to its heading until opened, the choice kept in this browser.
const BG_KEY = "ag-dashboard-files-bg-open";
let bgOpen = (() => { try { return localStorage.getItem(BG_KEY) === "1"; } catch (e) { return false; } })();
function openBackground(open, draw = true) {
  bgOpen = open;
  try { localStorage.setItem(BG_KEY, open ? "1" : "0"); } catch (e) { /* this page only */ }
  if (draw) keepingPlace(renderMain);
}
// The bar: the files, by kind, in the colours of the tree's (a file of two kinds counted in both; the kinds switched
// off left out); the commands, by how they went, in the colours of the commands' dots; the tasks in the background.
// A click on the background's opens their section too.
function sideBar(files, cmds, info) {
  const bg = (info.background || []).length, n = cmds.ok + cmds.err + cmds.run;
  const kinds = Object.entries(FILE_KINDS).filter(([k]) => !hiddenKinds.has(k))
    .map(([k, [name]]) => [files.filter((f) => f.kinds.includes(k)).length, k, name]).filter(([c]) => c);
  const changed = addChanged(files.map((f) => f.changed));
  const how = [[cmds.ok, "ok", "passed"], [cmds.err, "err", "failed"], [cmds.run, "run", "running"]].filter(([k]) => k);
  const said = [plural(files.length, "file") + (kinds.length ? ": " + kinds.map(([c, , w]) => `${full(c)} ${w}`).join(", ") : "")
    + (changed ? `; ${plural(changed[0], "line")} added, ${full(changed[1])} removed` : ""),
    plural(n, "command") + (how.length ? ": " + how.map(([k, , w]) => `${full(k)} ${w}`).join(", ") : ""),
    bg ? plural(bg, "background task") : null].filter(Boolean).join(" · ");
  const dot = (cls, color) => el("i", { class: "g " + cls, "aria-hidden": "true", style: color ? `background: ${color}` : null });
  const bar = el("button", { type: "button", class: "fl-bar", title: `${said}. Show the files and commands`,
    "aria-label": `Show the files and commands: ${said}`,
    onclick: (ev) => { if (ev.target.closest(".it.bg")) openBackground(true, false); foldSide(false); } },
    strokeIcon(ICONS.sidebar, 15),
    el("span", { class: "stats" },
      el("span", { class: "it" }, strokeIcon(ICONS.page, 13),
        ...(kinds.length ? kinds.map(([c, k]) => el("span", { class: "sub kd" }, kindMark(k, 10, ""), full(c)))
          : [el("span", { text: full(files.length) })]),
        changed && changed[0] ? el("span", { class: "sub chg-a", text: `+${full(changed[0])}` }) : null,
        changed && changed[1] ? el("span", { class: "sub chg-r", text: `−${full(changed[1])}` }) : null),
      el("span", { class: "it" }, strokeIcon(ICONS.terminal, 13),
        ...(how.length ? how.map(([k, cls]) => el("span", { class: "sub " + cls }, dot(cls), full(k))) : [el("span", { text: "0" })])),
      bg ? el("span", { class: "it bg", title: `${plural(bg, "background task")}: show them` }, strokeIcon(ICONS.pulse, 13),
        el("span", { class: "sub bg" }, dot("bg"), full(bg))) : null));
  const acts = barActs();
  return acts ? el("div", { class: "fl-barbox" }, acts, bar) : bar;
}
// With the Editor open above the panes, a pane's head is put in its Chat view's folded bar, at the other end from the
// numbers, as small icons -- which view, the Editor at this actor's folder, Details, and (panes side by side) the
// pane's close -- and the head itself hidden (.pane:has(.fl-acts)), its room the chat's.
function barActs() {
  if (SNAPSHOT || !edShown()) return null;
  const now = chatView().id;
  const act = (label, title, icon, onclick, pressed = null, cls = "") => el("button", { type: "button", class: `fl-act ${cls}`.trim(),
    title, "aria-label": label, "aria-pressed": pressed === null ? null : pressed ? "true" : "false", onclick }, icon);
  return el("div", { class: "fl-acts", role: "group", "aria-label": "This pane" },
    ...offeredViews().filter((v) => !v.more || v.id === now).map((v) =>
      act(v.name, v.description || v.name, v.icon ? strokeIcon(v.icon, 14) : v.name.slice(0, 1), () => setChatView(v.id), v.id === now)),
    act("Editor", "Editor: this actor's work in it -- the folder holding the files it changed lately, else its working directory",
      strokeIcon(ICONS.code, 14), edAtActor),
    act("Details", "Details: what ag saw and did for this actor, and the history's other views", strokeIcon(ICONS.panel, 14),
      () => setDetails(!state.details), !!state.details),
    act("Minimize the chat", MIN_TIP, strokeIcon(ICONS.minimize, 14), () => setChatMin(true)),
    act("Close this pane", "Close this pane", "×", () => $("pane-close").click(), null, "close"));
}
// Turns are picked in the conversation at the right; the header only offers going back to the latest.
function filesTools() {
  const d = state.files && state.files.data;
  if (!d || !d.turns.length || state.files.turn === null) return [];
  return [el("button", { type: "button", title: "Show the latest turn, and follow it", onclick: () => setFilesTurn(null) }, "Latest")];
}
// A shell call's command, as its harness's rules read it (its view's); null for any other call.
const shellCommand = (call) => call && call.view && call.view.shape === "shell" ? str(call.view.command) : null;
const homeDir = () => (state.files && state.files.data && state.files.data.home) || "";
// A call's line (files.py's `_label`) as the commands list and the turn's latest call show it: a shell command it
// is (no description given: codex's) in the terminal's type, coloured
function callLabel(c, n) {
  const text = firstLine(c.text, n);
  return shellCommand(c.call) !== null && !c.call.view.description ? el("span", { class: "cmdline" }, shellSpan(text)) : text;
}
// A call opened: its command as a terminal would show it (shellHtml); a script, or a file's new text, coloured in its
// language; a change as its lines out and in; any other call its inputs one by one, each whole. Under it what it
// printed (ansiHtml), its exit code and run time beside. Copy takes the call as written.
function callView(call, ran = {}) {
  const box = el("div", { class: "cv" + (ran.error ? " err" : "") });
  if (!call) return box;
  const input = call.input && typeof call.input === "object" ? call.input : {}, v = call.view || {};
  const code = (cls, html, copy) => {
    const src = el("div", { class: "cv-src" });
    src.innerHTML = html;
    return el("div", { class: "cv-in " + cls }, src,
      copy === undefined ? null : el("button", { type: "button", class: "code-copy", title: "Copy it as written", "data-copy": copy }, "Copy"));
  };
  const lined = (hs, cls, mark) => hs.map((h) => `<div class="cl ${cls}"><span class="mk">${mark}</span><span class="tx">${h || "&#8203;"}</span></div>`).join("");
  const cwd = ((selectedInfo() || {}).cwd || "").replace(/\/$/, "");   // a path from the session's directory, else from ~
  const path = (p) => el("div", { class: "cv-path", title: str(p), text: cwd && str(p).startsWith(cwd + "/") ? str(p).slice(cwd.length + 1) : tildePath(str(p), homeDir()) });
  const cmd = shellCommand(call);
  if (cmd !== null) {
    box.append(code("sh", shellHtml(cmd, homeDir()), cmd));
    const tags = [v.cwd ? `in ${tildePath(str(v.cwd), homeDir())}` : null, v.background ? "in the background" : null].filter(Boolean);
    if (tags.length) box.append(el("div", { class: "cv-tags" }, ...tags.map((t) => el("span", { text: t }))));
  } else if (v.shape === "script") {                  // a script (codex's code mode), in its language
    box.append(code("src", hlLines(str(v.code), v.lang || "js").join("\n"), str(v.code)));
  } else if (v.shape === "patch") {
    const p = str(v.patch);
    box.append(code("src", hlLines(p, "diff").join("\n"), p));
  } else if (v.shape === "edit" || v.shape === "write") {
    const p = v.path, lang = v.lang || langOfPath(p);
    const edits = v.shape === "edit" ? v.edits || [] : [];
    // a change's two sides read from inside a comment or a string they begin in; a whole file from its top
    const whole = str(v.content), pair = (e) => hlPart(lang, str(e.old), str(e.new));
    const html = edits.length ? edits.map((e) => { const [was, now] = pair(e); return lined(was, "del", "−") + lined(now, "add", "+"); })
      .join('<div class="cv-sep"></div>') : lined(hlLines(whole, lang === "html" ? guessWeb(whole) : lang), "", "");
    box.append(path(p), code("diff", html));
  } else {
    const args = typeof call.input === "string" || !call.input ? [["", str(call.input)]] : Object.entries(input);
    box.append(el("div", { class: "cv-args" }, ...args.flatMap(([k, v]) => {
      const val = el("span", { class: "v" + (typeof v === "string" ? "" : " json") });
      if (typeof v === "string") val.textContent = v; else val.innerHTML = hlLines(JSON.stringify(v, null, 1), "json").join("\n");
      return [el("span", { class: "k", text: k }), val];
    })));
  }
  // what it printed, its harness's lines about the run taken off (files.py's `output`), and what they said: its exit
  // code, how long it ran
  if (ran.output !== undefined && ran.output !== null && (ran.output !== "" || ran.exit != null)) {
    const text = str(ran.output).replace(/\n+$/, ""), out = el("pre", { class: "out" });
    out.innerHTML = text ? outputHtml(text, cmd) : '<span class="a-dim">no output</span>';
    if (ran.exit != null || ran.took) box.append(el("div", { class: "cv-tags" },
      ran.exit != null ? el("span", { class: String(ran.exit) === "0" ? "ok" : "bad", text: `exit ${ran.exit}` }) : null, ran.took ? el("span", { text: ran.took }) : null));
    box.append(out);
  }
  return box;
}
// A file, call by call: each call that touched it in the turn, in order, with what it did to the file --
// the lines it read or found, or its change, at their line numbers.
function fileView(f, rel, id) {
  const box = el("div", { class: "fv" }, el("div", { class: "fv-h" }, el("div", { class: "fv-path", text: rel(f.path) }),
    el("button", { type: "button", class: "fv-close", title: "Close the file", "aria-label": "Close the file",
      onclick: () => { state.files.sel = null; keepingPlace(renderMain); } }, "×")));
  // the last call opened when it first shows -- the file opened, or a call new to it -- and left as the reader leaves it;
  // what git changed left out unless shown (gitSwitch)
  const shown = f.sources.map((s, i) => [s, i]).filter(([s]) => showGit || !s.git);
  const last = `${id}-s${shown.length ? shown[shown.length - 1][1] : -1}`, fresh = !document.getElementById(last);
  shown.forEach(([s, i], n) => {
    const kinds = s.kinds.map((k) => k === "write" ? (s.blocks.some((b) => b.created) ? "created" : "written") : (FILE_KINDS[k] || [k])[0]);
    // folded to its header until clicked; opened, what it did to the file, and its exact call behind "command"
    const code = el("div", { class: "code" });
    for (const b of s.blocks) code.append(...fileBlock(b, langOfPath(f.path)));
    if (s.error && !s.blocks.length) code.append(el("div", { class: "fv-note", text: "The call failed." }));
    box.append(el("details", { class: "fv-call" + (s.error ? " err" : ""), id: `${id}-s${i}`, open: fresh && `${id}-s${i}` === last ? "" : null },
      el("summary", {}, el("span", { class: "tw", text: "▸" }), el("span", { class: "k", text: `${n + 1}` }),
        el("span", { class: "kinds" }, s.git ? gitMark(s.kinds) : null, ...s.kinds.map((k) => kindMark(k, 12))),
        el("span", { class: "via", text: firstLine(s.via, 160) }), changedCount(s.changed),
        el("span", { class: "what", text: (s.git ? "by git: " : "") + kinds.join(", ") + (s.error ? " · failed" : "") },
          CHECKED[s.checked] ? el("span", { class: "chk" + (s.checked ? "" : " off"), title: CHECKED[s.checked][1],
            text: " · " + CHECKED[s.checked][0] }) : null)),
      s.call ? el("details", { class: "fv-cmd", id: `${id}-s${i}-c` }, el("summary", { text: "command" }), callView(s.call)) : null,
      code));
  });
  return box;
}
// One line of a file as a call saw it: its number (null: not known), a mark (+ − ›), its text -- `html`, coloured, if given.
const fileLine = (n, cls, mark, text, html) => {
  const tx = el("span", { class: "tx" });
  if (html === undefined) tx.textContent = text; else tx.innerHTML = html || "&#8203;";
  return el("div", { class: "ln " + cls }, el("span", { class: "no", text: n === null || n === undefined ? "" : String(n) }), el("span", { class: "mk", text: mark }), tx);
};
const fileGap = (text) => el("div", { class: "gap", text });
// a block of the file's lines (`lang` the file's language, langOfPath), each run of them coloured together -- from
// inside a comment or a string it begins in, unless it starts at the file's top (hlPart); what a command printed (an
// "output" block) as it printed it
function fileBlock(b, lang) {
  const out = [];
  const hl = (ls, top) => { const t = ls.join("\n"); return top ? hlLines(t, lang === "html" ? guessWeb(t) : lang) : hlPart(lang, t)[0]; };
  const cut = () => { if (b.cut) out.push(fileGap(`+${plural(b.cut, "more line")} not shown`)); };
  if (b.t === "lines") {
    if (b.start === null) out.push(fileGap("where in the file is not known"));
    const h = hl(b.lines, b.start === 1);
    b.lines.forEach((t, i) => out.push(fileLine(b.start === null ? null : b.start + i, "read", "", t, h[i])));
    cut();
  } else if (b.t === "output") {                 // the file's lines are somewhere in it: which, not known
    out.push(fileGap(b.note));
    const h = ansiHtml(b.lines.join("\n")).split("\n");
    b.lines.forEach((t, i) => out.push(fileLine(null, "read", "", t, h[i] ?? "")));
    cut();
  } else if (b.t === "hits") {
    let prev = null, run = [];
    const flush = () => { const h = hl(run.map((r) => r[1])); run.forEach(([n, t], i) => out.push(fileLine(n, "hit", "›", t, h[i]))); run = []; };
    for (const r of b.rows) {
      if (prev !== null && r[0] > prev + 1) { flush(); out.push(fileGap("⋯")); }
      run.push(r);
      prev = r[0];
    }
    flush();
    cut();
  } else if (b.t === "diff") {
    if (b.at === null) out.push(fileGap("where in the file is not known: its lines were not seen"));
    const above = b.above || [], below = b.below || [], ctx = (rows) => rows.map((r) => r[1]);
    // the lines before and after, coloured once with the old lines between them and once with the new, both from
    // inside what the lines above begin in
    const [was, now] = hlPart(lang, [...ctx(above), ...b.old, ...ctx(below)].join("\n"), [...ctx(above), ...b.new, ...ctx(below)].join("\n"));
    above.forEach(([n, t], i) => out.push(fileLine(n, "ctx", "", t, was[i])));
    b.old.forEach((t, i) => out.push(fileLine(b.at === null ? null : b.at + i, "del", "−", t, was[above.length + i])));
    b.new.forEach((t, i) => out.push(fileLine(b.at === null ? null : b.at + i, "add", "+", t, now[above.length + i])));
    below.forEach(([n, t], i) => out.push(fileLine(n, "ctx", "", t, now[above.length + b.new.length + i])));
    out.push(el("div", { class: "sep" }));
  } else if (b.t === "write") {
    const h = hl(b.lines, true);
    b.lines.forEach((t, i) => out.push(fileLine(i + 1, "add", "+", t, h[i])));
    cut();
  } else if (b.t === "append") {
    out.push(fileGap("added at the end of the file"));
    const h = hl(b.lines, true);
    b.lines.forEach((t, i) => out.push(fileLine(null, "add", "+", t, h[i])));
    cut();
  } else if (b.t === "image") {
    const [g] = state.selected || [];
    out.push(el("a", { class: "fv-img", target: "_blank", rel: "noopener",
      href: `/api/image?gatherer=${encodeURIComponent(g)}&row_id=${b.row_id}&id=${encodeURIComponent(b.id)}` },
      el("img", { alt: "the image the agent viewed", loading: "lazy",
        src: `/api/image?gatherer=${encodeURIComponent(g)}&row_id=${b.row_id}&id=${encodeURIComponent(b.id)}` })));
  } else if (b.t === "note") {
    out.push(el("div", { class: "fv-note", text: b.text }));
  }
  return out;
}
function filesRender({ info, session, running, writable, held }) {
  const d = state.files && state.files.data;
  const asking = errorNote(info) || askingNote(info) || answeredNote(info);
  if (!d) return [el("div", { class: "desc", style: "padding: 10px 16px", text: SNAPSHOT ? "A snapshot has no files: run `ag dashboard` live to see them." : "Loading…" }), asking].filter(Boolean);
  if (!d.turns.length) {                             // the first message: pending, sent from here; or sent, its turn begun
    const h = heard(info), opens = openings(h), first = opens.length ? null : pendingTalk(info, h);
    if (opens.length) return [el("div", { class: "fl-talk" }, ...opens.flatMap((q, i) => openedTurn(info, q, i === opens.length - 1, h))), asking];
    // none yet: the actor waving hello, saying its line (or that there is none yet) -- under the first message while it
    // waits to reach the agent
    const says = writable && !held && session.status !== "starting" && info.avatar && info.avatar_hello;
    return [el("div", { class: "fl-talk hi", "data-morph": "" }, first && el("div", { class: "fl-turn" }, first),
      el("div", { class: "fl-hello", "data-morph": "" }, greeting(info), first ? null : says ? helloLine(info.avatar_hello)
        : el("div", { text: session.status === "starting" ? "Starting the agent…" : writable && !held ? "No messages yet. Write one below." : "No messages yet." }))),
      asking].filter(Boolean);
  }
  // the view opened afresh (from another view, or the page's first draw): the conversation and the
  // commands start where they would for a new turn -- the commands at their end, the conversation at its end or at the turn picked
  if (!document.querySelector("#main .files .fl-grid")) cmdsShown = talkShown = null;
  const t = d.turns[d.turn];
  const cwd = (info.cwd || "").replace(/\/$/, "");
  const home = (d.home || "").replace(/\/$/, "");
  const under = (p, dir) => !!dir && p !== null && (p === dir || p.startsWith(dir + "/"));
  const rel = (p) => cwd && p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : under(p, home) ? "~" + p.slice(home.length) : p;
  const sel = d.files.find((f) => f.path === state.files.sel && (showGit || !gitOnly(f))) || null;   // none until one is clicked
  const list = el("div", { class: "fl-scroll", "data-keep": "files-list" });
  // the files as one tree of their folders, from / -- the home folder shown as ~, the session's directory
  // marked -- a folder with one child folder and no files shown as one ("ag_dashboard/vendor/"), each
  // folder folded or opened (opened unless folded by a click). A path not absolute (the session's
  // directory not known) goes under a folder of its own. Only the files of the kinds switched on (kindSwitches), and
  // those only git changed when shown (gitSwitch).
  const untmp = d.files.filter((f) => showTmp || !f.temporary);
  const kept = untmp.filter((f) => showGit || !gitOnly(f));
  const files = kept.filter((f) => !f.kinds.length || f.kinds.some((k) => !hiddenKinds.has(k)));
  const kindHidden = kept.length - files.length, gitHidden = untmp.length - kept.length;
  const tmpFiles = d.files.filter((f) => f.temporary).length, gitFiles = untmp.filter((f) => (f.git || []).length).length;
  const commands = d.commands;
  const UNKNOWN = "\0";
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = ((f.path.startsWith("/") ? "" : UNKNOWN + "/") + f.path).split("/"), name = parts.pop();
    let node = root;
    parts.forEach((p, i) => {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [], path: parts.slice(0, i + 1).join("/") });
      node = node.dirs.get(p);
    });
    node.files.push([f, name]);
  }
  const fileRow = (f, name, depth) => el("button", { type: "button", class: "fl-file" + (f === sel ? " on" : ""), title: f.path,
    style: `padding-left: ${12 + depth * 14}px`, "aria-pressed": f === sel ? "true" : "false",
    onclick: () => { state.files.sel = f === sel ? null : f.path; keepingPlace(renderMain); } },   // again: closed
    el("span", { class: "name", text: name }), changedCount(f.changed),
    el("span", { class: "badges" }, ...f.kinds.map((k) => kindMark(k, 12, k === "write" && f.created ? "created" : undefined)),
      showGit && (f.git || []).length ? gitMark(f.git) : null));
  const folded = state.files.folded || (state.files.folded = new Set());
  // a folder's row: its path from the row above it ("" the root, /); from above the home folder into it, as ~. A
  // harness's memory of a directory (harness_kit's `memory_folder`) marked, the long name it gives the directory cut.
  const MEMORY = memoryFolders();
  const memoryKey = MEMORY.length ? new RegExp(MEMORY.map(([re]) => re.source).join("|")) : /(?!)/;
  const label = (above, path) => path === UNKNOWN ? "relative to an unknown folder"
    : (under(path, home) && !under(above, home) ? "~" + path.slice(home.length)
      : above === null ? path : path.slice(above.length + 1))
      .replace(memoryKey, (m, ...g) => m.replace(g.slice(0, MEMORY.length).find((k) => k !== undefined) ?? "", "…")) + "/";
  const grow = (node, into, depth, above) => {
    for (const [, sub] of [...node.dirs].sort((x, y) => (x[0] === UNKNOWN) - (y[0] === UNKNOWN) || x[0].localeCompare(y[0]))) {
      let dir = sub;
      while (!dir.files.length && dir.dirs.size === 1 && !(cwd && dir.path === cwd) && dir.path !== UNKNOWN) {
        dir = [...dir.dirs.values()][0];                                // a chain of single folders: one row
      }
      const count = (x) => x.files.length + [...x.dirs.values()].reduce((a, y) => a + count(y), 0);
      const open = !folded.has(dir.path);
      into.append(el("button", { type: "button", class: "fl-dir", title: dir.path.startsWith(UNKNOWN) ? dir.path.slice(2) : dir.path || "/",
        style: `padding-left: ${12 + depth * 14}px`, "aria-expanded": open ? "true" : "false",
        onclick: () => { open ? folded.add(dir.path) : folded.delete(dir.path); keepingPlace(renderMain); } },
        el("span", { class: "tw", text: open ? "▾" : "▸" }), el("span", { class: "name", text: label(above, dir.path) }),
        cwd && dir.path === cwd ? el("span", { class: "wd", title: "The session's working directory", text: "cwd" }) : null,
        MEMORY.find(([re]) => re.test(dir.path)) ? el("span", { class: "wd", text: "memory",
          title: `${harnessName(MEMORY.find(([re]) => re.test(dir.path))[1])}'s memory of a directory: what it keeps for later sessions there` }) : null,
        open ? null : el("span", { class: "n", text: `${count(dir)}` })));
      if (!open) continue;
      const kids = el("div", { class: "fl-kids", style: `--guide: ${17 + depth * 14}px` });   // under its caret's middle
      grow(dir, kids, depth + 1, dir.path);
      into.append(kids);
    }
    for (const [f, name] of node.files.sort((x, y) => x[1].localeCompare(y[1]))) into.append(fileRow(f, name, depth));
  };
  grow(root, list, 0, null);
  if (!files.length) list.append(el("div", { class: "fv-note", text: kindHidden ? `Only ${plural(kindHidden, "file")} of the kinds switched off below.`
    : gitHidden ? `Only ${plural(gitHidden, "file")} git changed.`
    : tmpFiles ? `Only ${plural(tmpFiles, "file")} in temporary folders.`
    : running && d.turn === d.turns.length - 1 ? "No files yet in this turn." : "The agent touched no files in this turn." }));
  // every call of the turn, in the order made: what it did, its outcome, and the files it touched (a click opens one) --
  // those only git changed as it ran when shown (gitSwitch)
  const cmdFiles = (c) => (c.files || []).filter((p) => showGit || (c.did || {})[p] || !(c.git || {})[p]);
  const cmds = el("div", { class: "fl-scroll", "data-keep": `files-cmds-${d.turn}`, "data-follow": "1" });
  commands.forEach((c, i) => cmds.append(el("div", { class: "fl-cmd" },
    el("span", { class: "g " + (c.error ? "err" : c.running && running ? "run" : "ok"), text: "●" }),
    el("details", { id: `fl-${d.turn}-c${i}` }, el("summary", {}, el("span", { class: "k", text: `${i + 1}` }), callLabel(c, 140),
      changedCount(c.changed)),
      cmdFiles(c).length ? el("div", { class: "fl-cmd-files" }, ...cmdFiles(c).map((p) => el("button", { type: "button", title: p,
        onclick: () => { state.files.sel = p; keepingPlace(renderMain); } }, ...((c.did || {})[p] || []).map((k) => kindMark(k, 11)),
        showGit && (c.git || {})[p] ? gitMark(c.git[p], 11) : null, rel(p).split("/").pop()))) : null,
      callView(c.call, c)))));
  if (!commands.length) cmds.append(el("div", { class: "fv-note", text: "No commands in this turn." }));
  const shown = `${state.files.key}:${d.turn}`;
  if (cmdsShown !== shown) requestAnimationFrame(() => {   // once each time a turn is shown, the latest or one picked: at its end
    const n = document.querySelector(`[data-keep="files-cmds-${d.turn}"]`);
    if (!n) return;
    cmdsShown = shown;
    n.scrollTop = n.scrollHeight;
  });
  // two sections, each its own size and scrolling, each with the legend of its colours
  const legend = (pairs) => el("div", { class: "fl-legend" }, ...pairs.map(([name, color]) =>
    el("span", {}, el("i", { class: "fb", style: `background: ${color}` }), name)));
  const failed = commands.filter((c) => c.error).length;
  const busy = commands.filter((c) => !c.error && c.running && running).length;
  const side = sideFolded ? sideBar(files, { ok: commands.length - failed - busy, err: failed, run: busy }, info)
    : el("div", { class: "fl-side" },
    el("section", { class: "fl-sec files-sec" },
      el("div", { class: "fl-h" }, el("span", { text: files.length ? plural(files.length, "file") : "No files" }),
        tmpFiles ? tmpSwitch(tmpFiles) : null,
        el("button", { type: "button", class: "fold", title: "Fold the files and commands to a bar", "aria-label": "Fold the files and commands",
          onclick: () => foldSide(true) }, strokeIcon(ICONS.sidebar, 14))),
      cwd ? el("div", { class: "fl-wd", title: cwd }, el("span", { text: "Working directory" }),
        el("span", { class: "p", text: under(cwd, home) ? "~" + cwd.slice(home.length) : cwd })) : null, list,
      kindSwitches(gitFiles)),
    el("section", { class: "fl-sec cmds-sec" },
      el("div", { class: "fl-h", text: plural(commands.length, "command") + (failed ? ` · ${failed} failed` : "") }), cmds,
      legend([["passed", "var(--good)"], ["failed", "var(--critical)"], ["running", "var(--warning)"]])),
    filesBackground(info));
  // the file view only while a file is picked: the files and the conversation have the page until then
  const pane = sel ? el("div", { class: "fl-pane", "data-keep": "files-pane" }, fileView(sel, rel, `fl-${d.turn}-${d.files.indexOf(sel)}`)) : null;
  // patched in place to the note (data-morph): what is typed in it keeps its focus as the page draws again
  return el("div", { class: "fl-grid" + (sel ? " open" : "") + (sideFolded ? " folded" : ""), "data-morph": "" }, side, pane,
    el("div", { class: "fl-right", "data-morph": "" }, filesTalk(d, info, running), asking));
}
let cmdsShown = null;
// What runs in the background, under the commands: a section folded to its heading (openBackground), opened to
// its tasks, each a row as a command is -- its dot, what kind it is and what it is for, opened to when it started,
// its last sign of life and the file it writes to. Null when none runs.
function filesBackground(info) {
  const tasks = info.background || [];
  if (!tasks.length) return null;
  const head = el("button", { type: "button", class: "fl-h", "aria-expanded": bgOpen ? "true" : "false",
    title: bgOpen ? "Fold the background tasks" : "Show the background tasks", onclick: () => openBackground(!bgOpen) },
    el("span", { class: "tw", "aria-hidden": "true", text: bgOpen ? "▼" : "▶" }), el("span", { class: "mark", "aria-hidden": "true" }),
    el("span", { text: `${plural(tasks.length, "background task")} running` }));
  if (!bgOpen) return el("section", { class: "fl-sec bg-sec" }, head);
  const meta = (k, v, cls) => v ? el("div", { class: "fl-bg-meta" }, `${k} `, el("span", { class: cls || "", text: v })) : null;
  return el("section", { class: "fl-sec bg-sec open" }, head,
    el("div", { class: "fl-scroll", "data-keep": "files-bg" }, ...tasks.map((t) => el("div", { class: "fl-cmd" },
      el("span", { class: "g bg", text: "●" }),
      el("details", { id: `fl-bg-${t.id}` },
        el("summary", {}, el("span", { class: "kind", text: TASK_KINDS[t.kind] || t.kind }), firstLine(t.label || t.id, 140)),
        el("div", { class: "fl-bg-meta" }, "started ", el("span", { "data-ago": t.started || "", text: ago(t.started) }),
          t.active && t.active - t.started > 2 && !t.event ? el("span", {}, " · active ", el("span", { "data-ago": t.active, text: ago(t.active) })) : null),
        t.event ? el("div", { class: "fl-bg-meta" }, "last event ", el("span", { "data-ago": t.event_at || "", text: ago(t.event_at) }),
          ": ", el("span", { text: t.event })) : null,
        meta("writes to", t.output, "p"))))));
}
// The conversation, at the right: each of the user's messages a turn, at the right, and under it the agent's:
// its last message whole (a click folds it to its first line), the ones before it -- what it said on the way,
// its thinking -- each folded to a line, the latest few shown and the earlier behind a + (and a − folds them again). The
// latest turns shown, the earlier a few more at a time as the reader scrolls up past the top (pullEarlier). While the turn
// runs, what the agent is doing at its end, as the
// Transcript's status line. A button at each message, or ⌘+click on it, shows its turn's files. What the user wrote while a turn ran is
// part of it: once sent to the agent (`more`; in the latest turn also Claude Code's queue, the agent's `typed`,
// data.py's, from its record of the session), stacked on its first message; until then, at the latest turn's end, faded and marked pending
// (pendingTalk) -- as is a message sent from this page's box, from the moment it is sent. A message that opened a
// turn ag has not stored yet is that turn's, in full, the moment Claude Code has it (openedTurn).
const MINOR_SHOWN = 2, TURNS_SHOWN = 5;
let talkShown = null;
// What the selected actor's own records say the user wrote: ag's stored messages (each turn's first, and what was written
// while it ran), Claude Code's queue less what ag has stored since (the agent's `typed`, data.py's), and the dashboard
// agent's queue (its session's `queued`).
// A command the user ran that Claude Code runs itself (/context: no message of theirs is stored, only Claude Code's
// note of it, files.py's `ran` -- not shown) counts as one of their messages too.
function heard(info) {
  const d = state.files && state.selected && state.files.key === key(...state.selected) && state.files.data;
  const stored = d ? d.turns.flatMap((t) => [t, ...(t.more || []), ...(t.ran || []).map((name) => ({ text: name, at: t.at }))]) : [];
  const typed = ((state.agent && state.selected && state.agent.channel === state.selected[1] && state.agent.typed) || [])
    .filter((q) => !stored.some((m) => m.at >= (q.at || 0) - 1 && sameWords(m.text, q.text)));
  return { stored, typed, queued: (info && info.session && info.session.queued) || [] };
}
// A message as the user typed it, to match what was sent with what is stored (the server gives the user's words as
// typed: harness_kit's): "!echo hi" the same as "! echo hi".
const typedAs = (text) => bwStrip(String(text ?? "")).trim().replace(/^!\s*/, "! ");
// whether two say the same: their start, as a stored message is clipped
const sameWords = (a, b) => typedAs(a).slice(0, 200) === typedAs(b).slice(0, 200);
// how many messages of these words the actor has had -- not counting one sent from Chat it has not had yet (`chat`: its
// `chat_sent`, the dashboard's own record of sending it)
const heardCount = (h, text) => [...h.stored, ...h.typed.filter((q) => !q.chat)].filter((m) => sameWords(m.text, text)).length
  + h.queued.filter((q) => sameWords(q, text)).length;
// Messages sent from this page's box, each {key, text, base, at}: shown pending the moment it is sent, until the
// actor's records hold one more message of its words than when it was sent (`base`) -- from then on, as they say.
// One not seen for UNSEEN_MS says so.
const sentHere = [], UNSEEN_MS = 15000;
state.chatSend = async () => false;                    // the message box's send, as the latest draw made it (chatCard)
const sendFailed = new Map();                         // per actor (its draft's key): why its last message was not sent
// Whether the message Claude Code took back is in its input box untouched, as sessions.py's `took_back` reads it: what was
// last typed into its terminal, the dashboard's, is the key that stopped the turn, after the call before (`since`).
const untouched = (info) => {
  const tb = info && info.taken_back, s = info && info.session;
  return !!tb && !!s && !!s.stopped_at && s.stopped_at > (tb.since || 0);
};
// Claude Code put the message it was stopped on (Esc before any of its answer came: data.py's `taken_back`) back in its
// input box, out of the conversation -- as Chat shows it too, the message in no turn. Untouched there: in this message
// box too, as the actor's draft -- once, and only where nothing is written for the actor. Sent from here, Claude Code's box is emptied
// first (sessions.py's `took_back`), so the two do not go as one. Once it is no longer there untouched -- sent or changed
// in the terminal, or its process gone -- it is taken out of this box too, if it is still as it was put. What was put,
// by the actor's draft ({at, text}), is kept in the tab as drafts are, so a reload does not put back what was cleared.
const REFILLED_KEY = "ag-dashboard-refilled", refilledHere = {};
function refills() {
  try { const v = JSON.parse(sessionStorage.getItem(REFILLED_KEY)); return v && typeof v === "object" ? v : {}; }
  catch (e) { return refilledHere; }
}
function markRefill(draft, mark) {
  const m = refills();
  if (mark) m[draft] = mark; else delete m[draft];
  try { sessionStorage.setItem(REFILLED_KEY, JSON.stringify(m)); } catch (e) { if (mark) refilledHere[draft] = mark; else delete refilledHere[draft]; }
}
function refill(info, draft) {
  const tb = info && info.taken_back, mark = refills()[draft], box = document.getElementById("composer-text");
  const mine = box && box.dataset.draft === draft ? box : null;
  if (tb && untouched(info)) {
    if (mark && mark.at === tb.at) return;
    markRefill(draft, { at: tb.at, text: tb.text });
    if (drafts()[draft] || (mine && mine.value)) return;
    keepDraft(draft, tb.text);
    if (mine) { mine.value = tb.text; fitBox(mine); }
  } else if (mark) {
    markRefill(draft, null);
    if (drafts()[draft] !== mark.text) return;
    keepDraft(draft, "");
    if (mine && mine.value === mark.text) { mine.value = ""; fitBox(mine); }
  }
}
// Esc, as in the harness's own terminal: the agent's turn interrupted -- the key typed into the session's terminal, which
// the dashboard runs. Only while it works or asks (an idle Claude Code takes Esc twice for its rewind; one starting, for
// "No" to trusting its folder), and once a second. `state.interrupting`: the actor it was sent for, and when.
state.interrupting = null;
// Or a message sent from here into its terminal, pending: its turn under way before the dashboard has heard of it (the
// key waits for the message's Enter: sessions.py's `type`) -- not into a terminal the message opened, which may ask
// first whether to trust the folder, where Esc is "No".
const canInterrupt = (info) => !!info && !!info.session && !!info.session.terminal && info.session.status !== "starting"
  && (["running", "asking"].includes(info.status) || opened(info) || sentPending(info));   // not a build of its context, idle
const sentPending = (info) => !!state.selected && state.selected[1] === info.channel
  && sentHere.some((m) => m.ran && m.key === key(...state.selected) && Date.now() - m.at < UNSEEN_MS);
function interrupt(info) {
  const k = state.selected && key(...state.selected);
  if (!canInterrupt(info) || (state.interrupting && state.interrupting.key === k && Date.now() - state.interrupting.at < 1000)) return false;
  state.interrupting = { key: k, at: Date.now() };
  post("/api/terminal/input", { session_id: info.session.session_id, data: "\u001b" })
    .catch((err) => { state.interrupting = null; setLive(`Not interrupted: ${err.message}`); });
  keepingPlace(renderMain);
  return true;
}
const INTERRUPTING_MS = 10000;                      // "Interrupting…" shown at most this long, if the turn goes on
const isInterrupting = () => !!state.interrupting && !!state.selected && state.interrupting.key === key(...state.selected)
  && Date.now() - state.interrupting.at < INTERRUPTING_MS;
// What waits to reach the agent, at the latest turn's end, faded: sent from here and not seen yet; in Claude Code's
// queue; in the dashboard agent's queue. Not seen for long, with its terminal open: it may be asking something there
// first (whether to trust the folder, on a new actor's first message), and the way to it.
function pendingTalk(info, h) {
  const mine = sentHereNow(h);
  const list = [...h.typed.filter((q) => q.sent === null && !q.chat).map((q) => q.text), ...h.queued, ...mine.map((m) => m.text)];
  const chats = h.typed.filter((q) => q.chat && q.sent === null && !list.some((t) => sameWords(t, q.text)));
  list.push(...chats.map((q) => q.text));  // sent from Chat elsewhere (or before a reload), not had yet: its `chat_sent`
  if (!list.length) return null;
  const unseen = mine.some((m) => Date.now() - m.at > UNSEEN_MS) || chats.some((q) => Date.now() - q.at * 1000 > UNSEEN_MS);
  const asks = unseen && info && info.session && info.session.terminal && CHAT_VIEWS.has("terminal");
  return el("div", { class: "fl-pending" }, ...list.map((text) => crewBand(text,
    el("div", { class: "fl-user" + bubbleClass(text), title: "Written while it works: given to the agent at its next step" }, userWords(text)))),
    el("span", { class: "lbl" }, unseen ? "Pending · not seen by the session yet" : "Pending",
      asks ? "; its terminal may be asking something first. " : null,
      asks ? el("button", { type: "button", class: "to-term", onclick: () => setChatView("terminal") }, "Open the terminal") : null));
}
// What was sent from here to the selected actor and the session has not recorded yet (`h`: heard(info)): those it has, dropped.
function sentHereNow(h) {
  const k = state.selected && key(...state.selected);
  for (let i = sentHere.length - 1; i >= 0; i--)
    if (sentHere[i].key === k && heardCount(h, sentHere[i].text) > sentHere[i].base) sentHere.splice(i, 1);
  return sentHere.filter((m) => m.key === k);
}
// The turns Claude Code has started and ag has not stored yet, each by its first message as Claude Code recorded it when
// it went to the model (the agent's `typed`, data.py's: sent, not as part of the turn it was written in; data.py's
// _unstored leaves out those ag has stored) -- for an actor, the selected one's (opened()).
const openings = (h) => h.typed.filter((q) => q.sent !== null && !q.joins);
function opened(a) {
  return !!a && !!state.selected && state.selected[1] === a.channel && !!state.agent && state.agent.channel === a.channel
    && (state.agent.typed || []).some((q) => q.sent !== null && !q.joins);
}
// The line under a running turn: when the actor last did something (`last`; its last try, `retrying`) and how long the
// turn has run (since `at`), and what it does now.
// Short of height (the `talk` container), all on one line, behind the actor's avatar small (`fl-mini`).
const miniAvatar = (info, none) => el("span", { class: "fl-mini", "aria-hidden": "true" }, info && bareAvatar(info)
  ? el("img", { src: bareAvatar(info), alt: "", draggable: "false" }) : none);
const working = (info, last, at, now, retrying = false) => el("div", { class: "fl-working" },
  miniAvatar(info, el("span", { class: "spin" })),
  el("div", { class: "fl-times", "aria-hidden": "true" }, retrying ? "last try " : "last activity ",
    el("span", { "data-ago": last || "", text: ago(last) }),
    at ? " · " : null, at ? el("span", { "data-lasting": at, text: lasting(at) }) : null, at ? " so far" : null,
    canInterrupt(info) ? " · esc to interrupt" : null),
  el("div", { class: "now", role: "status", style: hueInk(info) }, now));
// The latest turn over, short of height: on one line as the actor at work is -- its avatar small, "Done", and how long
// the turn took, from its message to its last event (`end`; from a server without it, the actor's last activity) --
// in place of the avatar done under it (.fl-done). Otherwise not shown.
const finished = (info, t) => el("div", { class: "fl-working fl-finished" }, miniAvatar(info, el("span", { text: "✓" })),
  el("div", { class: "fl-times" }, t.at ? `took ${spell((t.end || info.last || t.at) - t.at)}` : ""),
  el("div", { class: "now", style: hueInk(info) }, "Done"));
// A turn Claude Code has started that ag has not stored yet (openings): its first message, sent -- in full, as the terminal
// shows it -- and, the latest, the actor at work under it and what waits to reach it; drawn from what ag stores once it has,
// from when it was sent still (began: by the actor and the message's words).
const turnsBegan = new Map();
const began = (t) => turnsBegan.get(key(...state.selected) + "\u0000" + typedAs(t.text).slice(0, 200));
function openedTurn(info, q, latest, h) {
  if (turnsBegan.size > 50) turnsBegan.clear();
  turnsBegan.set(key(...state.selected) + "\u0000" + typedAs(q.text).slice(0, 200), q.sent);
  return [el("div", { class: "fl-turn opened" },
    crewBand(q.text, el("div", { class: "fl-user" + bubbleClass(q.text), title: "Sent to the agent: shown here until the gatherer has stored it" },
      userWords(q.text))),
    latest ? working(info, Math.max(q.sent, (info && info.last) || 0), q.sent, isInterrupting() ? "Interrupting…" : "Working…") : null,
    latest ? pendingTalk(info, h) : null),
    latest ? el("div", { class: "fl-status", "aria-hidden": "true", "data-morph": "" }, atWork(info, { work: {} }),
      el("span", { class: "now", style: hueInk(info), text: isInterrupting() ? "Interrupting…" : "Working…" })) : null].filter(Boolean);
}
const talkToEnd = () => { const n = document.querySelector("#main .fl-talk"); if (n) n.scrollTop = n.scrollHeight; };
// Show more of the conversation above where the reader is, keeping what they look at in place.
function showMore(change) {
  const n = document.querySelector("#main .fl-talk"), below = n ? n.scrollHeight - n.scrollTop : 0;
  change();
  keepingPlace(renderMain);
  const again = document.querySelector("#main .fl-talk");
  if (n && again) again.scrollTop = again.scrollHeight - below;
}
// A turn's files and commands, or its replies, shown or folded from its message (filesTalk) -- that message kept where
// it was on the screen, not the turn picked brought into view, as a new pick is (filesTalk's talkShown).
async function keepTurn(n, change) {
  const top = (x) => x.getBoundingClientRect().top, talk = document.querySelector("#main .fl-talk");
  const turn = document.getElementById(`fl-turn-${n}`), y = talk && turn ? top(turn) - top(talk) : null;
  await change();
  if (state.files && state.files.data) talkShown = `${state.files.key}:${state.files.data.turn}`;
  const now = document.querySelector("#main .fl-talk"), again = document.getElementById(`fl-turn-${n}`);
  if (y !== null && now && again) now.scrollTop += top(again) - top(now) - y;
}
// Scrolled to its top, a pull further up -- the wheel, a finger drawn down, or ↑, Page Up or Home with the focus in it --
// shows TURNS_MORE earlier turns above, the reader's place kept. Reaching the top is not one: what is drawn ends there,
// and only a pull PULL_WAIT_MS after (of PULL_PX, so a jolt of the trackpad is not one) shows more. Chrome scrolls before
// the page hears of the wheel, so the top is known by when the conversation got there (`topAt`), not by the event.
const TURNS_MORE = 5, PULL_PX = 60, PULL_WAIT_MS = 300;
let topAt = null, pulled = 0, touchedAt = null;
const talkOf = (n) => n && n.closest ? n.closest("#main .fl-talk") : null;
document.addEventListener("scroll", (ev) => {
  const n = ev.target;
  if (n && n.matches && n.matches("#main .fl-talk")) topAt = n.scrollTop > 0 ? null : topAt ?? Date.now();
}, true);
function pullEarlier(talk, by) {
  if (!talk) return;
  if (talk.scrollTop > 0 || !state.files || !state.files.first) { topAt = null; pulled = 0; return; }
  if (topAt === null) { topAt = Date.now(); pulled = 0; return; }       // at the top only now: drawn up to here
  if (Date.now() - topAt < PULL_WAIT_MS || (pulled += by) < PULL_PX) return;
  pulled = 0; topAt = null;
  showMore(() => { state.files.first = Math.max(0, state.files.first - TURNS_MORE); });
}
document.addEventListener("wheel", (ev) => {
  if (ev.deltaY < 0) pullEarlier(talkOf(ev.target), -ev.deltaY * (ev.deltaMode ? 20 : 1));   // lines or pages: a pull each
}, { passive: true });
document.addEventListener("touchstart", (ev) => { touchedAt = talkOf(ev.target) ? ev.touches[0].clientY : null; }, { passive: true });
document.addEventListener("touchmove", (ev) => {
  if (touchedAt === null) return;
  const by = ev.touches[0].clientY - touchedAt;
  if (by > 0) { touchedAt = ev.touches[0].clientY; pullEarlier(talkOf(ev.target), by); }
}, { passive: true });
document.addEventListener("keydown", (ev) => {
  if (["ArrowUp", "PageUp", "Home"].includes(ev.key) && !ev.defaultPrevented && !(ev.target && ev.target.closest && ev.target.closest("input, textarea, [contenteditable]")))
    pullEarlier(talkOf(ev.target), PULL_PX);
});
// Drawn again (renderMain's `patch`), the conversation is patched in place, turn by turn (data-morph): only what changed
// is replaced -- a turn's new reply, the times under it -- and the rest kept, the actor at work among it, its
// animations running on (its data-sig, what it shows). Replaced whole, the actor restarted at every redraw, every pause
// in the reader's typing while it worked.
function filesTalk(d, info, running) {
  const box = el("div", { class: "fl-talk", "data-keep": "files-talk", "data-follow": "1", "data-morph": "" });
  const closed = state.files.closed || (state.files.closed = new Set());   // the last messages folded by a click
  const opened = state.files.opened || (state.files.opened = new Set());   // the turns whose earlier messages are all shown
  const flips = state.files.flips || (state.files.flips = new Map());      // the turns before the latest a click showed (true) or folded
  const fold = (ev) => { const n = ev.currentTarget; if (n.open) closed.delete(n.id); else closed.add(n.id); };
  // the first turn drawn: the latest few, at first; then where the reader pulled it to (pullEarlier), or the turn they
  // picked. Kept as the conversation grows: a new turn is drawn at the end, none taken from the top.
  const first = state.files.first = Math.max(0, Math.min(d.turn, state.files.first ?? d.turns.length - TURNS_SHOWN));
  if (first) box.append(el("div", { class: "fl-earlier" }, `${plural(first, "earlier turn")} · scroll up for more`));
  // what was written while it worked and sent as part of its turn, not yet stored by ag: stacked on its first message
  const h = heard(info), joined = h.typed.filter((q) => q.sent !== null && q.joins), opens = openings(h);
  // the turns before the latest, folded as the setting has them (below) -- all but the latest two the agent answered in
  // (a message, a thought or a call), and any after them it has yet to answer: the one before those two folds once a
  // newer turn has its first answer. Never by the actor's status, nor by a message sent and not yet stored (opens), so a
  // turn is not folded and shown again as the next starts.
  const answered = d.turns.filter((t) => (t.replies || []).length || t.calls).map((t) => t.n);
  const folds = answered.length < 2 ? 0 : answered[answered.length - 2];   // the turns before this one fold
  for (const t of d.turns.slice(first)) {
    const on = t.n === d.turn;
    const live = running && !opens.length && t.n === d.turns.length - 1;
    if (!live && t.n === d.turns.length - 1 && isInterrupting()) state.interrupting = null;   // its turn over: interrupted
    // its messages, by their place in the turn (their ids keep it); thinking that is encrypted has nothing to read
    const said = (t.replies || []).map((r, i) => [r, i])
      .filter(([r]) => r.kind === "text" || NOTED[r.kind] || (r.kind === "thinking" && (r.texts || []).length));
    const last = said.map(([r]) => r.kind).lastIndexOf("text");
    const before = last < 0 ? said : said.slice(0, last), after = last < 0 ? [] : said.slice(last + 1);
    const extra = before.length <= MINOR_SHOWN + 1 ? 0 : before.length - MINOR_SHOWN;   // behind the +, or shown under the −
    const hidden = opened.has(t.n) ? 0 : extra;
    // a message; or a run of thinking, drawn as one with "Thought:" before its first line
    const reply = ([r, i], main) => {
      const id = `fl-${main ? "m" : "r"}-${t.n}-${i}`;   // apart: the last, once a message follows it, starts folded
      if (NOTED[r.kind]) return notedReply(r, id);
      const thought = r.kind !== "text", text = thought ? r.texts.join("\n\n") : r.text;
      return el("details", { class: "fl-reply" + (main ? " main" : "") + (thought ? " thought" : ""), id,
        open: main && !closed.has(id) ? "" : null, ontoggle: main ? fold : null },
        el("summary", { title: thought ? "Fold or show what it thought" : "Fold or show the whole message" },
          el("span", { class: "dot", text: "●" }), thought ? el("span", { class: "lbl", text: "Thought:" }) : null,
          el("span", { class: "first", text: firstLine(unplanned(text).replace(/`|\*\*|^#{1,6}\s+/gm, ""), 200) })),   // its first line, less the markdown's marks
        markdown(text));
    };
    const toggle = () => { opened.has(t.n) ? opened.delete(t.n) : opened.add(t.n); keepingPlace(renderMain); };
    // a call under way is drawn above, as the turn's latest call: the line under it only says the agent works
    const now = !live ? "" : isInterrupting() ? "Interrupting…" : info && info.failing ? "Retrying…"
      : t.now && t.now.kind === "thinking" ? "Thinking…" : "Working…";
    const done = !live && t.n === d.turns.length - 1 && !opens.length && !!info && ["idle", "finished", "closed"].includes(statusOf(info)[0]);
    const starts = live ? [t.at, began(t)].filter(Boolean) : [];
    const from = starts.length ? Math.min(...starts) : null;      // when it began: sent (began), or stored
    // apart from each other: its files and commands at the left (the turn picked; folded away when they already show), by
    // the button at its message's right or ⌘+click; and before the latest, its replies shown or folded -- folded at first
    // under the setting "Messages only" (earlierTurns) those before `folds`, shown under "Whole"; a click on its message
    // the other way, kept so as the turns move on (flips), until a click puts it back
    const earlier = t.n < d.turns.length - 1, atFirst = !earlier || t.n >= folds || earlierTurns === "whole";
    const whole = flips.has(t.n) ? flips.get(t.n) : atFirst;
    const showing = on && !sideFolded;
    const flip = () => keepTurn(t.n, () => { !whole === atFirst ? flips.delete(t.n) : flips.set(t.n, !whole); keepingPlace(renderMain); });
    const side = () => keepTurn(t.n, () => {
      if (showing) return foldSide(true);
      if (sideFolded) foldSide(false, on);
      if (!on) return setFilesTurn(t.n);
    });
    const sideTip = showing ? "Fold this turn's files and commands" : "Show this turn's files and commands";
    const foldTip = whole ? "Fold this turn to your message" : "Show this turn's replies";
    // the user's message: a click on it before the latest shows or folds the turn's replies (the first message's chevron
    // says which); ⌘+click (Ctrl+click) shows or folds its files and commands at the left, as its button does
    const click = (ev) => ev.metaKey || ev.ctrlKey ? side() : earlier ? flip() : null;
    const sideClick = `${BESIDE_KEY}+click: ${sideTip[0].toLowerCase()}${sideTip.slice(1)}`;
    const said1 = (text, kind, cls, title, ...end) => !earlier
      ? el("div", { class: cls, title: (title ? title + ". " : "") + sideClick, onclick: click }, userWords(text, kind), ...end)
      : el("button", { type: "button", class: cls, "aria-expanded": String(whole), title: `${title ? title + ". " : ""}${foldTip}. ${sideClick}`,
        onclick: click }, userWords(text, kind), ...end);
    // at the first message's end, how much the turn holds: what the agent said and thought (as shown under it), and its
    // calls (files.py's `calls`, as its commands at the left list them)
    const held = said.length + (t.calls || 0);
    const count = held ? el("span", { class: "fl-count", title: `${plural(said.length, "message")} from the agent, ${plural(t.calls || 0, "command")}` },
      plural(held, "message")) : null;
    box.append(el("div", { class: "fl-turn" + (on ? " on" : "") + (whole ? "" : " folded")
      + (whole && !atFirst ? " shown" : ""), id: `fl-turn-${t.n}`, "data-morph": "" },
      el("div", { class: "fl-head" },
        crewBand(t.text, bashBubble(t, said1(t.text, t.kind, "fl-user" + bubbleClass(t.text), null, count,
          earlier ? el("span", { class: "fold-mark", "aria-hidden": "true" }, strokeIcon(ICONS.chevron, 14)) : null))),
        el("span", { class: "fl-btns" },
          el("button", { type: "button", class: "fl-side-btn", "aria-pressed": String(showing), title: sideTip, "aria-label": sideTip,
            onclick: side }, strokeIcon(ICONS.sidebar, 14)))),
      ...[...(t.more || []), ...(t.n === d.turns.length - 1 ? joined : [])].map((m) =>
        crewBand(m.text, said1(m.text, m.kind, "fl-user joined" + bubbleClass(m.text), "Written while it worked, and given to the agent in this turn"))),
      ...(!whole ? [] : [before.length ? el("div", { class: "fl-minor" },
        extra ? el("button", { type: "button", class: "fl-more", "aria-expanded": hidden ? "false" : "true", onclick: toggle,
          title: hidden ? "Show everything the agent said and thought in this turn" : "Fold the earlier messages again" },
          el("span", { class: "sg", "aria-hidden": "true", text: hidden ? "+" : "−" }), plural(extra, "earlier message")) : null,
        ...before.slice(hidden).map((x) => reply(x, false))) : null,
      ...(t.sent || []).map(sentBubble),
      last < 0 ? null : reply(said[last], true),
      after.length ? el("div", { class: "fl-minor" }, ...after.map((x) => reply(x, false))) : null,
      t.last ? el("div", { class: "fl-minor" }, lastCall(t, live, info ? statusOf(info)[0] : "")) : null,
      live ? working(info, info.failing ? info.failing.at : Math.max(info.last || 0, from || 0) || null, from, now, !!info.failing)
        : stoppedLine(info, t, t.n === d.turns.length - 1),
      done ? finished(info, t) : null,
      t.n === d.turns.length - 1 && !opens.length ? pendingTalk(info, h) : null])));
    // under the latest turn's box: the actor at work; or, its turn over, the actor done
    if (live) box.append(el("div", { class: "fl-status", "aria-hidden": "true", "data-morph": "" }, atWork(info, t),
      el("span", { class: "now", style: hueInk(info), text: now })));
    else if (done) box.append(el("div", { class: "fl-done", title: `Done · ${ago(info.last)}` }, atRest(info, t.row_id)));
  }
  box.append(...opens.flatMap((q, i) => openedTurn(info, q, i === opens.length - 1, h)));
  const at = `${state.files && state.files.key}:${d.turn}`;
  if (talkShown !== at) requestAnimationFrame(() => {   // the turn shown brought into view, once per pick: the latest at its end
    if (talkShown === at) return;                        // already (keepTurn: kept where the reader had it)
    const cur = document.querySelector(".fl-talk .fl-turn.on");
    if (!cur) return;
    talkShown = at;
    cur.parentElement.scrollTop = state.files.turn === null ? cur.parentElement.scrollHeight : cur.offsetTop;   // .fl-talk is its offset parent
  });
  requestAnimationFrame(watchCrew);
  return box;
}
// How a turn stopped short, under it, as its harness says it there (files.py's `stopped`), in its own words (harness_kit's
// `stopped_says`): interrupted (Esc), and what it asks then -- or the error it gave up on, or another reason it gives.
// E.g. Claude Code: "⎿ Interrupted · What should Claude do instead?", dim; its error in red. Not the latest turn's error
// while the actor is stopped on it: its note says that in full. Null for a turn that ended as turns do.
const STOPPED_ANY = { lead: "⎿", interrupted: "Interrupted", error: "Error" };
function stoppedLine(info, t, latest) {
  const s = t.stopped;
  if (!s || (s.kind === "error" && latest && info && info.status === "error")) return null;
  const says = (harnessInfo((info && info.harness) || (state.home || {}).harness_default) || {}).stopped || STOPPED_ANY;
  const reason = s.kind !== "error" && s.reason && (says.reasons || {})[s.reason];
  const red = s.kind === "error" || !!reason;
  const said = s.kind === "error" ? s.text || (s.status && says.error_status ? says.error_status.replace("{status}", s.status) : says.error)
    : reason || says.interrupted;
  return el("div", { class: "fl-stopped" + (red ? " error" : ""), role: "note" },
    el("span", { class: "lead", "aria-hidden": "true", text: says.lead }), el("span", { text: said }));
}
// Claude Code's own notes in a turn (files.py's `_note`), each a line among the messages, folded to it: a subagent's
// report handed back, by its task; another session's message, by its first line, the session named (opened: the
// whole). A skill it loaded is with the turn's commands, not here.
const NOTED = { report: "Subagent's report:", peer: "Message from another session:" };
function notedReply(r, id) {
  const peer = r.kind === "peer";
  return el("details", { class: `fl-reply noted ${r.kind}`, id },
    el("summary", { title: peer ? "Show or fold the message" : "Show or fold the report" },
      el("span", { class: "dot", text: "●" }),
      el("span", { class: "lbl", text: peer && r.name ? `Message from ${r.name}:` : NOTED[r.kind] }),
      el("span", { class: "first", text: firstLine(peer ? r.text : r.name || r.text, 200) })),
    r.text ? markdown(r.text, true) : el("div", { class: "fl-none", text: "Empty." }));
}
// A turn's first bubble; a command the user ran with `!` in a bash bubble: the command at its top, and under a rule
// what it printed (files.py's `output`: stdout, then stderr) -- "no output" for none.
function bashBubble(t, bubble) {
  if (!isBash(t.text) || t.output === undefined || t.output === null) return bubble;
  const out = el("pre", { class: "fl-bash-out" + (t.output ? "" : " none"), title: "What it printed" });
  out.innerHTML = t.output ? outputHtml(t.output, String(t.text).replace(/^\s*!\s*/, "")) : "no output";
  return el("div", { class: "fl-bash" }, bubble, out);
}
// The turn's latest call, while the agent has said and thought nothing readable since: under its messages,
// above the line saying it works -- running, or how it went, and what it was; opened, its call and its output.
// A call with no result once the actor no longer runs: waiting on the user (a question, a plan), or stopped --
// interrupted, its process gone -- not run.
function lastCall(t, live, status) {
  const c = t.last;
  const [cls, word] = c.error ? ["err", "Failed:"] : !c.running ? ["ok", "Ran:"] : live ? ["run", "Running:"]
    : status === "asking" ? ["wait", "Waiting for you:"] : ["stop", "Stopped:"];
  return el("details", { class: "fl-reply call", id: `fl-c-${t.n}-${c.id || ""}` },
    el("summary", { title: "Show or fold the call and its output" },
      el("span", { class: "dot " + cls, text: "●" }), el("span", { class: "lbl " + cls, text: word }),
      el("span", { class: "first" }, callLabel(c, 200))),
    callView(c.call, c));
}
addChatView({
  // "files": named so once, and kept as its id, with the readers' choices of it
  id: "files", name: "Chat", feed: "files", frame: "files", icon: ICONS.bubble,
  background: false,                                 // drawn under its commands
  greets: true,                                      // says itself that there is no conversation yet
  asking: false,                                     // drawn under its conversation, at the right
  queued: false,                                     // what waits for the turn to end: at its conversation's end, pending
  description: "The conversation, and beside it each turn's files and commands: what the agent read, searched and changed, with the lines it saw and its changes in place.",
  tools: filesTools,
  render: filesRender,
});

