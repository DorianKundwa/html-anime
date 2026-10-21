/**
 * Film gates the harness can check without HyperFrames:
 *   - every color in film/ is in harness/palette.js
 *   - no banned token (gradients, shadows, blurs, random or time sources, async, play())
 *   - the root data-duration equals the audio length in frames (when build/timeline.json exists)
 *
 *   node harness/check-film.js projects/<slug>
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { offPaletteColors } from "./palette.js";

const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".svg", ".json"]);

/**
 * Vendored third-party files that the film may load from film/. A file is exempt from the
 * banned-token and color gates only while its bytes match the pinned sha256, so a changed
 * or swapped copy is checked like any other film file. Paths are relative to film/.
 * gsap 3.14.2 uses Math.random, Date.now, setTimeout and .play() internally; it is not our code.
 */
export const VENDORED = {
  "vendor/gsap.min.js": "c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280",
};

export function isPinnedVendor(relPath, bytes) {
  const pinned = VENDORED[relPath.split(sep).join("/")];
  return pinned !== undefined && createHash("sha256").update(bytes).digest("hex") === pinned;
}

export const BANNED = [
  { name: "gradient", re: /gradient/i },
  { name: "box-shadow", re: /box-shadow/ },
  { name: "drop-shadow", re: /drop-shadow/ },
  { name: "text-shadow", re: /text-shadow/ },
  { name: "blur(", re: /blur\(/ },
  { name: "Math.random", re: /Math\.random/ },
  { name: "Date.now", re: /Date\.now/ },
  { name: "setTimeout", re: /setTimeout/ },
  { name: "async", re: /\basync\b/ },
  { name: "repeat: -1", re: /repeat\s*:\s*-1/ },
  { name: "play()", re: /\.play\(\)/ },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Returns { errors }. An empty list means every film gate the harness can see passes. */
export function checkFilm(projectDir) {
  const errors = [];
  const filmDir = join(projectDir, "film");
  if (!existsSync(filmDir)) return { errors: [`missing ${filmDir}`] };

  // film/.hyperframes/ holds the artifacts `hyperframes check` writes. They are generated output, not film source.
  const checkArtifacts = join(filmDir, ".hyperframes") + sep;
  for (const file of walk(filmDir)) {
    if (file.startsWith(checkArtifacts)) continue;
    if (!TEXT_EXT.has(extname(file).toLowerCase())) continue;
    const rel = relative(projectDir, file);
    const bytes = readFileSync(file);
    if (isPinnedVendor(relative(filmDir, file), bytes)) continue;
    const text = bytes.toString("utf8");
    for (const hex of offPaletteColors(text)) {
      errors.push(`${rel}: color ${hex} is not in harness/palette.js`);
    }
    for (const { name, re } of BANNED) {
      if (re.test(text)) errors.push(`${rel}: banned token "${name}"`);
    }
  }

  const root = join(filmDir, "index.html");
  const timelinePath = join(projectDir, "build", "timeline.json");
  if (!existsSync(root)) {
    errors.push("film/index.html is missing");
  } else if (existsSync(timelinePath)) {
    const tl = JSON.parse(readFileSync(timelinePath, "utf8"));
    const m = /data-duration="([\d.]+)"/.exec(readFileSync(root, "utf8"));
    if (!m) errors.push("film/index.html has no data-duration");
    else if (Math.round(parseFloat(m[1]) * tl.fps) !== tl.totalFrames) {
      errors.push(`film/index.html data-duration ${m[1]} s is not the audio's ${tl.totalFrames} frames`);
    }
  }
  return { errors };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node harness/check-film.js projects/<slug>");
    process.exit(2);
  }
  const { errors } = checkFilm(dir);
  for (const e of errors) console.error(`error: ${e}`);
  if (errors.length) {
    console.error(`${errors.length} film error(s)`);
    process.exit(1);
  }
  console.log("ok: film passes the palette, banned-token and duration gates");
}
