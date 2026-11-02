// ------------------------------------------------------------------ ag's settings
// ag's config.toml (settings.py): the Gatherer's model, set by `ag model`; a new gatherer's defaults; the
// file itself. Read when the panel opens; on the first load with no model set, the panel opens by itself.
let cfg = null;
const $ = (id) => document.getElementById(id);
function cfgNote(id, text, kind) { const n = $(id); n.textContent = text || ""; n.className = "cfg-note" + (kind ? " " + kind : ""); }
function showSettings(s, said) {
  cfg = s;
  const env = s.env || {};
  const unset = !s.llm.model && !env.AG_LLM_MODEL;
  $("cfg-flag").hidden = !unset;
  if (document.activeElement !== $("cfg-model-name")) $("cfg-model-name").value = s.llm.model;
  $("cfg-api-base").value = s.llm.api_base; $("cfg-key-env").value = s.llm.key_env;
  if (s.llm.api_base || s.llm.key_env) $("cfg-api-base").closest("details").open = true;
  const notes = Object.entries(env).map(([k, v]) => `${k}=${v} is set for this dashboard and overrides the file here.`);
  if (said) cfgNote("cfg-model-note", [said, ...notes].join("\n"));
  else if (unset) cfgNote("cfg-model-note", "No model set: every Gatherer call fails until one is. A coding agent on its own login (claude-code/…, codex/…), or any LiteLLM provider/model.", "bad");
  else cfgNote("cfg-model-note", notes.join("\n"));
  const pol = $("cfg-policy");
  pol.replaceChildren(...s.policies.available.map((p) => el("option", { value: p, text: p })));
  pol.value = s.policies.default;
  $("cfg-pollers").replaceChildren(...(s.pollers.available.length ? s.pollers.available.map((p) => el("label", {},
    el("input", { type: "checkbox", value: p, ...(s.pollers.default.includes(p) ? { checked: "" } : {}) }), p))
    : [el("span", { class: "cfg-note", text: "none available" })]));
  $("cfg-gatherer").value = s.cli.gatherer;
  $("cfg-defaults").querySelector("button").disabled = !s.exists;
  if (!s.exists) cfgNote("cfg-defaults-note", "ag makes config.toml once the model is set, or on its first run.");
  else if (s.error) cfgNote("cfg-defaults-note", "config.toml does not parse: " + s.error, "err");
  else cfgNote("cfg-defaults-note", "");
  const hs = Object.entries(s.cli.harnesses);
  $("cfg-harnesses").replaceChildren(...(hs.length ? hs.map(([name, h]) => el("div", {}, el("code", { text: name }),
    " runs ", el("code", { text: (Array.isArray(h.command) ? h.command : [name]).join(" ") }),
    h.port ? ` · hook port ${h.port}` : "", h.upstream ? ` · upstream ${h.upstream}` : ""))
    : [el("span", { class: "cfg-note", text: "ag writes them here the first time it runs a harness." })]));
  $("cfg-path").textContent = s.path; $("cfg-path").title = s.path;
  showLogins();
}
// Browser logins: the user's Chrome's, copied into ag's own -- the profile every Browser of this dashboard uses
// (browser.py's `login_sites`, `import_logins`): the sites listed (names and counts only), those picked imported.
let loginSites = [];
const loginPicked = new Set();
const LOGINS_NOTE = "Every Browser here uses ag's own Chrome, and its logins. Copy sites' logins from your Chrome: it asks you to allow it, once.";
function showLogins() {
  const on = !!(state.home && state.home.browser), mine = on && state.home.browser_profile === "mine";
  $("cfg-logins").hidden = !on;
  $("cfg-logins-read").closest(".row").hidden = mine;
  if (mine) { $("cfg-logins-pick").hidden = true; cfgNote("cfg-logins-note", "Browsers here run in your own Chrome (browser_profile = \"mine\"): they have its logins already."); }
  else if (!$("cfg-logins-note").textContent || $("cfg-logins-note").textContent.includes("own Chrome (browser_profile")) cfgNote("cfg-logins-note", LOGINS_NOTE);
}
function drawLoginSites() {
  const q = $("cfg-logins-filter").value.trim().toLowerCase();
  const shown = loginSites.filter((s) => !q || s.site.includes(q));
  $("cfg-logins-list").replaceChildren(...(shown.length ? shown.map((s) => el("label", {},
    el("input", { type: "checkbox", value: s.site, ...(loginPicked.has(s.site) ? { checked: "" } : {}),
      onchange: (ev) => { ev.target.checked ? loginPicked.add(s.site) : loginPicked.delete(s.site); countLogins(); } }),
    el("span", { text: s.site }), el("span", { class: "n", text: `${s.cookies}` })))
    : [el("span", { class: "cfg-note", text: q ? "No site matches." : "Your Chrome has no cookies." })]));
}
function countLogins() {
  $("cfg-logins-import").disabled = !loginPicked.size;
  cfgNote("cfg-logins-count", loginPicked.size ? `${loginPicked.size} picked: ${[...loginPicked].slice(0, 3).join(", ")}${loginPicked.size > 3 ? ", …" : ""}` : "");
}
$("cfg-logins-read").addEventListener("click", async () => {
  const b = $("cfg-logins-read");
  b.disabled = true;
  cfgNote("cfg-logins-note", "Waiting for your Chrome: click Allow in its “Allow remote debugging?” dialog…");
  try {
    loginSites = (await post("/api/browser/logins", { action: "sites" })).sites;
    loginPicked.clear(); $("cfg-logins-filter").value = "";
    drawLoginSites(); countLogins();
    $("cfg-logins-pick").hidden = false;
    cfgNote("cfg-logins-note", `Your Chrome has cookies for ${loginSites.length} sites. Pick those whose logins every Browser here, and its agent, may use.`);
    $("cfg-logins-filter").focus();
  } catch (e) { cfgNote("cfg-logins-note", e.message, "err"); }
  finally { b.disabled = false; }
});
$("cfg-logins-filter").addEventListener("input", drawLoginSites);
$("cfg-logins-import").addEventListener("click", async () => {
  const b = $("cfg-logins-import");
  b.disabled = true;
  try {
    const got = await post("/api/browser/logins", { action: "import", sites: [...loginPicked] });
    const done = got.imported.map((i) => `${i.site} (${i.cookies} cookie${i.cookies === 1 ? "" : "s"})`).join(", ");
    $("cfg-logins-pick").hidden = true; loginSites = []; loginPicked.clear();
    cfgNote("cfg-logins-note", `Imported: ${done}.${got.reloaded ? ` ${got.reloaded} tab${got.reloaded === 1 ? "" : "s"} on them loaded again.` : ""}`);
  } catch (e) { cfgNote("cfg-logins-count", e.message, "err"); b.disabled = false; }
});
async function loadSettings() {
  if (SNAPSHOT) return;
  showSettings(await get("/api/settings"));
}
async function cfgSubmit(ev, note, run) {
  ev.preventDefault();
  const button = ev.target.querySelector("button[type=submit]");
  button.disabled = true; cfgNote(note, "Saving…");
  try { await run(); } catch (e) { cfgNote(note, e.message, "err"); } finally { button.disabled = false; }
}
$("cfg-model").addEventListener("submit", (ev) => cfgSubmit(ev, "cfg-model-note", async () => {
  const got = await post("/api/settings/model", { model: $("cfg-model-name").value,
    api_base: $("cfg-api-base").value, key_env: $("cfg-key-env").value });
  showSettings(got, got.said);
  setAbout(false);
}));
$("cfg-defaults").addEventListener("submit", (ev) => cfgSubmit(ev, "cfg-defaults-note", async () => {
  showSettings(await post("/api/settings/defaults", { version: cfg.version, policy: $("cfg-policy").value || null,
    pollers: [...$("cfg-pollers").querySelectorAll("input:checked")].map((b) => b.value), gatherer: $("cfg-gatherer").value }));
  cfgNote("cfg-defaults-note", "Saved: new gatherers get these.");
}));
$("cfg-edit").addEventListener("click", async () => {
  await loadSettings().catch(() => {});
  if (!cfg) return;
  $("cfg-file-text").value = cfg.text; $("cfg-file-path").textContent = cfg.path; $("cfg-file-err").textContent = "";
  $("cfg-file").hidden = false;
  const box = $("cfg-file-text"); box.focus(); box.setSelectionRange(0, 0); box.scrollTop = 0;
});
$("cfg-file-cancel").addEventListener("click", () => { $("cfg-file").hidden = true; });
$("cfg-file").addEventListener("click", (ev) => { if (ev.target === $("cfg-file")) $("cfg-file").hidden = true; });
$("cfg-file-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    showSettings(await post("/api/settings/file", { version: cfg.version, text: $("cfg-file-text").value }));
    $("cfg-file").hidden = true;
  } catch (e) { $("cfg-file-err").textContent = e.message; }
});
if (!SNAPSHOT && !PANE) {
  $("cfg").hidden = false;
  loadSettings().then(() => {
    if (cfg && !cfg.llm.model && !(cfg.env || {}).AG_LLM_MODEL) { setAbout(true); $("cfg-model-name").focus(); }
  }).catch(() => {});
}
// Redraw the main view where the reader left it: the same tables open, the same lists scrolled.
const atEnd = (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 40;
function keepingPlace(draw) {
  const main = document.getElementById("main");
  const open = [...main.querySelectorAll("details[open][id]")].map((d) => d.id);
  const scrolled = [...main.querySelectorAll("[data-keep]")].map((n) => [n.dataset.keep, n.scrollTop, n.scrollLeft]);
  // a list that follows its end (data-follow), read to its end: kept at its end as it grows
  const following = [...main.querySelectorAll("[data-follow]")].filter(atEnd).map((n) => n.dataset.keep);
  const pageY = window.scrollY;
  const box = document.getElementById("composer-text"), focused = box && document.activeElement === box;
  const typed = box ? [box.dataset.draft, box.value, box.selectionStart, box.selectionEnd] : null;
  // what keeps its own node across draws (a terminal, data-refocus) and had the focus: given it back
  const refocus = document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-refocus]");
  draw();
  if (refocus && refocus.isConnected && refocus.agFocus) refocus.agFocus();
  // the box drawn anew for the same actor: as it was, caret and all (another actor's starts with its own draft)
  const again = document.getElementById("composer-text");
  if (again && typed && again !== box && again.dataset.draft === typed[0]) {
    again.value = typed[1]; fitBox(again);
    if (focused) { again.focus(); again.setSelectionRange(typed[2], typed[3]); }
  }
  for (const id of open) { const d = document.getElementById(id); if (d) d.open = true; }
  for (const [k, top, left] of scrolled) {
    const n = main.querySelector(`[data-keep="${k}"]`);
    if (n) { n.scrollTop = top; n.scrollLeft = left; }
  }
  for (const k of following) { const n = main.querySelector(`[data-keep="${k}"]`); if (n) n.scrollTop = n.scrollHeight; }
  window.scrollTo(0, pageY);
}
// The server's stream for the selected agent: `home` and `agent` at once, then each time one changes
// (the server is woken by ag's notifications). EventSource reconnects by itself, and a new stream
// starts with both again, so nothing is missed while it was down. Reopened when the selection
// changes; closed while paused. A message for an agent no longer selected is dropped.
// The other panes' actors come on it too (`also`, each an `actor`), handed to their frames: a browser keeps
// only six connections to a server open, and a stream holds one for as long as it is open. A frame has no
// stream of its own: the page around it streams for it.
function connect() {
  if (PANE) { state.stream = PANE.stream; paneUrl(); PANE.shows(window, state.selected); return; }
  if (state.stream) { state.stream.close(); state.stream = null; }
  if (SNAPSHOT || state.paused) return;
  const sel = state.selected, also = panes.others.filter((p) => !isShell(p.c));   // a shell: nothing to stream but its terminal
  const q = [...(sel && !isShell(sel[1]) ? [`gatherer=${encodeURIComponent(sel[0])}`, `channel=${encodeURIComponent(sel[1])}`] : []),
    ...(also.length ? [`also=${encodeURIComponent(JSON.stringify(also.map((p) => [p.g, p.c])))}`] : [])];
  const es = new EventSource("/api/stream" + (q.length ? "?" + q.join("&") : ""));
  state.stream = es;
  panes.actors.clear();
  const mine = () => state.stream === es;
  es.addEventListener("home", (ev) => { if (mine()) { panesTake("home", ev.data); streamTake("home", ev.data, mine); } });
  es.addEventListener("agent", (ev) => { if (mine()) streamTake("agent", ev.data, mine, sel); });
  es.addEventListener("actor", (ev) => { if (mine()) panesTake("actor", ev.data); });
  es.addEventListener("open", () => { if (mine()) render(); });
  es.addEventListener("error", () => { if (mine() && !state.paused) setLive("Reconnecting…"); });
}

// What the stream says, one message at a time, in order: the home, and the agent of `sel` -- or, in a frame,
// the `actor` its page around it hands it (the stream's, for this pane's actor). In a frame, after its first load.
let streamQueue = Promise.resolve();
function streamTake(name, data, mine = () => true, sel = null) {
  streamQueue = streamQueue.then(async () => {
    if (!mine() || state.paused) return;
    try {
      const got = JSON.parse(data);
      if (name === "home") {
        takeHome(got);
        await loadChat();                            // a session's state: its messages may have moved on too
        if (!state.selected && !PANE) {              // the first agent to appear: shown, and watched
          const first = got.gatherers.find((g) => g.agents.length);
          if (first) { state.selected = [first.name, firstAgent(first).channel]; await loadAgent(); render(true); connect(); }
        }
      } else {
        const [g, c, agent] = name === "actor" ? [got.gatherer, got.channel, got.agent] : [...(sel || []), got];
        if (!isAt(state.selected, g, c)) return;     // for an actor no longer shown
        await takeAgent(agent); await loadChat();
      }
      render();
    } catch (err) { setLive(`Not updated: ${err.message}`); }
  });
}

