# The dashboard on a standard stack: plan

Status: A0 and A1 built. A1's build step, the server serving it and `publish.yml` building it come with A3, the
first step with something to build. It moves the
dashboard to the tools most web front ends and Python APIs are built with now, in steps that keep it working.

## Why

- **One file takes every change.** `page.html` is 11,146 lines (816 KB): about 2,200 lines of CSS, 8,800 of JS in
  one `<script>`, and the body. Since 2026-10-01, 198 commits touched it; `data.py`, the next busiest, had 67.
  Two open PRs (#211, #212) and most of the worktrees under `ucbepic-actor-gatherer-worktrees/` change it now, so
  actors working in parallel conflict there whatever they work on.
- **Everything is hand-built.** The page draws with its own `el()` and `replaceChildren`, keeps its own "what was
  last drawn" checks, positions its own menus and popovers, and resizes its own splits. Many bugs we fixed one by
  one came from this: flicker while typing, the idle layout loop in Chrome, the running glyph moving what's beside
  it, a pane's name left behind after it closed.
- **One scope for everything.** About 440 functions and 47 top-level `let`s share one script scope. Any section can
  call or overwrite any other, and two features picking the same name clash (`MARKS`, in #193).
- **Each pane is the whole page again**, in an iframe, with its own copy of the code and state.
- **Tests cut the page apart by marker strings.** `test_dashboard_code.py`, `_plan`, `_esc`, `_coordination` and
  `_avatars` slice sections out of `page.html` and run them in Node with stubs. Visual checks are one-off CDP
  scripts, rewritten for each change.
- **The server routes by if-chain.** `server.py`'s `do_GET` has about 65 `if url.path == "..."` checks, each
  validating its own query, and the route list is kept by hand in its docstring. Nothing describes the shape of
  what each route returns, so the page and the server agree only by habit.

## The stack

| Concern | Today | Standard choice | Why |
|---|---|---|---|
| Build and dev server | None; esbuild only for the Editor's bundle | **Vite**, **TypeScript**, **pnpm** | The default for new front ends: hot reload in development, a bundle for release, types checked in CI. pnpm keeps one package store for all worktrees. |
| UI | Hand-built DOM and redraw checks | **React** | The most used UI library. The other choices below have React versions, and the agents that build this dashboard write it fluently. |
| Client state | One `state` object and 47 globals | **Zustand** store, fed by the event stream; **TanStack Query** for data fetched on demand (history pages, files, search) | The common pairing: pushed state in a store, fetched data cached by key. |
| Styling | 2,200 lines in one `<style>`, theme as CSS variables | **CSS Modules**, one per component; the theme's CSS variables kept | Keeps today's CSS and look, scoped to its component. |
| Menus, popovers, dialogs, tooltips | Hand-written (`popMenu`, `placePop`, `openPop`) | **Radix UI** primitives, unstyled | Keyboard use, focus and placement handled; styled with our CSS. |
| Long lists (chat, transcript) | `content-visibility`, its own "pull earlier" | **react-virtuoso** | Lists that follow new items at the bottom and load earlier ones at the top. |
| Splits and resizing | `widthGrip`, `topGrip`, the panes' own layout | **react-resizable-panels** now; **dockview** later, for dragging panels | Standard split panes; layouts saved as data. |
| Panes | The page again in an iframe per pane | Components in one page, one stream | Iframes stay only for outside content: DocWriter's page, the preview, the Browser's screen. |
| Terminal, editor | xterm.js; CodeMirror 6 with Yjs | The same, each in a component | Already the standard libraries. |
| Markdown, code | marked + DOMPurify; our own highlighter (486 lines) | marked + DOMPurify kept; **Shiki** for highlighting, optional later | |
| Server | `http.server`, standard library only | **FastAPI** (Starlette, uvicorn): one `APIRouter` per feature, **Pydantic** models, **sse-starlette** for the streams | The standard Python API stack; checks each request's parameters and describes every route in an OpenAPI schema. |
| API types | None | **openapi-typescript**: TypeScript types generated from FastAPI's schema | The page fails to compile when a route's shape changes. |
| Tests | Python `unittest`; Node on sections cut out of the page; one-off CDP scripts | **Vitest** with Testing Library for the front end; **Playwright** for end-to-end tests and screenshots; `unittest` kept for Python | |
| Structure rules | `test_harness_untouched.py` | **ESLint** (typescript-eslint, **eslint-plugin-boundaries**), Prettier | Import rules between folders, checked in the editor and CI. |
| CI | Docs and publishing only | A workflow on every PR: lint, types, Vitest, the Python suite, Playwright | |

**What it costs:**
- **Node for development.** Each worktree runs `pnpm install` (one shared store, so it's quick) and either the Vite
  dev server or a build.
- **A build after a pull.** The built front end goes to `ag_dashboard/static/`, which is not in git. `publish.yml`
  builds it before `python -m build`, so the PyPI package carries it. Your ag is an editable install from the main
  checkout (`.venv`), so after a pull it needs `pnpm -C frontend build`. A git `post-merge` hook can run that, and
  `ag dashboard` says so when the build is older than the source.
- **The dashboard stops being standard-library only:** it adds fastapi, uvicorn, pydantic and sse-starlette.
  ag itself doesn't change.
- **Views are rewritten, not moved.** That is where the risk is. Each view gets its Playwright tests before it is
  rewritten, and keeps them after.

## Where the code goes

```
frontend/                  the dashboard's front end: Vite, TypeScript, React
  package.json, vite.config.ts, tsconfig.json, eslint.config.js, index.html
  src/
    main.tsx               mounts the app
    core/                  imports nothing from features/, apps/ or layout/
      api/                 client.ts (fetch), stream.ts (the event stream into the store), types.gen.ts (generated)
      store/               Zustand slices: home, actors, layout, prefs
      ui/                  shared components: Avatar, Badge, Icon, Menu, Popover, Dialog, Markdown, Code
      format.ts            times, counts, sizes
    layout/                the shell: the list's column, the Editor above the panes, the panes, Details;
                           react-resizable-panels; the `layout` slice is the arrangement as data
    features/
      list/                AgentList, Rail, Monitor, naming, seen
      panes/               Pane, PaneHead, new-actor menus, branches
      chat/                ChatView, Turn, Bubble, the files-and-commands panel, Composer, drafts, AskCard
      details/             Details, ContextCard, SizeCard, charts
      transcript/  terminal/  history/  settings/
      editor/              CodeMirror and Yjs, Tree, Changes, Conflicts, Preview
    apps/                  index.ts (APPS), docwriter/, browser/
    compat/                agDashboard.chatView, for <home>/dashboard/views/*.js
    legacy/                page.html's code split into modules (step A3); empties as views move to React
  tests/                   Vitest
  e2e/                     Playwright: a spec per view, screenshots (tests/web_home.py builds and serves its home)
ag_dashboard/
  static/                  the built front end (not in git; in the package)
  app.py                   the FastAPI app: routers, the own-page check, static files, snapshots
  api/                     one router per feature: home, stream, agent, files, history, sessions, terminal,
                           editor, preview, branches, monitor, settings, browser, docwriter
  models.py                Pydantic models of what the routes return
  apps.py                  the apps: (docwriter, browser)
  data.py, files.py, …     the logic, unchanged
```

**Snapshots** (`ag-dashboard --out FILE`) stay one file: the built `index.html` with its script, styles and the data
inlined, as `page()` inlines the vendored scripts today.

**Your own chat views** in `<home>/dashboard/views/*.js` keep working: `compat/` keeps `agDashboard.chatView`, and a
component mounts what a view's `render()` returns.

## Rules

Checked by ESLint and tests in CI:

1. `core/` imports nothing from `features/`, `apps/` or `layout/`.
2. A feature imports `core/` and its own folder, not another feature; what two features share moves to `core/`.
3. Only `apps/` names an app (DocWriter, Browser). On the server, only `apps.py`, `docwriter.py`, `browser.py` and
   their routers do.
4. Only `layout/` arranges the page. A view draws into the element it is given, and never moves an iframe: a browser
   reloads an iframe that is moved.
5. `tsc --noEmit` passes, and `types.gen.ts` matches the server's schema.
6. No file over 500 lines (ESLint's `max-lines`).
7. `test_harness_untouched.py` stays: the dashboard names no harness.

## Order of work

There are two tracks. They touch different files, so separate actors can run them at the same time.

### Track A: the front end

**A0. Playwright tests of today's page.** These are the safety net for everything after.
- A test home (`tests/web_home.py`): the newest recorded Claude Code and Codex sessions in `tests/fixtures/harnesses`,
  stored through the calls ag's hooks make, with the clock held so every run draws the same page. There is no
  Antigravity fixture to build one from yet.
- A spec per view: Chat, Terminal, Transcript, History, Details, the list's three modes, panes, the Editor, settings.
- Specs for what we fixed by hand that a stored session shows: opening and closing panes, no layouts while idle.
  What needs a live harness (Esc taking a message back, a pending message, answering a question card) and the
  Editor, Transcript, DocWriter and Browser get specs as their step comes (A5).
- Screenshots of each view (`toHaveScreenshot`).

All files are new, so this conflicts with nothing.

**A1. The toolchain.**
- `frontend/` with Vite, TypeScript, ESLint, Prettier, Vitest and pnpm, building into `ag_dashboard/static/`.
- The CI workflow, and `publish.yml` building the front end.
- The server serves the build when there is one and `page.html` otherwise, so nothing switches yet.

**A2. Shared `let`s into `state`.** Three top-level `let`s are written from other sections: `chatViewId`,
`chatSend` and `interrupting` (the other `cfg`s were local `const`s). A module can't assign another's, so they
moved into `state`. A3's script checks the same at its finer cuts, where a section splits into several files.

**A3. The split: `page.html` into modules under `src/legacy/`, by a script.**
- The script cuts the page along its section dividers, and the CSS along its comments.
- Each file's body stays byte for byte: imports are added at the top and an `export { … }` list at the bottom.
- So the same script ports a diff of `page.html` onto the new files, and open branches (#211, #212, the worktrees)
  move across with it.
- Vite builds the result and `page.html` goes.

When: on the latest `main`, at a quiet time. The open `page.html` PRs are merged first, and the gatherer agent asks
actors to hold page work that day.

Check: A0's suite, plus a DOM comparison before and after, which must be identical since nothing was rewritten.

**A4. React and the store.** The Zustand store is fed by `stream.ts`, and `legacy/` reads from it. The ESLint rules go
in, with allow-lists for `legacy/` that shrink.

**A5. The views in React, one PR each.** Each PR:
- adds the view's Playwright specs if A0 didn't have them;
- rewrites it with Radix primitives for its menus and popovers, and react-virtuoso for long lists;
- deletes its `legacy/` module.

Order: Chat (where most of the redraw bugs were), Details, Transcript, History, the list (with the rail and
monitor), settings, Terminal, Editor, then DocWriter and Browser as entries in `APPS`.

**A6. The shell in React.**
- The arrangement becomes the store's `layout` slice: the list's mode and width, the Editor open and its height, the
  panes, Details, the chat minimized. It replaces today's separate browser keys, which are read once and dropped.
- react-resizable-panels draws the splits.
- Panes become components in one page, sharing one stream.
- `legacy/` is empty and goes.

### Track B: the server

**B1. FastAPI beside the old server, then in its place.**
- A router per feature, ported route by route.
- Pydantic models for the main responses: home, agent, transcript, files, history.
- The own-page check as middleware, and the streams (home and agent, terminal, editor, preview) on sse-starlette.

Check: every route in today's docstring list, requested of both servers on a scratch home, gives the same status and
body. Then `ag dashboard` runs on uvicorn and `server.py`'s handler goes.

**B2. Generated types.** FastAPI's OpenAPI schema generates `frontend/src/core/api/types.gen.ts`, and CI fails when
it is stale. This needs B1 and A1.

**B3. The apps behind one list.** `apps.py` lists DocWriter and Browser. Each provides the same functions:
`available(home)`, `create(gatherer, cwd, harness)`, `launch_args(session)`, `asked(text)`. `sessions.py`,
`coordination.py` and the routers loop over the list instead of naming each. A session's role is already
`{"<app name>": key}`, so stored sessions don't change.

### Dependencies

- A0 comes first.
- A3 needs A1 and A2; A4–A6 follow in order.
- B1 can start any time; B2 needs B1 and A1; B3 needs B1.

## Room for later

Not built now. Each becomes a change in one place, given the steps above:

| Later | What it takes |
|---|---|
| Another app like DocWriter | A folder in `frontend/src/apps/` and its entry in `APPS`; a module and its entry in `apps.py`; its router. Rule 3 shows anything missed. |
| Apps from outside the repo | A public `agDashboard.app(...)` beside `chatView`, and Python entry points adding to `apps.py`'s list. |
| `ag actors new --app <name>` | One flag over `apps.py`'s list, with `--docwriter` and `--browser` kept as aliases. |
| Dragging panels anywhere | `layout/` only: the `layout` slice becomes a tree of splits and tabs drawn by [dockview](https://github.com/mathuo/dockview) (`dockview-react`; no dependencies, drag to dock, saved layouts, MIT). Its docs require `renderer: 'always'` for panels holding iframes, which matches rule 4. |
| Saved or preset arrangements | The `layout` slice, saved and loaded. |
| Shiki for code | `core/ui/Code` only. |

## Decisions for you

- **React** (recommended) or another framework (Vue, Svelte). React for its libraries and because the agents
  write it most fluently.
- **FastAPI** (recommended), so the dashboard is no longer standard-library only.
- **The build after a pull** in your editable install: a git hook (recommended), or by hand.
- **When to run A3:** the open `page.html` work has to be merged first, or ported that day.

## Projects built this way

Checked on each project's current default branch (2026-11-02). None matches all of it; each shows one part.

| Project | Look at | Shows |
|---|---|---|
| [marimo](https://github.com/marimo-team/marimo/tree/main/marimo/_server/api/endpoints) | `marimo/_server/api/endpoints/*.py` (23 files, each a `router`, mounted in `api/router.py`); `frontend/src/{components,core,plugins}` | The closest overall: a Python server with a router per feature, and a React, TypeScript and Vite front end with `core/` state (jotai), CodeMirror 6 and xterm.js. It streams over a WebSocket. |
| [mitmproxy](https://github.com/mitmproxy/mitmproxy/tree/main/web/src/js) | `web/src/js/ducks/store.ts` (Redux Toolkit); `mitmproxy/tools/web/app.py` | A Python tool's React and TypeScript UI, built by Vite, with one store fed by live updates (A4). |
| [Gitea](https://github.com/go-gitea/gitea/tree/main/web_src/js/features) | `web_src/js/features/*.ts`, `web_src/js/components/*.vue`, `web_src/css/features/` | Moving a large hand-written front end gradually, over many PRs (jQuery removed piece by piece), as A3–A6 do. Built by Vite. |
| [Ray dashboard](https://github.com/ray-project/ray/tree/master/python/ray/dashboard/modules) | `modules/<feature>/*_head.py` with `@routes.get(...)`; `client/src/pages/<feature>` | Server modules per feature, mirrored by the client's pages. |
| [pgAdmin 4](https://github.com/pgadmin-org/pgadmin4/tree/master/web/pgadmin/tools/psql) | `tools/psql/` (Flask routes beside a React component using xterm.js); `tools/sqleditor/` (CodeMirror 6) | A Python server with React, xterm.js and CodeMirror; zustand for state. |
| [VS Code](https://github.com/microsoft/vscode/tree/main/src/vs/workbench/contrib) | `src/vs/workbench/contrib/<feature>/browser/*.contribution.ts` | Features that register themselves, and import rules between layers checked by lint. Very large. |
| [ttyd](https://github.com/tsl0922/ttyd/tree/main/html/src) | `html/src/components/terminal/` | A terminal component around xterm.js, and a whole UI built into one inlined HTML file, as our snapshots are. Preact; its server is C. |

None of them streams over server-sent events as ours does; they use WebSockets, socket.io or polling. Only
`core/api/stream.ts` and the stream routers deal with it.
