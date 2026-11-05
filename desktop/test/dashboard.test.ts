// desktop/src/dashboard.ts: finding the home's dashboard, or starting it, as `ag` does. Fake servers and a fake `ag`.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { connect, findAg, homeOf, loginEnv, probe, startDashboard, urlOf, waitFor } from "../src/dashboard.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "ag-desktop-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** A server answering /api/home with `body`, on a free port: its port and a way to close it. */
async function serve(body: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => res.end(body));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/** A port nothing listens on. */
async function freePort(): Promise<number> {
  const s = await serve("");
  await s.close();
  return s.port;
}

function script(name: string, body: string): string {
  const file = path.join(tmp, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

describe("homeOf", () => {
  test("the one given, else AG_HOME, else ~/.ag, made absolute", () => {
    assert.equal(homeOf({}, "/x/home"), "/x/home");
    assert.equal(homeOf({ AG_HOME: "/y/home" }), "/y/home");
    assert.equal(homeOf({}), path.join(os.homedir(), ".ag"));
    assert.equal(homeOf({ AG_HOME: "~/h/../h2" }), path.join(os.homedir(), "h2"));
  });
});

describe("probe", () => {
  test("nothing there", async () => {
    assert.deepEqual(await probe(await freePort(), "/h"), { kind: "none" });
  });
  test("this home's dashboard", async () => {
    const s = await serve(JSON.stringify({ home: "/h" }));
    assert.deepEqual(await probe(s.port, "/h"), { kind: "ours", url: urlOf(s.port) });
    await s.close();
  });
  test("another home's dashboard, or another program", async () => {
    const s = await serve(JSON.stringify({ home: "/other" }));
    assert.deepEqual(await probe(s.port, "/h"), { kind: "other", what: "the dashboard of another home (/other)" });
    await s.close();
    const t = await serve("<html>not a dashboard</html>");
    assert.deepEqual(await probe(t.port, "/h"), { kind: "other", what: "another program" });
    await t.close();
  });
});

describe("findAg and loginEnv", () => {
  test("ag on the PATH, or none", () => {
    const bin = mkdtempSync(path.join(tmp, "bin-"));
    const ag = path.join(bin, "ag");
    writeFileSync(ag, "#!/bin/sh\n");
    chmodSync(ag, 0o755);
    assert.equal(findAg({ PATH: `/nowhere${path.delimiter}${bin}` }), ag);
    assert.equal(findAg({ PATH: "/nowhere" }), null);
  });
  test("the login shell's environment, else the one given", () => {
    const shell = script("fake-shell", '#!/bin/sh\nexport FROM_LOGIN=yes\nexec /bin/sh -c "$2"\n');
    assert.equal(loginEnv({ X: "1" }, shell).FROM_LOGIN, "yes");
    assert.deepEqual(loginEnv({ X: "1" }, script("broken-shell", "#!/bin/sh\nexit 3\n")), { X: "1" });
  });
});

describe("starting the dashboard", () => {
  // A fake `ag`: `ag dashboard --no-open --port N` serves /api/home with its AG_HOME, as the real one does (and leaves
  // its pid in the home, for the test to stop it).
  const fakeAg = () =>
    script(
      "ag",
      `#!${process.execPath}\nconst port = Number(process.argv[process.argv.indexOf("--port") + 1]);\n` +
        `console.log("dashboard: starting", process.argv.slice(2).join(" "));\n` +
        `require("fs").writeFileSync(require("path").join(process.env.AG_HOME, "fake.pid"), String(process.pid));\n` +
        `require("http").createServer((q, s) => s.end(JSON.stringify({ home: process.env.AG_HOME }))).listen(port, "127.0.0.1");\n`,
    );

  test("started on its own, it answers for the home and runs on", async () => {
    const home = mkdtempSync(path.join(tmp, "home-"));
    const port = await freePort();
    const started = startDashboard(fakeAg(), home, port, process.env);
    try {
      assert.equal(await waitFor(port, home, started, 10_000), urlOf(port));
      assert.deepEqual(await probe(port, home), { kind: "ours", url: urlOf(port) });
    } finally {
      process.kill(started.pid);
    }
  });

  test("one that stops says why", async () => {
    const home = mkdtempSync(path.join(tmp, "home-"));
    const ag = script("ag-fails", "#!/bin/sh\necho 'ag dashboard: cannot listen on 127.0.0.1:1: in use' >&2\nexit 1\n");
    const started = startDashboard(ag, home, await freePort(), process.env);
    await assert.rejects(waitFor(await freePort(), home, started, 10_000), /stopped \(exit 1\)[\s\S]*cannot listen/);
  });

  test("connect: the home's running dashboard as it is; a port taken by another home's, refused", async () => {
    const s = await serve(JSON.stringify({ home: "/h" }));
    const env = () => assert.fail("nothing is started when the home's dashboard runs");
    assert.equal(await connect("/h", s.port, env), urlOf(s.port));
    await assert.rejects(connect("/elsewhere", s.port, env), /Port \d+ is taken by the dashboard of another home \(\/h\)/);
    await s.close();
  });

  test("connect: none running, it is started", async () => {
    const home = mkdtempSync(path.join(tmp, "home-"));
    const port = await freePort();
    const bin = path.dirname(fakeAg());
    try {
      const url = await connect(home, port, () => ({ ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }));
      assert.equal(url, urlOf(port));
    } finally {
      process.kill(Number(readFileSync(path.join(home, "fake.pid"), "utf8")));
    }
  });
});
