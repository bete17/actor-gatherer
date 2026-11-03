// ------------------------------------------------------------------ DocWriter
// DocWriter (docwriter.py): the view of a DocWriter's actor -- one started from a gatherer's DocWriter button
// (startDocWriter), its session's `role` naming its DocWriter (dwKey) -- its page, filling the pane as Terminal, Chat
// and History fill it; selecting another actor shows that one, whole. DocWriter's page is what runs its actor's
// document tools (edit_doc, ...), so it must not go when another view is shown: each DocWriter's frame is made once
// (`dwFrame`), in a holder outside the views, never moved -- a frame moved loads again -- and laid over the view's
// slot while DocWriter's view is shown, hidden, still running, while it is not (`dwPlace`). One is made for a DocWriter
// whose actor is at work, shown or not (`dwTell`). Each is told its actor's state, as this page has it, on each change:
// DocWriter follows its agent's turns by it. No message box under it: DocWriter has its own.
const dwFrames = new Map();                          // a DocWriter's key -> its page's frame
let dwHost = null;
function dwFrame(k) {
  let f = dwFrames.get(k);
  if (f) return f;
  if (!dwHost) { dwHost = el("div", { class: "dw-host" }); document.body.append(dwHost); }
  f = el("iframe", { class: "dw-page off", src: `/docwriter/w/${k}/?theme=${dwTheme()}`, title: "DocWriter" });
  f.addEventListener("load", () => dwTell(k));
  dwFrames.set(k, f);
  dwHost.append(f);
  return f;
}
// Each frame over its view's slot, if shown now, else hidden: after each draw, and as the pane changes size.
let dwPlacing = false;
function dwPlace() {
  dwPlacing = false;
  const slot = document.querySelector(".dw-slot");
  const k = slot && slot.isConnected ? slot.dataset.dw : null, r = k ? slot.getBoundingClientRect() : null;
  for (const [fk, f] of dwFrames) {
    const on = fk === k && r.width > 0 && r.height > 0;
    f.classList.toggle("off", !on);
    if (on) Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    else f.removeAttribute("style");
  }
}
function dwPlaceSoon() {
  if (dwPlacing || !dwFrames.size) return;
  dwPlacing = true;
  requestAnimationFrame(dwPlace);
}
if (!SNAPSHOT) {
  new MutationObserver(dwPlaceSoon).observe(document.getElementById("main"), { childList: true, subtree: true });
  const sized = new ResizeObserver(dwPlaceSoon);
  sized.observe(document.getElementById("main"));
  window.addEventListener("resize", dwPlaceSoon);
}
function dwKey(info) {
  const raw = info && info.session && info.session.role;
  if (!raw) return null;
  try { const r = JSON.parse(raw); return (r && typeof r.docwriter === "string" && r.docwriter) || null; } catch (e) { return null; }
}
// What a DocWriter's actor was last asked, as the list shows it: the author's words in DocWriter's prompt (its
// <user_message> or <user_feedback>), not the workspace's state before them.
function dwAsked(text) {
  if (!text || !text.includes("<workspace_state>")) return text;
  const m = text.match(/<user_(?:message|feedback)[^>]*>\s*([\s\S]*?)(?:\s*<\/user_|$)/);
  return m && m[1] ? m[1] : "A DocWriter request";
}
function dwActorOf(k) {
  for (const g of (state.home && state.home.gatherers) || []) for (const a of g.agents) if (dwKey(a) === k) return a;
  return null;
}
function dwTell(only = null) {
  if (!only && !PANE && !SNAPSHOT && state.home && state.home.docwriter) {   // an actor at work: its DocWriter running
    for (const g of state.home.gatherers) for (const a of g.agents) {
      const k = dwKey(a);
      if (k && ["running", "asking"].includes(statusOf(a)[0])) dwFrame(k);
    }
  }
  for (const [k, f] of dwFrames) {
    if ((only && k !== only) || !f.isConnected || !f.contentWindow) continue;
    const a = dwActorOf(k);
    const actor = a && { channel: a.channel, status: statusOf(a)[0], turn_over: a.turn_over, asking: a.asking || null,
      failing: a.failing || null, stopped: a.stopped || null, name: a.name || null,
      session: a.session ? { session_id: a.session.session_id, terminal: !!a.session.terminal } : null };
    try { f.contentWindow.postMessage({ kind: "ag-actor", actor, theme: dwTheme() }, location.origin); } catch (e) { /* not up yet */ }
  }
}
// The page's theme as shown, light or dark: DocWriter's page takes it on, at its start and each time it changes.
const dwTheme = () => document.documentElement.dataset.theme
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
window.addEventListener("ag-theme", () => dwTell());
window.addEventListener("message", (ev) => {
  if (ev.origin !== location.origin || !ev.data || ev.data.kind !== "ag-actor?") return;
  for (const [k, f] of dwFrames) if (f.contentWindow === ev.source) dwTell(k);
});
if (!SNAPSHOT) addChatView({
  id: "docwriter", name: "DocWriter", feed: "none", frame: "dw-frame", chat: false, icon: ICONS.quill,
  description: "DocWriter: write with this actor, its edits proposed beside your text for you to accept or reject.",
  when: (info) => !!dwKey(info),
  render: ({ info }) => {
    const k = dwKey(info);
    if (!state.home || !state.home.docwriter)
      return el("div", { class: "desc", text: "DocWriter needs pycrdt where the dashboard runs, and its page built: pip install pycrdt, then restart the dashboard." });
    dwFrame(k);
    dwPlaceSoon();
    return el("div", { class: "dw-slot", "data-dw": k });
  },
});

