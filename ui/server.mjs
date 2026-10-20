/**
 * Local control panel for the doodle pipeline. Plain Node, no dependencies.
 * Serves ui/ and a small JSON API over projects/<slug>/. Binds to 127.0.0.1 only.
 *
 *   npm run ui      then open the printed URL
 *
 * Commands run with fixed arguments. The only user input is a project slug, and it is
 * checked against a pattern and against the folders that exist under projects/.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PALETTE } from "../harness/palette.js";
import { compileProject } from "../harness/compile.js";
import { checkFilm } from "../harness/check-film.js";

const UI_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(UI_DIR, "..");

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_TEXT = 200_000;
const MAX_OUTPUT = 64_000;
const IS_WIN = process.platform === "win32";
const HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

const STATIC_FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

export function isValidSlug(slug) {
  return typeof slug === "string" && SLUG.test(slug);
}

function isDir(p) {
  return existsSync(p) && statSync(p).isDirectory();
}

/** The project directory for a valid slug that exists under projects/, or null. */
export function resolveProject(root, slug) {
  if (!isValidSlug(slug)) return null;
  const dir = join(root, "projects", slug);
  return isDir(dir) ? dir : null;
}

function findAudio(dir) {
  for (const name of ["narration.mp3", "narration.wav"]) {
    if (existsSync(join(dir, "audio", name))) return name;
  }
  return null;
}

/** Input and build state of one project, read from disk. */
export function projectStatus(dir, slug) {
  const has = (...p) => existsSync(join(dir, ...p));
  return {
    slug,
    inputs: {
      audio: findAudio(dir),
      transcript: has("transcript.txt"),
      script: has("script.txt"),
      sceneSheet: has("scene_sheet.md"),
    },
    built: has("build", "timeline.json"),
    captions: has("captions.srt"),
    film: has("film", "index.html"),
    rendered: has("out", `${slug}.mp4`),
  };
}

export function listProjects(root) {
  const base = join(root, "projects");
  if (!isDir(base)) return [];
  return readdirSync(base)
    .filter((name) => isValidSlug(name) && isDir(join(base, name)))
    .sort()
    .map((slug) => projectStatus(join(base, slug), slug));
}

function readText(path) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "\n...(truncated)\n" : text;
}

function clip(s) {
  const text = String(s ?? "");
  return text.length > MAX_OUTPUT ? "...(truncated)\n" + text.slice(-MAX_OUTPUT) : text;
}

/** Runs a fixed command. Resolves with the exit code and clipped output; never rejects. */
export function runCommand(command, args, cwd, timeoutMs = 600_000, onOutput = null) {
  return new Promise((done) => {
    const child = execFile(
      command,
      args,
      { cwd, shell: IS_WIN, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        let code = 0;
        let errText = "";
        if (error) {
          if (typeof error.code === "number") code = error.code;
          else {
            code = 1;
            errText = error.message;
          }
        }
        done({
          ok: code === 0,
          code,
          timedOut: Boolean(error?.killed),
          stdout: clip(stdout),
          stderr: clip(stderr + errText),
        });
      },
    );
    if (onOutput) {
      child.stdout?.on("data", (chunk) => onOutput(String(chunk)));
      child.stderr?.on("data", (chunk) => onOutput(String(chunk)));
    }
  });
}

const needFilm = (dir) =>
  existsSync(join(dir, "film", "index.html"))
    ? null
    : { ok: false, errors: ["film/ is missing: build the film first"] };

/** Project actions. Each takes { dir, slug } and returns a JSON-safe result. */
const ACTIONS = {
  compile: {
    async run({ dir }) {
      const res = await compileProject(dir);
      return { ok: res.ok, errors: res.errors, warnings: res.warnings, counts: res.counts };
    },
  },
  "film-gate": {
    async run({ dir }) {
      const missing = needFilm(dir);
      if (missing) return missing;
      const { errors } = checkFilm(dir);
      return { ok: errors.length === 0, errors };
    },
  },
  lint: {
    async run({ dir, emit }) {
      const missing = needFilm(dir);
      if (missing) return missing;
      return runCommand("npx", ["hyperframes", "lint"], join(dir, "film"), undefined, emit);
    },
  },
  check: {
    async run({ dir, emit }) {
      const missing = needFilm(dir);
      if (missing) return missing;
      return runCommand("npx", ["hyperframes", "check"], join(dir, "film"), undefined, emit);
    },
  },
  render: {
    async run({ dir, slug, emit }) {
      const missing = needFilm(dir);
      if (missing) return missing;
      mkdirSync(join(dir, "out"), { recursive: true });
      return runCommand(
        "npx",
        ["hyperframes", "render", "film", "--quality", "delivery", "--fps", "24", "--output", join("out", `${slug}.mp4`)],
        dir,
        undefined,
        emit,
      );
    },
  },
};

