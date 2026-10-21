// Tests for ui/server.mjs. Runs in npm test. Uses a temp root, so the real projects/ folder is never touched.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PALETTE } from "../harness/palette.js";
import { createUiServer, isValidSlug, listProjects, runCommand } from "./server.mjs";

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "ui-test-"));
  const put = (rel, text) => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, text);
  };
  // alpha: a film that passes the gate.
  put("projects/alpha/transcript.txt", "[0:00] hi\n");
  put("projects/alpha/film/index.html", `<html data-duration="1"><body>${PALETTE.orange}</body></html>`);
  // beta: a film with an off-palette color.
  put("projects/beta/film/index.html", '<html data-duration="1"><body style="color:#123456"></body></html>');
  // gamma: no film at all.
  put("projects/gamma/script.txt", "x\n");
  // A stray file must not show up as a project.
  put("projects/notes.txt", "not a project\n");
  mkdirSync(join(root, "projects", "bad slug"), { recursive: true });
  return root;
}

function call(port, { method = "GET", path, host = `127.0.0.1:${port}`, origin } = {}) {
  const headers = { host };
  if (origin) headers.origin = origin;
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let body = data;
        if ((res.headers["content-type"] ?? "").includes("application/json")) body = JSON.parse(data);
        done({ status: res.statusCode, type: res.headers["content-type"] ?? "", body });
      });
    });
    req.on("error", fail);
    req.end();
  });
}

async function withServer(root, fn) {
  const server = createUiServer({ root });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(server.address().port);
  } finally {
    await new Promise((r) => server.close(r));
    rmSync(root, { recursive: true, force: true });
  }
}

test("isValidSlug accepts folder-safe slugs and rejects paths", () => {
  assert.equal(isValidSlug("roof-1"), true);
  assert.equal(isValidSlug("a_b"), true);
  for (const bad of ["", "../x", "a/b", "a\\b", "-x", ".hidden", "x y", "a".repeat(65), undefined, 3]) {
    assert.equal(isValidSlug(bad), false, `expected ${String(bad)} to be rejected`);
  }
});

