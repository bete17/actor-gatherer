/* The Notes panel: the gatherer's pages in a sidebar, and the page open, its blocks edited in place (a minimal
Notion). Every change is an op (notebook.py has their list): applied here at once, then sent to the backend, one batch
after another, in order. The backend tells every open panel each batch it applied, in order, numbered (`version`): a
panel skips its own, and applies another window's or an agent's -- never into the block the reader is typing in. */
(async function () {
  "use strict";
  const ag = await AgApp.connect();
  const ME = `p${rid()}`;                                 // this panel: its own batches come back marked with it

  // ---------------------------------------------------------------- small helpers
  const $ = (id) => document.getElementById(id);
  const TYPES = ["text", "h1", "h2", "h3", "todo", "bullet", "number", "quote", "code", "divider"];
  const INDENTED = ["text", "todo", "bullet", "number", "quote"];
  const LISTS = ["todo", "bullet", "number"];
  const MAX_INDENT = 6;
  const PH = { text: "Type ‘/’ for commands", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", todo: "To-do", bullet: "List",
    number: "List", quote: "Quote", code: "Code" };
  const KINDS = [                                          // the / menu, and a block's "Turn into"
    { type: "text", label: "Text", note: "Just writing", glyph: "Aa", words: "text plain paragraph" },
    { type: "h1", label: "Heading 1", note: "A big section heading", glyph: "H1", words: "h1 heading title" },
    { type: "h2", label: "Heading 2", note: "A medium heading", glyph: "H2", words: "h2 heading subtitle" },
    { type: "h3", label: "Heading 3", note: "A small heading", glyph: "H3", words: "h3 heading" },
    { type: "todo", label: "To-do list", note: "Things to tick off", glyph: "☐", words: "todo to-do check task checkbox" },
    { type: "bullet", label: "Bulleted list", note: "A simple list", glyph: "•", words: "bullet list ul unordered" },
    { type: "number", label: "Numbered list", note: "A list with numbers", glyph: "1.", words: "number numbered list ol ordered" },
    { type: "quote", label: "Quote", note: "Words set apart", glyph: "❝", words: "quote blockquote" },
    { type: "code", label: "Code", note: "Code, as it is typed", glyph: "</>", words: "code snippet pre" },
    { type: "divider", label: "Divider", note: "A line between parts", glyph: "—", words: "divider line rule hr separator" },
  ];
  const ICONS = ["📄", "📝", "✅", "📌", "📚", "💡", "🎯", "🚀", "🛒", "🏠", "💼", "🧪", "🐛", "🔧", "📅", "⭐", "❤️", "🔥", "🌱", "🎨",
    "🎵", "✈️", "🍳", "💰", "📈", "🧠", "☕", "🗂️", "🔖", "🧩", "🏃", "📖", "🎓", "🧾", "📦", "⚙️", "🗒️", "🌟", "🍀", "🐣"];
  const SVG = {
    plus: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    grip: '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.3"/><circle cx="7.5" cy="2.5" r="1.3"/><circle cx="2.5" cy="7" r="1.3"/><circle cx="7.5" cy="7" r="1.3"/><circle cx="2.5" cy="11.5" r="1.3"/><circle cx="7.5" cy="11.5" r="1.3"/></svg>',
    caret: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3.5 2l3.5 3-3.5 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="12.5" cy="8" r="1.4"/></svg>',
    doc: '<svg width="15" height="15" viewBox="0 0 16 16"><path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2v3.3h3.3M6 8.2h4.5M6 10.8h4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    side: '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 2.8v10.4" stroke="currentColor" stroke-width="1.3"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    restore: '<svg width="14" height="14" viewBox="0 0 16 16"><path d="M3.5 6.5A5 5 0 1 1 4 11M3.2 3v3.7h3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    check: '<svg width="11" height="11" viewBox="0 0 12 12"><path d="M2.5 6.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    book: '<svg width="44" height="44" viewBox="0 0 44 44"><rect x="9" y="6" width="26" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="13" width="5" height="5" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.2 15.6l1 1 1.7-2M22 15.5h8M14 23.5h16M14 29.5h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function rid() {
    const c = "abcdefghijklmnopqrstuvwxyz0123456789", a = crypto.getRandomValues(new Uint8Array(8));
    let s = "";
    for (const x of a) s += c[x % 36];
    return s;
  }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
    return n;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(`notes:${ag.instance}:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(`notes:${ag.instance}:${k}`, JSON.stringify(v)); } catch { /* storage off: kept for now only */ } },
  };
  const clean = (h) => window.DOMPurify.sanitize(h || "", { ALLOWED_TAGS: ["b", "i", "u", "s", "code", "a", "br"], ALLOWED_ATTR: ["href"] })
    .replace(/<(b|i|u|s|code)><\/\1>/g, "").replace(/^(<br>)+$/, "");
  const plainOf = (h) => { const t = document.createElement("template"); t.innerHTML = (h || "").replace(/<br>/g, "\n"); return t.content.textContent; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const now = () => Date.now() / 1000;

  // ---------------------------------------------------------------- the notebook, as this panel has it
  let book = { version: 0, pages: [] };
  const pages = new Map();
  const reindex = () => { pages.clear(); for (const p of book.pages) { p.blocks = p.blocks || []; pages.set(p.id, p); } };
  const live = () => book.pages.filter((p) => !p.deleted);
  const kidsOf = (id) => live().filter((p) => (p.parent || null) === id);
  function below(id) {                                   // a page's subpages, theirs, ...
    const out = [], todo = [id];
    while (todo.length) { const here = todo.pop(); for (const p of book.pages) if (p.parent === here && !out.includes(p)) { out.push(p); todo.push(p.id); } }
    return out;
  }
  function placeAt(blocks, after) {
    if (after === "") return 0;
    const i = after == null ? -1 : blocks.findIndex((b) => b.id === after);
    return i < 0 ? blocks.length : i + 1;
  }
  // An op applied to the notebook here: the same as the backend applies it (notebook.py's Notebook.apply).
  function apply(op) {
    const p = typeof op.page === "string" ? pages.get(op.page) : null;
    switch (op.op) {
      case "page.new": {
        if (pages.has(op.page.id)) return;
        const made = { title: "", icon: "", parent: null, ...op.page, blocks: (op.blocks || []).map((b) => ({ ...b })) };
        book.pages.push(made);
        pages.set(made.id, made);
        return;
      }
      case "page.set": if (p) for (const k of ["title", "icon", "parent"]) if (k in op) p[k] = op[k]; return;
      case "page.delete":
        for (const id of op.pages || [op.page]) { const q = pages.get(id); if (q) { q.deleted = op.at || now(); q.deleted_with = op.page; } }
        return;
      case "page.restore":
        for (const id of op.pages || [op.page]) { const q = pages.get(id); if (q) { delete q.deleted; delete q.deleted_with; } }
        if (p && "parent" in op) p.parent = op.parent;
        return;
      case "page.purge": {
        const gone = new Set(op.pages || [op.page]);
        book.pages = book.pages.filter((q) => !gone.has(q.id));
        for (const id of gone) pages.delete(id);
        return;
      }
      case "block.put": {
        if (!p) return;
        const b = p.blocks.find((x) => x.id === op.block.id);
        if (b) Object.assign(b, op.block);
        else p.blocks.splice(placeAt(p.blocks, op.after), 0, { type: "text", text: "", checked: false, indent: 0, ...op.block });
        return;
      }
      case "block.move": {
        if (!p) return;
        const i = p.blocks.findIndex((x) => x.id === op.block);
        if (i < 0) return;
        const [b] = p.blocks.splice(i, 1);
        p.blocks.splice(placeAt(p.blocks, op.after), 0, b);
        return;
      }
      case "block.delete": if (p) p.blocks = p.blocks.filter((x) => x.id !== op.block); return;
    }
  }

  // ---------------------------------------------------------------- sending, in order
  const queue = [];                                     // ops applied here, not yet taken by the backend
  const dirty = new Map();                              // block id -> {page, text, timer}: typed, not yet queued
  let titleDirty = null, sending = false, savedTimer = 0, status = "saved";
  let sideSoon = 0;
  function change(ops) {                                // applied here, and sent after what was typed before it
    flushTyped();
    for (const op of ops) apply(op);
    queue.push(...ops);
    pump();
    if (!sideSoon) sideSoon = requestAnimationFrame(() => { sideSoon = 0; drawSide(); });   // its to-dos counted again
  }
  function typed(page, id, text) {
    const d = dirty.get(id);
    if (d) clearTimeout(d.timer);
    dirty.set(id, { page, text, timer: setTimeout(() => sendTyped(id), 450) });
    saved("saving");
  }
  function sendTyped(id) {
    const d = dirty.get(id);
    if (!d) return;
    clearTimeout(d.timer);
    dirty.delete(id);
    queue.push({ op: "block.put", page: d.page, block: { id, text: d.text } });
    pump();
  }
  function forget(id) { const d = dirty.get(id); if (d) { clearTimeout(d.timer); dirty.delete(id); } }
  function flushTyped() {
    for (const id of [...dirty.keys()]) sendTyped(id);
    if (titleDirty) { clearTimeout(titleDirty.timer); queue.push({ op: "page.set", page: titleDirty.page, title: titleDirty.title }); titleDirty = null; }
  }
  async function pump(keepalive = false) {
    if (sending) return;
    if (!queue.length) { if (!dirty.size && !titleDirty && status !== "saved") saved("saved"); return; }
    sending = true;
    saved("saving");
    const ops = queue.splice(0, queue.length);
    let refused = null;
    try {
      const r = await ag.api("ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ by: ME, ops }), keepalive });
      if (r.status >= 400 && r.status < 500) refused = (await r.json().catch(() => ({}))).error || `refused (${r.status})`;
      else if (!r.ok) throw new Error(`${r.status}`);
    } catch {
      queue.unshift(...ops);                            // not reached: tried again, in the same order
      sending = false;
      saved("retry");
      setTimeout(() => pump(), 2500);
      return;
    }
    sending = false;
    if (refused) { console.error("notes: a change refused:", refused, ops); await resync(); }
    pump();
  }
  function saved(how) {
    const s = $("saved");
    status = how;
    clearTimeout(savedTimer);
    s.classList.remove("quiet", "bad");
    if (how === "saving") s.textContent = "Saving…";
    else if (how === "retry") { s.textContent = "Not saved yet: trying again"; s.classList.add("bad"); }
    else { s.textContent = "Saved"; savedTimer = setTimeout(() => s.classList.add("quiet"), 1400); }
  }
  addEventListener("pagehide", () => { flushTyped(); pump(true); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { flushTyped(); pump(true); } });

  // ---------------------------------------------------------------- what others change
  let ready = false;
  const early = [];
  ag.onMessage((m) => {
    if (!m || !Array.isArray(m.ops)) return;
    if (!ready) early.push(m);
    else heard(m);
  });
  function heard(m) {
    if (m.version <= book.version) return;
    const gap = m.version !== book.version + 1;          // a batch missed: everything read again, after these
    book.version = m.version;
    if (m.by !== ME) {
      const touched = new Set(), blocks = new Set();
      for (const op of m.ops) {
        apply(op);
        touched.add(typeof op.page === "string" ? op.page : op.page && op.page.id);
        if (op.op === "block.put") blocks.add(op.block.id);
        if (op.op === "block.move") blocks.add(op.block);
      }
      if (current && !pages.has(current)) current = null;
      drawSide(m.agent ? touched : null);
      if (current && touched.has(current)) drawPage(blocks);
      else if (!current) drawPage();
      if (m.agent) told(m.agent, [...touched].map((id) => pages.get(id)).filter(Boolean));
    }
    if (gap) resync();
  }
  let whoTimer = 0;
  function told(channel, changed) {
    const st = ag.agents.state(channel);
    const name = (st && st.name) || "An agent";
    const what = changed.length === 1 ? `“${changed[0].title || "Untitled"}”` : changed.length ? `${changed.length} pages` : "the notes";
    const w = $("who");
    w.textContent = `${name} changed ${what}`;
    w.style.opacity = "1";
    clearTimeout(whoTimer);
    whoTimer = setTimeout(() => { w.style.opacity = "0"; setTimeout(() => { if (w.style.opacity === "0") w.textContent = ""; }, 450); }, 6000);
  }
  async function resync() {
    let got;
    try { got = await (await ag.api("state")).json(); } catch { return; }
    if (!got || !Array.isArray(got.pages) || got.version < book.version) return;
    book = got;
    reindex();
    for (const op of queue) apply(op);                   // what this window has not sent yet stays as it has it
    for (const [id, d] of dirty) { const p = pages.get(d.page); const b = p && p.blocks.find((x) => x.id === id); if (b) b.text = d.text; }
    if (titleDirty && pages.get(titleDirty.page)) pages.get(titleDirty.page).title = titleDirty.title;
    if (current && !pages.has(current)) current = null;
    drawSide();
    drawPage();
  }

  // ---------------------------------------------------------------- the sidebar
  let current = null;
  const opened = new Set(store.get("open", []));
  let trashOpen = false;
  function drawSide(flash = null) {
    const tree = $("tree"), q = $("find").value.trim().toLowerCase();
    tree.replaceChildren();
    const row = (p, depth, flat = false) => {
      const kids = flat ? [] : kidsOf(p.id);
      const open = opened.has(p.id);
      const todos = p.blocks.filter((b) => b.type === "todo"), left = todos.filter((b) => !b.checked).length;
      const r = el("div", { class: `pg-row${p.id === current ? " on" : ""}`, role: "treeitem", "data-id": p.id, style: `--d:${depth}`,
        "aria-selected": String(p.id === current), ...(kids.length ? { "aria-expanded": String(open) } : {}),
        onclick: () => openPage(p.id) },
        el("button", { class: `caret${kids.length ? "" : " none"}${open ? " open" : ""}`, type: "button", tabindex: "-1",
          "aria-label": open ? "Fold" : "Unfold", html: SVG.caret,
          onclick: (ev) => { ev.stopPropagation(); fold(p.id, !open); } }),
        el("span", { class: "ic", ...(p.icon ? { text: p.icon } : { html: SVG.doc }) }),
        el("span", { class: `nm${p.title ? "" : " untitled"}`, text: p.title || "Untitled" }),
        left ? el("span", { class: "count", title: `${left} of ${todos.length} to-dos open`, text: String(left) }) : null,
        el("span", { class: "acts" },
          el("button", { type: "button", title: "Add a page inside", "aria-label": "Add a page inside", html: SVG.plus,
            onclick: (ev) => { ev.stopPropagation(); newPage(p.id); } }),
          el("button", { type: "button", title: "More", "aria-label": "More", html: SVG.more,
            onclick: (ev) => { ev.stopPropagation(); pageMenu(p, ev.currentTarget); } })));
      if (flash && flash.has(p.id)) r.classList.add("flash");
      tree.append(r);
      if (open) for (const k of kids) row(k, depth + 1);
    };
    if (q) {
      const hits = live().filter((p) => (p.title || "").toLowerCase().includes(q) || p.blocks.some((b) => plainOf(b.text).toLowerCase().includes(q)));
      for (const p of hits) row(p, 0, true);
      if (!hits.length) tree.append(el("div", { class: "tree-none", text: "No page has that" }));
    } else {
      for (const p of kidsOf(null)) row(p, 0);
      if (!live().length) tree.append(el("div", { class: "tree-none", text: "No pages yet" }));
    }
    const binned = book.pages.filter((p) => p.deleted && p.deleted_with === p.id);
    $("trash-btn").replaceChildren(el("span", { html: SVG.trash }), el("span", { text: "Trash" }),
      binned.length ? el("span", { class: "n", text: String(binned.length) }) : "");
    $("trash-btn").setAttribute("aria-expanded", String(trashOpen));
    const trash = $("trash");
    trash.hidden = !trashOpen;
    trash.replaceChildren(...(binned.length ? binned.map((p) => el("div", { class: "trash-row" },
      el("span", { class: "nm", text: `${p.icon ? p.icon + " " : ""}${p.title || "Untitled"}`, title: "Open it", onclick: () => openPage(p.id) }),
      el("button", { type: "button", title: "Restore", "aria-label": "Restore", html: SVG.restore, onclick: () => restore(p) }),
      el("button", { type: "button", title: "Delete for good", "aria-label": "Delete for good", html: SVG.x, onclick: () => purge(p) })))
      : [el("div", { class: "trash-none", text: "Nothing in the trash" })]));
  }
  function fold(id, open) {
    if (open) opened.add(id); else opened.delete(id);
    store.set("open", [...opened]);
    drawSide();
  }
  $("find").addEventListener("input", () => drawSide());
  $("trash-btn").addEventListener("click", () => { trashOpen = !trashOpen; drawSide(); });
  $("new-page").innerHTML = SVG.plus;
  $("new-page").addEventListener("click", () => newPage(null));
  $("empty-new").addEventListener("click", () => newPage(null));
  document.querySelector(".empty-mark").innerHTML = SVG.book;
  $("side-toggle").innerHTML = SVG.side;
  const narrow = () => matchMedia("(max-width: 600px)").matches;
  const app = $("app");
  document.querySelector(".main").addEventListener("mousedown", (ev) => { if (!ev.target.closest("#side-toggle")) app.classList.remove("side-on"); });
  if (store.get("side", true) === false) app.classList.add("side-off");
  $("side-toggle").addEventListener("click", () => {
    if (narrow()) return app.classList.toggle("side-on");
    app.classList.toggle("side-off");
    store.set("side", !app.classList.contains("side-off"));
  });

  function newPage(parent) {
    const p = { id: rid(), title: "", icon: "", parent };
    change([{ op: "page.new", page: p, blocks: [{ id: rid(), type: "text", text: "", checked: false, indent: 0 }] }]);
    if (parent) { opened.add(parent); store.set("open", [...opened]); }
    openPage(p.id);
    $("title").focus();
  }
  function trashPage(p) {
    const gone = [p, ...below(p.id).filter((q) => !q.deleted)];
    change([{ op: "page.delete", page: p.id, at: now(), pages: gone.map((q) => q.id) }]);
    if (gone.some((q) => q.id === current)) {
      const up = p.parent && pages.get(p.parent);
      current = up && !up.deleted ? up.id : (kidsOf(null)[0] || {}).id || null;
    }
    drawSide();
    drawPage();
  }
  function restore(p) {
    const back = book.pages.filter((q) => q.deleted && q.deleted_with === p.deleted_with && (q === p || below(p.id).includes(q)));
    const up = p.parent && pages.get(p.parent);
    change([{ op: "page.restore", page: p.id, pages: back.map((q) => q.id), parent: up && !up.deleted ? p.parent : null }]);
    drawSide();
    drawPage();
  }
  function purge(p) {
    change([{ op: "page.purge", page: p.id, pages: [p.id, ...below(p.id).map((q) => q.id)] }]);
    if (!pages.has(current)) current = (kidsOf(null)[0] || {}).id || null;
    drawSide();
    drawPage();
  }
  function pageMenu(p, button) {
    const row = button.closest(".pg-row");
    row.classList.add("menu-open");
    popUp(button.getBoundingClientRect(), (box) => {
      box.append(
        item({ glyph: SVG.plus, sm: true, label: "Add a page inside" }, () => newPage(p.id)),
        item({ glyph: SVG.trash, sm: true, label: "Move to trash", bad: true }, () => trashPage(p)));
    }, () => row.classList.remove("menu-open"));
  }

  // ---------------------------------------------------------------- the page
  function openPage(id) {
    flushTyped();
    pump();
    current = id;
    store.set("page", id);
    for (let p = pages.get(id); p && p.parent; p = pages.get(p.parent)) opened.add(p.parent);
    if (narrow()) app.classList.remove("side-on");
    drawSide();
    drawPage();
    $("scroll").scrollTop = 0;
  }
  function drawPage(flash = null) {
    const p = current && pages.get(current);
    const none = !live().length && !p;
    $("empty").hidden = !none;
    $("page").hidden = !p;
    $("banner").hidden = !(p && p.deleted);
    drawCrumbs(p);
    if (!p) { $("blocks").replaceChildren(); return; }
    const ro = !!p.deleted;
    $("page").classList.toggle("ro", ro);
    if (ro) $("banner").replaceChildren(el("span", { text: "This page is in the trash." }),
      el("button", { type: "button", text: "Restore", onclick: () => restore(pages.get(p.deleted_with) || p) }),
      el("button", { type: "button", text: "Delete for good", onclick: () => purge(pages.get(p.deleted_with) || p) }));
    const title = $("title");
    title.setAttribute("contenteditable", ro ? "false" : "plaintext-only");
    if (document.activeElement !== title && title.textContent !== (p.title || "")) title.textContent = p.title || "";
    $("icon").hidden = !p.icon;
    $("icon").textContent = p.icon || "";
    $("add-icon").hidden = !!p.icon || ro;
    drawBlocks(p, flash, ro);
  }
  function drawCrumbs(p) {
    const trail = [];
    for (let q = p; q; q = q.parent ? pages.get(q.parent) : null) trail.unshift(q);
    const c = $("crumbs");
    c.replaceChildren();
    trail.forEach((q, i) => {
      if (i) c.append(el("span", { class: "sep", text: "/" }));
      c.append(el("button", { type: "button", text: `${q.icon ? q.icon + " " : ""}${q.title || "Untitled"}`, onclick: () => openPage(q.id) }));
    });
  }
  const box = $("blocks");
  const rowOf = (id) => box.querySelector(`.blk[data-id="${CSS.escape(id)}"]`);
  const page = () => current && pages.get(current);
  const blockOf = (id) => { const p = page(); return p && p.blocks.find((b) => b.id === id); };
  function makeRow(b) {
    const gut = el("div", { class: "gut" },
      el("button", { class: "add", type: "button", tabindex: "-1", title: "Add a block below", "aria-label": "Add a block below", html: SVG.plus }),
      el("button", { class: "grip", type: "button", tabindex: "-1", title: "Drag to move, click for more", "aria-label": "Move, or more", html: SVG.grip }));
    const n = el("div", { class: "blk", "data-id": b.id }, gut);
    if (b.type === "divider") n.append(el("div", { class: "hr", tabindex: "0", role: "separator" }));
    else n.append(el("div", { class: "mk" }), el("div", { class: "tx", spellcheck: "true" }));
    return n;
  }
  function updateRow(n, b, ro) {
    n.dataset.type = b.type;
    n.style.setProperty("--ind", b.indent || 0);
    n.classList.toggle("done", b.type === "todo" && !!b.checked);
    const tx = n.querySelector(".tx");
    if (!tx) return;
    tx.setAttribute("contenteditable", ro ? "false" : b.type === "code" ? "plaintext-only" : "true");
    tx.dataset.ph = PH[b.type] || "";
    if (tx !== document.activeElement && !dirty.has(b.id)) {
      if (b.type === "code") { if (tx.textContent !== b.text) tx.textContent = b.text; }
      else { const h = clean(b.text); if (tx.innerHTML !== h) tx.innerHTML = h; }
    }
    const mk = n.querySelector(".mk");
    const want = b.type === "todo" ? `todo:${!!b.checked}` : b.type === "bullet" ? `bullet:${(b.indent || 0) % 3}` : b.type;
    if (mk.dataset.is !== want) {
      mk.dataset.is = want;
      mk.replaceChildren();
      if (b.type === "todo") mk.append(el("button", { class: "chk", type: "button", role: "checkbox", tabindex: "-1",
        "aria-checked": String(!!b.checked), "aria-label": b.checked ? "Done" : "To do", html: SVG.check }));
      else if (b.type === "bullet") mk.append(el("span", { class: `dot d${(b.indent || 0) % 3}` }));
    }
  }
  // The page's blocks drawn as the notebook has them: rows kept, moved, made or removed, but the one typed in left
  // as the reader has it (it is theirs until it is sent).
  function drawBlocks(p, flash, ro) {
    const have = new Map([...box.children].map((n) => [n.dataset.id, n]));
    const want = new Set(p.blocks.map((b) => b.id));
    const focus = document.activeElement && box.contains(document.activeElement) ? document.activeElement : null;
    const at = focus && focus.classList.contains("tx") ? caretIn(focus) : null;
    for (const [id, n] of have) if (!want.has(id)) n.remove();
    let prev = null;
    for (const b of p.blocks) {
      let n = have.get(b.id);
      if (n && (n.dataset.type === "divider") !== (b.type === "divider")) { n.remove(); n = null; }
      if (!n) n = makeRow(b);
      updateRow(n, b, ro);
      const there = prev ? prev.nextSibling : box.firstChild;
      if (n !== there) box.insertBefore(n, there);
      prev = n;
      if (flash && flash.has(b.id)) { n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash"); }
    }
    numbers(p);
    if (focus && focus.isConnected && document.activeElement !== focus) {
      focus.focus();
      if (at) setCaret(focus, at.start, at.end);
    }
  }
  function numbers(p) {
    const counts = new Map();
    for (const b of p.blocks) {
      const k = b.indent || 0;
      for (const d of [...counts.keys()]) if (d > k) counts.delete(d);
      if (b.type !== "number") { counts.delete(k); continue; }
      counts.set(k, (counts.get(k) || 0) + 1);
      const mk = rowOf(b.id) && rowOf(b.id).querySelector(".mk");
      if (mk) mk.textContent = `${counts.get(k)}.`;
    }
  }
  box.addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));
  $("tree").addEventListener("animationend", (ev) => ev.target.classList.remove("flash"));

  // ---------------------------------------------------------------- the caret
  function caretIn(tx) {
    const s = getSelection();
    if (!s.rangeCount) return null;
    const r = s.getRangeAt(0);
    if (!tx.contains(r.startContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(tx);
    pre.setEnd(r.startContainer, r.startOffset);
    const start = pre.toString().length;
    pre.setEnd(r.endContainer, r.endOffset);
    return { start, end: pre.toString().length, collapsed: r.collapsed };
  }
  function pointAt(tx, n) {
    const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT);
    let node, last = null;
    while ((node = w.nextNode())) { if (n <= node.length) return { node, offset: n }; n -= node.length; last = node; }
    return last ? { node: last, offset: last.length } : { node: tx, offset: tx.childNodes.length };
  }
  function setCaret(tx, start, end = start) {
    const a = pointAt(tx, start), z = pointAt(tx, end), r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }
  function edge(tx, atEnd) {                              // nothing (no text, no line break) between the caret and an end
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const r = s.getRangeAt(0), part = document.createRange();
    part.selectNodeContents(tx);
    if (atEnd) part.setStart(r.endContainer, r.endOffset); else part.setEnd(r.startContainer, r.startOffset);
    const f = part.cloneContents();
    return f.textContent === "" && !f.querySelector("br");
  }
  function onLine(tx, last) {                             // the caret on the first (or last) line of the block
    const s = getSelection();
    if (!s.rangeCount) return true;
    const rects = s.getRangeAt(0).getClientRects();
    const r = rects[last ? rects.length - 1 : 0];
    if (!r) return true;
    const t = tx.getBoundingClientRect(), lh = parseFloat(getComputedStyle(tx).lineHeight) || 22;
    return last ? t.bottom - r.bottom < lh * 0.9 : r.top - t.top < lh * 0.9;
  }
  function focusBlock(id, where = "end") {
    const n = rowOf(id);
    if (!n) return;
    const tx = n.querySelector(".tx");
    if (!tx) return n.querySelector(".hr").focus();
    tx.focus();
    const len = tx.textContent.length;
    setCaret(tx, where === "end" ? len : where === "start" ? 0 : Math.min(where, len));
  }
  const empty = (tx) => tx.textContent === "" && !tx.querySelector("br");
  const textOf = (n, b) => (b.type === "code" ? n.querySelector(".tx").textContent : clean(n.querySelector(".tx").innerHTML));
  const editable = (b) => b.type !== "divider";

  // ---------------------------------------------------------------- typing
  box.addEventListener("input", (ev) => {
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    if (!b) return;
    if (tx.innerHTML === "<br>") tx.innerHTML = "";
    if (shortcut(n, tx, b, ev)) return;
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
    slashInput(n, tx, b, ev);
  });
  box.addEventListener("focusout", (ev) => {
    const n = ev.target.closest && ev.target.closest(".blk");
    if (n && dirty.has(n.dataset.id)) sendTyped(n.dataset.id);
    if (menu && menu.kind === "slash" && ev.target === menu.tx) closePop();
  });
  // Markdown at the start of a block, as it is typed: "# " a heading, "- " a list, "[] " a to-do, "> " a quote, "```" code,
  // "---" a divider.
  const SHORT = [[/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"],
    [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", true], [/^>\s$/, "quote"]];
  function shortcut(n, tx, b, ev) {
    if (ev.inputType !== "insertText" || !["text", "bullet"].includes(b.type)) return false;
    const c = caretIn(tx);
    if (!c || !c.collapsed) return false;
    const before = tx.textContent.slice(0, c.start);
    let to = null, checked = false;
    if (ev.data === " ") { const hit = SHORT.find(([rx]) => rx.test(before)); if (hit) { to = hit[1]; checked = !!hit[2]; } }
    else if (ev.data === "`" && before === "```") to = "code";
    else if (ev.data === "-" && tx.textContent === "---") to = "divider";
    if (!to || (b.type === "bullet" && to !== "todo")) return false;
    const r = document.createRange(), a = pointAt(tx, 0), z = pointAt(tx, before.length);
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    r.deleteContents();
    if (to === "divider") {
      forget(b.id);
      const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
      change([{ op: "block.put", page: current, block: { id: b.id, type: "divider", text: "", indent: 0 } },
        { op: "block.put", page: current, block: next, after: b.id }]);
      drawPage();
      focusBlock(next.id, 0);
      return true;
    }
    if (to === "code") tx.textContent = plainOf(clean(tx.innerHTML));
    retype(b, to, { checked, text: to === "code" ? tx.textContent : clean(tx.innerHTML) });
    focusBlock(b.id, 0);
    return true;
  }
  // A block made another type: its text kept (plain, into code; out of code, as text), its indent where it may have one.
  function retype(b, type, extra = {}) {
    const was = b.type;
    let text = "text" in extra ? extra.text : b.text;
    if (!("text" in extra)) {
      if (type === "code" && was !== "code") text = plainOf(b.text);
      else if (was === "code" && type !== "code") text = esc(b.text).replace(/\n/g, "<br>");
    }
    forget(b.id);
    const put = { id: b.id, type, text, indent: INDENTED.includes(type) ? b.indent || 0 : 0, checked: type === "todo" ? !!(extra.checked ?? b.checked) : false };
    change([{ op: "block.put", page: current, block: put }]);
    const tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx");
    if (tx && (type === "code" || was === "code") && document.activeElement === tx) {
      if (type === "code") tx.textContent = text; else tx.innerHTML = clean(text);
    }
    drawPage();
  }

  box.addEventListener("keydown", (ev) => {
    if (ev.isComposing) return;
    const hr = ev.target.closest && ev.target.closest(".hr");
    if (hr) return dividerKey(ev, hr.closest(".blk"));
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    const n = tx.closest(".blk"), p = page(), i = p ? p.blocks.findIndex((b) => b.id === n.dataset.id) : -1;
    if (i < 0 || p.deleted) return;
    const b = p.blocks[i];
    if (menu && menu.kind === "slash" && slashKey(ev)) return;
    const mod = ev.metaKey || ev.ctrlKey, k = ev.key;
    if (mod && !ev.altKey) {
      const low = k.toLowerCase();
      if (b.type !== "code" && !ev.shiftKey && low === "b") return format(ev, n, "bold");
      if (b.type !== "code" && !ev.shiftKey && low === "i") return format(ev, n, "italic");
      if (b.type !== "code" && !ev.shiftKey && low === "u") return format(ev, n, "underline");
      if (b.type !== "code" && ev.shiftKey && (low === "s" || low === "x")) return format(ev, n, "strikeThrough");
      if (b.type !== "code" && !ev.shiftKey && low === "e") { ev.preventDefault(); return codeMark(n, tx); }
      if (b.type !== "code" && !ev.shiftKey && low === "k") { ev.preventDefault(); return linkBox(n, tx); }
      if (ev.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { ev.preventDefault(); return shift(p, i, k === "ArrowUp" ? -1 : 1); }
      if (k === "Enter") {
        ev.preventDefault();
        if (b.type === "todo") return tick(b);
        return addAfter(b, "text");
      }
      return;
    }
    if (k === "Enter" && !ev.shiftKey) {
      if (b.type === "code") return;                      // a new line of code
      ev.preventDefault();
      return enter(p, i, n, tx);
    }
    if (k === "Enter" && ev.shiftKey && b.type === "code") { ev.preventDefault(); return addAfter(b, "text"); }
    if (k === "Backspace" && edge(tx, false)) { ev.preventDefault(); return backspace(p, i, n, tx); }
    if (k === "Delete" && edge(tx, true) && i + 1 < p.blocks.length) { ev.preventDefault(); return joinNext(p, i, n, tx); }
    if (k === "Tab") {
      ev.preventDefault();
      if (b.type === "code" && !ev.shiftKey) document.execCommand("insertText", false, "\t");
      else if (INDENTED.includes(b.type)) indent(b, ev.shiftKey ? -1 : 1);
      return;
    }
    if ((k === "ArrowUp" && onLine(tx, false)) || (k === "ArrowLeft" && edge(tx, false))) {
      const prev = p.blocks.slice(0, i).reverse().find(editable);
      ev.preventDefault();
      if (prev) focusBlock(prev.id, "end");
      else { $("title").focus(); setCaret($("title"), $("title").textContent.length); }
      return;
    }
    if ((k === "ArrowDown" && onLine(tx, true)) || (k === "ArrowRight" && edge(tx, true))) {
      const next = p.blocks.slice(i + 1).find(editable);
      if (next) { ev.preventDefault(); focusBlock(next.id, "start"); }
    }
  });
  function dividerKey(ev, n) {
    const p = page(), i = p.blocks.findIndex((b) => b.id === n.dataset.id);
    if (ev.key === "Backspace" || ev.key === "Delete") {
      ev.preventDefault();
      const near = p.blocks[i - 1] || p.blocks[i + 1];
      change([{ op: "block.delete", page: p.id, block: n.dataset.id }]);
      drawPage();
      if (near) focusBlock(near.id, "end");
    } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const to = ev.key === "ArrowUp" ? p.blocks[i - 1] : p.blocks[i + 1];
      if (to) { ev.preventDefault(); focusBlock(to.id, ev.key === "ArrowUp" ? "end" : "start"); }
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      addAfter(p.blocks[i], "text");
    }
  }
  // Enter: an empty list item leaves the list (or comes out a level); at the start of a block, an empty one goes above
  // it; else the block is split at the caret, its rest a new block below -- a list's next item, or text.
  function enter(p, i, n, tx) {
    const b = p.blocks[i];
    if ([...LISTS, "quote"].includes(b.type) && empty(tx)) {
      if (b.indent > 0 && b.type !== "quote") return indent(b, -1);
      return retype(b, "text");
    }
    const kind = LISTS.includes(b.type) ? b.type : "text";
    const ind = INDENTED.includes(b.type) ? b.indent || 0 : 0;
    if (edge(tx, false) && !empty(tx)) {
      const above = { id: rid(), type: kind, text: "", checked: false, indent: ind };
      change([{ op: "block.put", page: p.id, block: above, after: i ? p.blocks[i - 1].id : "" }]);
      drawPage();
      return;
    }
    const s = getSelection(), r = s.getRangeAt(0);
    r.deleteContents();
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    tail.setEnd(tx, tx.childNodes.length);
    const hold = document.createElement("div");
    hold.append(tail.extractContents());
    const rest = clean(hold.innerHTML), left = clean(tx.innerHTML);
    if (tx.innerHTML !== left) tx.innerHTML = left;
    const next = { id: rid(), type: kind, text: rest, checked: false, indent: ind };
    forget(b.id);
    change([{ op: "block.put", page: p.id, block: { id: b.id, text: left } }, { op: "block.put", page: p.id, block: next, after: b.id }]);
    drawPage();
    focusBlock(next.id, "start");
  }
  // Backspace at a block's start: a heading, list item or the like made text; text set in, out a level; else joined to
  // the block above (a divider above, removed).
  function backspace(p, i, n, tx) {
    const b = p.blocks[i];
    if (b.type !== "text") return retype(b, "text");
    if (b.indent > 0) return indent(b, -1);
    if (!i) return;
    const prev = p.blocks[i - 1];
    if (prev.type === "divider") {
      change([{ op: "block.delete", page: p.id, block: prev.id }]);
      drawPage();
      return focusBlock(b.id, "start");
    }
    const at = prev.type === "code" ? prev.text.length : plainOf(prev.text).length;
    const joined = prev.type === "code" ? prev.text + tx.textContent : clean(prev.text + clean(tx.innerHTML));
    forget(b.id);
    forget(prev.id);
    change([{ op: "block.put", page: p.id, block: { id: prev.id, text: joined } }, { op: "block.delete", page: p.id, block: b.id }]);
    drawPage();
    const ptx = rowOf(prev.id) && rowOf(prev.id).querySelector(".tx");
    if (ptx) { ptx.focus(); setCaret(ptx, at); }
  }
  function joinNext(p, i, n, tx) {
    const b = p.blocks[i], next = p.blocks[i + 1];
    if (next.type === "divider") { change([{ op: "block.delete", page: p.id, block: next.id }]); drawPage(); return; }
    const at = tx.textContent.length;
    const joined = b.type === "code" ? tx.textContent + plainOf(next.text) : clean(clean(tx.innerHTML) + (next.type === "code" ? esc(next.text) : next.text));
    forget(b.id);
    forget(next.id);
    if (b.type === "code") tx.textContent = joined; else tx.innerHTML = joined;
    change([{ op: "block.put", page: p.id, block: { id: b.id, text: joined } }, { op: "block.delete", page: p.id, block: next.id }]);
    drawPage();
    setCaret(tx, at);
  }
  function indent(b, by) {
    const to = Math.max(0, Math.min(MAX_INDENT, (b.indent || 0) + by));
    if (to === (b.indent || 0)) return;
    const tx = rowOf(b.id) && rowOf(b.id).querySelector(".tx"), at = tx && caretIn(tx);
    change([{ op: "block.put", page: current, block: { id: b.id, indent: to } }]);
    drawPage();
    if (tx && at) { tx.focus(); setCaret(tx, at.start, at.end); }
  }
  function tick(b) {
    change([{ op: "block.put", page: current, block: { id: b.id, checked: !b.checked } }]);
    drawPage();
  }
  function addAfter(b, type) {
    const next = { id: rid(), type, text: "", checked: false, indent: LISTS.includes(type) && INDENTED.includes(b.type) ? b.indent || 0 : 0 };
    change([{ op: "block.put", page: current, block: next, after: b.id }]);
    drawPage();
    focusBlock(next.id, 0);
    return next;
  }
  function shift(p, i, by) {
    const j = i + by;
    if (j < 0 || j >= p.blocks.length) return;
    const b = p.blocks[i], tx = rowOf(b.id).querySelector(".tx"), at = tx && caretIn(tx);
    const rest = p.blocks.filter((x) => x.id !== b.id);
    const after = by < 0 ? (j ? rest[j - 1].id : "") : rest[i].id;
    change([{ op: "block.move", page: p.id, block: b.id, after }]);
    drawPage();
    if (tx) { tx.focus(); if (at) setCaret(tx, at.start, at.end); }
  }

  // inline marks: bold, italic, underline, struck (the browser's), code and links (here)
  function format(ev, n, command) {
    ev.preventDefault();
    document.execCommand(command, false);
  }
  function codeMark(n, tx) {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return;
    const r = s.getRangeAt(0);
    const start = r.commonAncestorContainer;
    const inCode = (start.nodeType === 3 ? start.parentElement : start).closest("code");
    if (inCode && tx.contains(inCode)) inCode.replaceWith(...inCode.childNodes);
    else {
      const code = document.createElement("code");
      code.append(r.extractContents());
      for (const c of code.querySelectorAll("code")) c.replaceWith(...c.childNodes);
      r.insertNode(code);
      const pick = document.createRange();
      pick.selectNodeContents(code);
      s.removeAllRanges();
      s.addRange(pick);
    }
    const b = blockOf(n.dataset.id);
    b.text = textOf(n, b);
    typed(current, b.id, b.text);
  }
  function linkBox(n, tx) {
    const s = getSelection();
    if (!s.rangeCount) return;
    const kept = s.getRangeAt(0).cloneRange();
    const a0 = (kept.startContainer.nodeType === 3 ? kept.startContainer.parentElement : kept.startContainer).closest("a");
    const rect = kept.getBoundingClientRect().width ? kept.getBoundingClientRect() : tx.getBoundingClientRect();
    popUp(rect, (pop) => {
      const input = el("input", { type: "url", placeholder: "Paste a link", value: a0 ? a0.getAttribute("href") : "" });
      const done = (url) => {
        closePop();
        tx.focus();
        s.removeAllRanges();
        s.addRange(kept);
        if (!url) document.execCommand("unlink", false);
        else {
          const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
          if (kept.collapsed && !a0) document.execCommand("insertHTML", false, `<a href="${esc(href).replace(/"/g, "&quot;")}">${esc(url)}</a>`);
          else document.execCommand("createLink", false, href);
        }
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); done(input.value.trim()); }
        else if (e.key === "Escape") { e.preventDefault(); closePop(); tx.focus(); s.removeAllRanges(); s.addRange(kept); }
      });
      pop.append(el("div", { class: "row" }, input, el("button", { type: "button", text: a0 ? "Remove" : "Link",
        onclick: () => done(a0 ? "" : input.value.trim()) })));
      setTimeout(() => input.focus(), 0);
    });
  }

  // ---------------------------------------------------------------- the / menu, and the other pop-ups
  let menu = null;                                         // {kind, el, items?, on?, tx?, from?, done?}
  function popUp(rect, fill, done, kind = "menu", cls = "") {
    closePop();
    const pop = $("pop");
    pop.className = `pop ${cls}`;
    pop.replaceChildren();
    pop.hidden = false;
    menu = { kind, el: pop, done };
    fill(pop);
    place(pop, rect);
    return menu;
  }
  function place(pop, rect) {
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = Math.min(rect.left, innerWidth - w - 8), y = rect.bottom + 6;
    if (y + h > innerHeight - 8 && rect.top - h - 6 > 8) y = rect.top - h - 6;
    pop.style.left = `${Math.max(8, x)}px`;
    pop.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  }
  function closePop() {
    if (!menu) return;
    const m = menu;
    menu = null;
    $("pop").hidden = true;
    if (m.done) m.done();
  }
  function item(k, run) {
    const b = el("button", { class: `it${k.cur ? " cur" : ""}${k.bad ? " bad" : ""}`, type: "button", role: "menuitem",
      onmousedown: (ev) => ev.preventDefault(), onclick: () => { closePop(); run(); } },
      el("span", { class: `gl${k.sm ? " sm" : ""}`, ...(k.glyph && k.glyph.startsWith("<svg") ? { html: k.glyph } : { text: k.glyph || "" }) }),
      el("span", { class: "tt" }, el("span", { text: k.label }), k.note ? el("small", { text: k.note }) : null));
    return b;
  }
  document.addEventListener("mousedown", (ev) => { if (menu && !menu.el.contains(ev.target)) closePop(); }, true);
  document.addEventListener("keydown", (ev) => { if (menu && ev.key === "Escape" && menu.kind !== "slash") { ev.preventDefault(); closePop(); } });
  $("scroll").addEventListener("scroll", () => { if (menu && menu.kind !== "slash") closePop(); });

  function slashInput(n, tx, b, ev) {
    if (menu && menu.kind === "slash") {
      const c = caretIn(tx);
      if (menu.tx !== tx || !c || c.start <= menu.from || tx.textContent[menu.from] !== "/") return closePop();
      const q = tx.textContent.slice(menu.from + 1, c.start);
      if (q.length > 24 || /\s\s/.test(q)) return closePop();
      return drawSlash(q);
    }
    if (ev.inputType !== "insertText" || ev.data !== "/" || b.type === "code") return;
    const c = caretIn(tx);
    if (!c) return;
    const before = tx.textContent.slice(0, c.start - 1);
    if (before && !/\s$/.test(before)) return;
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    const rect = r.width || r.height ? r : tx.getBoundingClientRect();
    popUp(rect, () => {}, null, "slash");
    Object.assign(menu, { tx, from: c.start - 1, block: b.id, rect });
    drawSlash("");
  }
  function drawSlash(q) {
    const words = q.trim().toLowerCase();
    const items = KINDS.filter((k) => !words || k.label.toLowerCase().includes(words) || k.words.includes(words));
    menu.items = items;
    menu.on = Math.min(menu.on || 0, Math.max(0, items.length - 1));
    const pop = menu.el;
    pop.replaceChildren(el("div", { class: "hd", text: "Blocks" }));
    if (!items.length) pop.append(el("div", { class: "none", text: "No block like that" }));
    items.forEach((k, j) => {
      const it = item(k, () => slashPick(k.type));
      if (j === menu.on) it.classList.add("on");
      it.addEventListener("mousemove", () => { if (menu.on !== j) { menu.on = j; drawSlash(q); } });
      pop.append(it);
    });
    place(pop, menu.rect);
    const on = pop.querySelector(".it.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function slashKey(ev) {
    const n = menu.items ? menu.items.length : 0;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      if (n) { menu.on = (menu.on + (ev.key === "ArrowDown" ? 1 : n - 1)) % n; drawSlash(menu.tx.textContent.slice(menu.from + 1, caretIn(menu.tx).start)); }
      return true;
    }
    if ((ev.key === "Enter" || ev.key === "Tab") && n) { ev.preventDefault(); slashPick(menu.items[menu.on].type); return true; }
    if (ev.key === "Escape") { ev.preventDefault(); closePop(); return true; }
    return false;
  }
  // A block type picked from the / menu: the "/..." typed taken out, and the block made that type -- or, if it holds
  // other words, a new block of it below.
  function slashPick(type) {
    const m = menu;
    closePop();
    if (!m || !m.tx || !m.tx.isConnected) return;
    const tx = m.tx, n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    const c = caretIn(tx) || { start: m.from + 1 };
    const r = document.createRange(), a = pointAt(tx, m.from), z = pointAt(tx, Math.max(c.start, m.from + 1));
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    r.deleteContents();
    if (tx.innerHTML === "<br>") tx.innerHTML = "";
    b.text = textOf(n, b);
    tx.focus();
    setCaret(tx, m.from);
    if (type === "divider") {
      forget(b.id);
      const next = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
      if (empty(tx)) change([{ op: "block.put", page: current, block: { id: b.id, type: "divider", text: "", indent: 0 } },
        { op: "block.put", page: current, block: next, after: b.id }]);
      else {
        const line = { id: rid(), type: "divider", text: "", checked: false, indent: 0 };
        change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } },
          { op: "block.put", page: current, block: line, after: b.id },
          { op: "block.put", page: current, block: next, after: line.id }]);
      }
      drawPage();
      return focusBlock(next.id, 0);
    }
    if (empty(tx)) { retype(b, type, { text: "" }); return focusBlock(b.id, 0); }
    forget(b.id);
    change([{ op: "block.put", page: current, block: { id: b.id, text: b.text } }]);
    addAfter(b, type);
  }

  // ---------------------------------------------------------------- the gutter: + and the grip (drag, or its menu)
  box.addEventListener("click", (ev) => {
    const add = ev.target.closest(".gut .add");
    if (add) {
      const b = blockOf(add.closest(".blk").dataset.id);
      if (!b || page().deleted) return;
      addAfter(b, "text");
      document.execCommand("insertText", false, "/");      // the / menu, opened as typing "/" opens it
      return;
    }
    const chk = ev.target.closest(".chk");
    if (chk) {
      const b = blockOf(chk.closest(".blk").dataset.id);
      if (b && !page().deleted) tick(b);
      return;
    }
    const a = ev.target.closest(".tx a");
    if (a && (ev.metaKey || ev.ctrlKey || page().deleted)) { ev.preventDefault(); window.open(a.href, "_blank", "noopener"); }
  });
  box.addEventListener("mousedown", (ev) => { if (ev.target.closest(".chk, .gut .add")) ev.preventDefault(); });
  let drag = null;
  box.addEventListener("pointerdown", (ev) => {
    const grip = ev.target.closest(".gut .grip");
    if (!grip || ev.button !== 0 || page().deleted) return;
    ev.preventDefault();
    drag = { row: grip.closest(".blk"), y: ev.clientY, moved: false, before: undefined };
    grip.setPointerCapture(ev.pointerId);
  });
  box.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientY - drag.y) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.row.classList.add("dragging"); document.body.classList.add("dragging"); }
    const rows = [...box.children].filter((r) => r !== drag.row);
    drag.before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; }) || null;
    const line = $("drop"), at = drag.before ? drag.before.getBoundingClientRect() : (rows[rows.length - 1] || drag.row).getBoundingClientRect();
    const left = box.getBoundingClientRect();
    line.hidden = false;
    Object.assign(line.style, { left: `${left.left}px`, width: `${left.width}px`, top: `${(drag.before ? at.top : at.bottom) - 2}px` });
    const sc = $("scroll").getBoundingClientRect();
    if (ev.clientY < sc.top + 30) $("scroll").scrollTop -= 12;
    else if (ev.clientY > sc.bottom - 30) $("scroll").scrollTop += 12;
  });
  const endDrag = (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    $("drop").hidden = true;
    d.row.classList.remove("dragging");
    document.body.classList.remove("dragging");
    if (ev.type === "pointercancel") return;
    if (!d.moved) return blockMenu(d.row);
    const rows = [...box.children].filter((r) => r !== d.row);
    const at = d.before ? rows.indexOf(d.before) : rows.length;
    const after = at > 0 ? rows[at - 1].dataset.id : "";
    const p = page(), i = p.blocks.findIndex((b) => b.id === d.row.dataset.id);
    if ((after === "" && i === 0) || (i > 0 && p.blocks[i - 1].id === after)) return;
    change([{ op: "block.move", page: p.id, block: d.row.dataset.id, after }]);
    drawPage();
  };
  box.addEventListener("pointerup", endDrag);
  box.addEventListener("pointercancel", endDrag);
  function blockMenu(n) {
    const b = blockOf(n.dataset.id);
    if (!b) return;
    n.classList.add("menu-open");
    popUp(n.querySelector(".grip").getBoundingClientRect(), (pop) => {
      pop.append(el("div", { class: "hd", text: "Turn into" }));
      for (const k of KINDS) if (k.type !== "divider" || b.type === "divider")
        pop.append(item({ ...k, note: "", sm: true, cur: k.type === b.type }, () => { if (k.type !== b.type) { retype(b, k.type); focusBlock(b.id); } }));
      pop.append(el("div", { class: "sep" }),
        item({ glyph: "⧉", sm: true, label: "Duplicate" }, () => {
          const copy = { ...b, id: rid() };
          change([{ op: "block.put", page: current, block: copy, after: b.id }]);
          drawPage();
          focusBlock(copy.id);
        }),
        item({ glyph: SVG.trash, sm: true, label: "Delete", bad: true }, () => {
          const p = page(), i = p.blocks.indexOf(b), near = p.blocks[i - 1] || p.blocks[i + 1];
          forget(b.id);
          change([{ op: "block.delete", page: current, block: b.id }]);
          drawPage();
          if (near) focusBlock(near.id);
        }));
    }, () => n.classList.remove("menu-open"));
  }

  // ---------------------------------------------------------------- the title, the icon, and below the blocks
  const title = $("title");
  title.addEventListener("input", () => {
    const p = page();
    if (!p) return;
    p.title = title.textContent.replace(/\s+/g, " ").trimStart();
    if (titleDirty) clearTimeout(titleDirty.timer);
    titleDirty = { page: p.id, title: p.title, timer: setTimeout(() => { flushTyped(); pump(); }, 450) };
    saved("saving");
    drawSide();
    drawCrumbs(p);
  });
  title.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" && !(ev.key === "ArrowDown" && onLine(title, true))) return;
    ev.preventDefault();
    const p = page();
    if (!p || p.deleted) return;
    const first = p.blocks.find(editable);
    if (first && ev.key === "ArrowDown") return focusBlock(first.id, "start");
    if (first && first.type === "text" && !plainOf(first.text)) return focusBlock(first.id, "start");
    const b = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: p.id, block: b, after: "" }]);
    drawPage();
    focusBlock(b.id, 0);
  });
  title.addEventListener("paste", (ev) => {
    ev.preventDefault();
    document.execCommand("insertText", false, (ev.clipboardData.getData("text/plain") || "").replace(/\s+/g, " "));
  });
  const iconPicker = (anchor) => popUp(anchor.getBoundingClientRect(), (pop) => {
    const p = page();
    pop.append(el("div", { class: "grid" }, ...ICONS.map((e) => el("button", { type: "button", text: e, title: e,
      onclick: () => { closePop(); change([{ op: "page.set", page: p.id, icon: e }]); drawSide(); drawPage(); } }))));
    if (p.icon) pop.append(el("div", { class: "sep" }), item({ glyph: SVG.x, sm: true, label: "Remove the icon" },
      () => { change([{ op: "page.set", page: p.id, icon: "" }]); drawSide(); drawPage(); }));
  }, null, "menu", "emoji");
  $("add-icon").addEventListener("click", (ev) => iconPicker(ev.currentTarget));
  $("icon").addEventListener("click", (ev) => { if (!page().deleted) iconPicker(ev.currentTarget); });
  $("below").addEventListener("mousedown", (ev) => {
    const p = page();
    if (!p || p.deleted) return;
    ev.preventDefault();
    const last = p.blocks[p.blocks.length - 1];
    if (last && last.type === "text" && !plainOf(last.text)) return focusBlock(last.id, "end");
    const b = { id: rid(), type: "text", text: "", checked: false, indent: 0 };
    change([{ op: "block.put", page: p.id, block: b }]);
    drawPage();
    focusBlock(b.id, 0);
  });

  // ---------------------------------------------------------------- pasting: lines as blocks
  box.addEventListener("paste", async (ev) => {
    const tx = ev.target.closest && ev.target.closest(".tx");
    if (!tx) return;
    ev.preventDefault();
    const text = (ev.clipboardData.getData("text/plain") || "").replace(/\r\n?/g, "\n");
    const n = tx.closest(".blk"), b = blockOf(n.dataset.id);
    if (!text || !b) return;
    if (b.type === "code" || !text.trim().includes("\n")) {
      document.execCommand("insertText", false, b.type === "code" ? text : text.replace(/\n+/g, " "));
      return;
    }
    let got = [];
    try { got = (await (await ag.api("parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: text }) })).json()).blocks || []; }
    catch { document.execCommand("insertText", false, text.replace(/\n+/g, " ")); return; }
    if (!got.length || !blockOf(b.id)) return;
    const ops = [];
    let after = b.id;
    if (empty(tx) && b.type === "text") {
      const first = got.shift();
      forget(b.id);
      ops.push({ op: "block.put", page: current, block: { ...first, id: b.id } });
      if (first.type === "code") tx.textContent = first.text; else tx.innerHTML = clean(first.text);
    }
    for (const nb of got) { ops.push({ op: "block.put", page: current, block: nb, after }); after = nb.id; }
    change(ops);
    drawPage();
    focusBlock(after, "end");
  });

  // ---------------------------------------------------------------- start
  try { book = await (await ag.api("state")).json(); } catch { book = { version: 0, pages: [] }; }
  if (!book || !Array.isArray(book.pages)) book = { version: 0, pages: [] };
  reindex();
  ready = true;
  for (const m of early.splice(0)) heard(m);
  const kept = store.get("page", null);
  current = kept && pages.has(kept) && !pages.get(kept).deleted ? kept : (kidsOf(null)[0] || {}).id || null;
  for (let p = pages.get(current); p && p.parent; p = pages.get(p.parent)) opened.add(p.parent);
  if (narrow()) app.classList.remove("side-on");
  drawSide();
  drawPage();
  document.body.dataset.ready = "1";
})();