export function projectDetail(dir, slug) {
  return {
    ...projectStatus(dir, slug),
    brief: readText(join(dir, "build", "brief.md")),
    captionsDiff: readText(join(dir, "build", "captions-diff.md")),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, errors: [message] });
}

/** Starts an NDJSON reply. Returns emit(text), which sends one output line as it arrives. */
function startStream(res) {
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  return (text) => res.write(`${JSON.stringify({ type: "output", text })}\n`);
}

/** Ends an NDJSON reply with the final result line. */
function endStream(res, result) {
  res.end(`${JSON.stringify({ type: "result", ...result })}\n`);
}

function sendStatic(res, [file, type]) {
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(join(UI_DIR, file)));
}

/** Rejects requests whose Host is not the loopback address (DNS rebinding). */
function hostAllowed(req) {
  const hostname = String(req.headers.host ?? "").split(":")[0];
  return HOSTNAMES.has(hostname);
}

/** Resolves a slug from the URL to a project dir, or sends the 400/404 and returns null. */
function projectOr(res, root, slug) {
  const dir = resolveProject(root, slug);
  if (!dir) {
    if (!isValidSlug(slug)) sendError(res, 400, `invalid project slug: ${slug}`);
    else sendError(res, 404, `no project folder projects/${slug}`);
    return null;
  }
  return dir;
}

export function createUiServer({ root = ROOT } = {}) {
  const state = { busy: null, lastRuns: new Map() };

  async function runTests(res, stream) {
    state.busy = "npm test";
    const emit = stream ? startStream(res) : null;
    try {
      const result = await runCommand("npm", ["test"], root, 900_000, emit);
      if (stream) endStream(res, result);
      else sendJson(res, 200, result);
    } finally {
      state.busy = null;
    }
  }

  async function handle(req, res) {
    if (!hostAllowed(req)) return sendError(res, 403, "host not allowed");
    const url = new URL(req.url, "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "GET") {
      if (STATIC_FILES[path]) return sendStatic(res, STATIC_FILES[path]);
      if (path === "/api/palette") return sendJson(res, 200, { palette: PALETTE });
      if (path === "/api/projects") return sendJson(res, 200, { projects: listProjects(root) });
      const m = /^\/api\/projects\/([^/]+)$/.exec(path);
      if (m) {
        const slug = decodeURIComponent(m[1]);
        const dir = projectOr(res, root, slug);
        if (!dir) return;
        const runs = [...state.lastRuns.entries()]
          .filter(([key]) => key.startsWith(`${slug}:`))
          .map(([, run]) => run);
        return sendJson(res, 200, { ...projectDetail(dir, slug), runs });
      }
      return sendError(res, 404, `no route for ${path}`);
    }

    if (req.method === "POST") {
      req.resume();
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return sendError(res, 403, "cross-origin request refused");
      const stream = url.searchParams.get("stream") === "1";
      if (path === "/api/test") {
        if (state.busy) return sendError(res, 409, `busy: ${state.busy} is running`);
        return runTests(res, stream);
      }
      const m = /^\/api\/projects\/([^/]+)\/([a-z-]+)$/.exec(path);
      if (!m || !ACTIONS[m[2]]) return sendError(res, 404, `no action for ${path}`);
      const slug = decodeURIComponent(m[1]);
      const action = m[2];
      const dir = projectOr(res, root, slug);
      if (!dir) return;
      if (state.busy) return sendError(res, 409, `busy: ${state.busy} is running`);

      const key = `${slug}:${action}`;
      state.busy = key;
      const emit = stream ? startStream(res) : null;
      let result;
      try {
        result = await ACTIONS[action].run({ dir, slug, emit });
      } catch (err) {
        result = { ok: false, errors: [String(err?.message ?? err)] };
      } finally {
        state.busy = null;
      }
      const run = { action, at: new Date().toISOString(), ...result };
      state.lastRuns.set(key, run);
      if (stream) return endStream(res, run);
      return sendJson(res, 200, run);
    }

    return sendError(res, 405, `method ${req.method} not allowed`);
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendError(res, 500, String(err?.message ?? err));
      else res.end();
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const port = Number(process.env.PORT) || 4321;
  createUiServer().listen(port, "127.0.0.1", () => {
    console.log(`doodle pipeline UI: http://127.0.0.1:${port}`);
  });
}