test("listProjects lists only valid project folders with their state", () => {
  const root = makeRoot();
  try {
    const list = listProjects(root);
    assert.deepEqual(list.map((p) => p.slug), ["alpha", "beta", "gamma"]);
    const alpha = list[0];
    assert.equal(alpha.film, true);
    assert.equal(alpha.inputs.transcript, true);
    assert.equal(alpha.inputs.audio, null);
    assert.equal(alpha.built, false);
    assert.equal(list[2].film, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("listProjects returns an empty list when projects/ is missing", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-empty-"));
  try {
    assert.deepEqual(listProjects(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("GET routes serve the page, palette and project list", async () => {
  await withServer(makeRoot(), async (port) => {
    const page = await call(port, { path: "/" });
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.body, /Doodle pipeline/);

    const css = await call(port, { path: "/app.css" });
    assert.equal(css.status, 200);
    assert.match(css.type, /text\/css/);

    const palette = await call(port, { path: "/api/palette" });
    assert.deepEqual(palette.body.palette, PALETTE);

    const list = await call(port, { path: "/api/projects" });
    assert.deepEqual(list.body.projects.map((p) => p.slug), ["alpha", "beta", "gamma"]);
  });
});

test("project detail: 404 for an unknown folder, 400 for an invalid slug", async () => {
  await withServer(makeRoot(), async (port) => {
    const missing = await call(port, { path: "/api/projects/nope" });
    assert.equal(missing.status, 404);
    const bad = await call(port, { path: "/api/projects/..%2Fx" });
    assert.equal(bad.status, 400);
    const ok = await call(port, { path: "/api/projects/alpha" });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.slug, "alpha");
    assert.deepEqual(ok.body.runs, []);
  });
});

test("film-gate passes a clean film and reports off-palette colors", async () => {
  await withServer(makeRoot(), async (port) => {
    const clean = await call(port, { method: "POST", path: "/api/projects/alpha/film-gate" });
    assert.equal(clean.status, 200);
    assert.equal(clean.body.ok, true);

    const dirty = await call(port, { method: "POST", path: "/api/projects/beta/film-gate" });
    assert.equal(dirty.body.ok, false);
    assert.ok(dirty.body.errors.some((e) => e.includes("#123456")), JSON.stringify(dirty.body.errors));
  });
});

test("actions refuse a project with no film/", async () => {
  await withServer(makeRoot(), async (port) => {
    const res = await call(port, { method: "POST", path: "/api/projects/gamma/render" });
    assert.equal(res.body.ok, false);
    assert.match(res.body.errors[0], /film\/ is missing/);
  });
});

test("the last run is returned with the project detail", async () => {
  await withServer(makeRoot(), async (port) => {
    await call(port, { method: "POST", path: "/api/projects/alpha/film-gate" });
    const detail = await call(port, { path: "/api/projects/alpha" });
    assert.equal(detail.body.runs.length, 1);
    assert.equal(detail.body.runs[0].action, "film-gate");
    assert.equal(detail.body.runs[0].ok, true);
  });
});

function parseNdjson(text) {
  return text.trim().split("\n").map((line) => JSON.parse(line));
}

test("runCommand hands stdout and stderr to onOutput as they arrive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ui-emit-"));
  try {
    writeFileSync(join(dir, "emit.mjs"), "process.stdout.write('out-line\\n'); process.stderr.write('err-line\\n');");
    const chunks = [];
    const run = await runCommand("node", ["emit.mjs"], dir, undefined, (text) => chunks.push(text));
    assert.equal(run.ok, true);
    const streamed = chunks.join("");
    assert.ok(streamed.includes("out-line"), streamed);
    assert.ok(streamed.includes("err-line"), streamed);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("streamed actions reply as NDJSON that ends with a result line", async () => {
  const root = makeRoot();
  await withServer(root, async (port) => {
    const pass = await call(port, { method: "POST", path: "/api/projects/alpha/film-gate?stream=1" });
    assert.equal(pass.status, 200);
    assert.match(pass.type, /application\/x-ndjson/);
    const lines = parseNdjson(pass.body);
    assert.equal(lines.at(-1).type, "result");
    assert.equal(lines.at(-1).action, "film-gate");
    assert.equal(lines.at(-1).ok, true);

    const missing = await call(port, { method: "POST", path: "/api/projects/gamma/render?stream=1" });
    const failLines = parseNdjson(missing.body);
    assert.equal(failLines.at(-1).type, "result");
    assert.equal(failLines.at(-1).ok, false);
  });
});

test("a streamed compile sends its progress lines before the result", async () => {
  await withServer(makeRoot(), async (port) => {
    const res = await call(port, { method: "POST", path: "/api/projects/alpha/compile?stream=1" });
    const lines = parseNdjson(res.body);
    const outputs = lines.filter((l) => l.type === "output").map((l) => l.text);
    assert.equal(outputs[0], "compile alpha\n", JSON.stringify(outputs));
    const result = lines.at(-1);
    assert.equal(result.type, "result");
    assert.equal(result.action, "compile");
    assert.equal(result.ok, false);
    assert.match(result.errors.join(""), /missing scene_sheet\.md/);
    assert.equal(result.stdout, outputs.join(""));
  });
});

test("unknown actions and methods are refused", async () => {
  await withServer(makeRoot(), async (port) => {
    assert.equal((await call(port, { method: "POST", path: "/api/projects/alpha/rm-rf" })).status, 404);
    assert.equal((await call(port, { method: "PUT", path: "/api/projects" })).status, 405);
    assert.equal((await call(port, { path: "/etc/passwd" })).status, 404);
  });
});

test("requests with a non-loopback Host are refused", async () => {
  await withServer(makeRoot(), async (port) => {
    const res = await call(port, { path: "/api/projects", host: "evil.example:80" });
    assert.equal(res.status, 403);
  });
});

test("cross-origin POSTs are refused", async () => {
  await withServer(makeRoot(), async (port) => {
    const res = await call(port, {
      method: "POST",
      path: "/api/projects/alpha/film-gate",
      origin: "http://evil.example",
    });
    assert.equal(res.status, 403);
  });
});
