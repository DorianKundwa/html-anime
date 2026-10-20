/**
 * Film gates the harness can check without HyperFrames:
 *   - every color in film/ is in harness/palette.js
 *   - no banned token (gradients, shadows, blurs, random or time sources, async, play())
 *   - the root data-duration equals the audio length in frames (when build/timeline.json exists)
 *
 *   node harness/check-film.js projects/<slug>
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { offPaletteColors } from "./palette.js";

const TEXT_EXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".svg", ".json"]);

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

  for (const file of walk(filmDir)) {
    if (!TEXT_EXT.has(extname(file).toLowerCase())) continue;
    const rel = relative(projectDir, file);
    const text = readFileSync(file, "utf8");
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
