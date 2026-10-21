#!/usr/bin/env node
/**
 * Visual QA contact sheets for a project's film.
 *
 *   node harness/contact-sheet.js projects/<slug> [--scenes S01,S10] [--batch name]
 *       [--beats] [--frames 4] [--out build/qa]
 *
 * Writes, relative to the output folder (default <project>/build/qa):
 *   raw/<scene>/frame-<n>.png   each sampled frame, grabbed with `hyperframes snapshot`
 *   <scene>.png                 one row: --frames evenly spaced frames across the scene
 *   <scene>-beats.png           with --beats: one frame at each beat start, 4 per row
 *   batch-<name>.png            one row per scene in the batch
 *   manifest.json               which frame and sheet holds which scene
 *
 * Frames are sampled at the middle of the frame (f + 0.5) / 24 so a snapshot never lands
 * on a frame boundary. Times are passed to the snapshot tool only; composition code never
 * sees float seconds.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const FPS = 24;
export const CELL_W = 480;
export const CELL_H = 270;
const BEAT_COLS = 4;

/** `count` evenly spaced frame numbers across [startF, endF), starting at startF. */
export function sampleFrames(startF, endF, count) {
  const len = endF - startF;
  const out = [];
  for (let i = 0; i < count; i++) out.push(startF + Math.floor((i * len) / count));
  return out;
}

/** Snapshot time for a frame: the middle of that frame, in seconds. */
export function frameTime(frame) {
  return (frame + 0.5) / FPS;
}

/**
 * The snapshot tool names its files at-<seconds>s.png, rounding the seconds. The distinct
 * frames are at least 1/24 s apart, so sorting the names and sorting the frames pairs them.
 * Returns [{ file, frame }] in frame order.
 */
export function matchSnapshotNames(fileNames, frames) {
  const parsed = fileNames
    .map((file) => ({ file, v: Number(/^at-([0-9.]+)s\.png$/.exec(file)?.[1]) }))
    .filter((p) => Number.isFinite(p.v))
    .sort((a, b) => a.v - b.v);
  const sorted = [...frames].sort((a, b) => a - b);
  if (parsed.length !== sorted.length) {
    throw new Error(`snapshot wrote ${parsed.length} file(s) for ${sorted.length} frame(s)`);
  }
  return parsed.map((p, i) => ({ file: p.file, frame: sorted[i] }));
}

/** Top-left corner of each of `count` cells laid out row by row. */
export function gridPositions(count, cols, cellW = CELL_W, cellH = CELL_H) {
  return Array.from({ length: count }, (_, i) => [(i % cols) * cellW, Math.floor(i / cols) * cellH]);
}

/** ffmpeg filter graph that scales each input to a cell and tiles them with xstack. */
export function gridFilter(count, cols, cellW = CELL_W, cellH = CELL_H) {
  const scales = Array.from({ length: count }, (_, i) => `[${i}:v]scale=${cellW}:${cellH},setsar=1[v${i}]`);
  if (count === 1) return [scales[0].replace(/\[v0\]$/, "[out]")].join(";");
  const layout = gridPositions(count, cols, cellW, cellH).map(([x, y]) => `${x}_${y}`).join("|");
  const inputs = Array.from({ length: count }, (_, i) => `[v${i}]`).join("");
  return [...scales, `${inputs}xstack=inputs=${count}:layout=${layout}[out]`].join(";");
}

function parseArgs(argv) {
  const opts = { dir: null, scenes: null, batch: null, beats: false, frames: 4, out: "build/qa" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--beats") opts.beats = true;
    else if (a === "--scenes") opts.scenes = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--batch") opts.batch = argv[++i];
    else if (a === "--frames") opts.frames = Number(argv[++i]);
    else if (a === "--out") opts.out = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else opts.dir = a;
  }
  if (!opts.dir) throw new Error("usage: node harness/contact-sheet.js projects/<slug> [--scenes S01,S10] [--batch name] [--beats]");
  if (!Number.isInteger(opts.frames) || opts.frames < 1) throw new Error("--frames must be a positive integer");
  return opts;
}

function ffmpegGrid(inputs, out, cols) {
  const filter = gridFilter(inputs.length, cols);
  const args = ["-y", "-loglevel", "error", ...inputs.flatMap((p) => ["-i", p]), "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", out];
  const res = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`ffmpeg failed for ${out}: ${res.stderr || res.error?.message}`);
}

function snapshotFrames(filmDir, frames, tmpDir) {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const at = frames.map((f) => frameTime(f).toFixed(6)).join(",");
  const res = spawnSync(
    "npx",
    ["hyperframes", "snapshot", filmDir, "--at", at, "--no-end", "--keep", "-o", tmpDir],
    { encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    throw new Error(`hyperframes snapshot exited ${res.status}: ${(res.stderr || res.stdout || "").slice(-800)}`);
  }
  return matchSnapshotNames(readdirSync(tmpDir), frames);
}

export function contactSheets(projectDir, opts) {
  const tlPath = join(projectDir, "build", "timeline.json");
  if (!existsSync(tlPath)) throw new Error(`missing ${tlPath}: run the compile step first`);
  const tl = JSON.parse(readFileSync(tlPath, "utf8"));
  const filmDir = join(projectDir, "film");
  if (!existsSync(join(filmDir, "index.html"))) throw new Error(`missing ${join(filmDir, "index.html")}: run build-film first`);

  const scenes = tl.scenes
    .filter((s) => !opts.scenes || opts.scenes.includes(s.id))
    .map((s) => ({
      id: s.id,
      startF: s.startF,
      endF: s.endF,
      sampled: sampleFrames(s.startF, s.endF, opts.frames),
      beats: opts.beats
        ? [...new Set(s.beats.map((b) => b.frame).filter((f) => f >= s.startF && f < s.endF))].sort((a, b) => a - b)
        : [],
    }));
  const missing = (opts.scenes ?? []).filter((id) => !scenes.some((s) => s.id === id));
  if (missing.length) throw new Error(`no such scene(s) in timeline: ${missing.join(", ")}`);
  if (!scenes.length) throw new Error("no scenes selected");

  const out = join(projectDir, opts.out);
  const rawDir = join(out, "raw");
  mkdirSync(rawDir, { recursive: true });
  const wanted = [...new Set(scenes.flatMap((s) => [...s.sampled, ...s.beats]))].sort((a, b) => a - b);
  const grabbed = snapshotFrames(filmDir, wanted, join(out, ".snapshot-tmp"));

  const pathOf = new Map();
  for (const { file, frame } of grabbed) {
    const sceneOf = scenes.find((s) => frame >= s.startF && frame < s.endF);
    const dir = join(rawDir, sceneOf ? sceneOf.id : "other");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `frame-${frame}.png`);
    copyFileSync(join(out, ".snapshot-tmp", file), dest);
    pathOf.set(frame, dest);
  }
  rmSync(join(out, ".snapshot-tmp"), { recursive: true, force: true });

  const manifest = { fps: FPS, frames: opts.frames, sheets: [] };
  for (const s of scenes) {
    const row = join(out, `${s.id}.png`);
    ffmpegGrid(s.sampled.map((f) => pathOf.get(f)), row, s.sampled.length);
    manifest.sheets.push({ file: `${s.id}.png`, scene: s.id, frames: s.sampled });
    if (opts.beats && s.beats.length) {
      const beatSheet = join(out, `${s.id}-beats.png`);
      ffmpegGrid(s.beats.map((f) => pathOf.get(f)), beatSheet, BEAT_COLS);
      manifest.sheets.push({ file: `${s.id}-beats.png`, scene: s.id, frames: s.beats });
    }
  }
  if (opts.batch) {
    const batchPaths = scenes.flatMap((s) => s.sampled.map((f) => pathOf.get(f)));
    const batch = join(out, `batch-${opts.batch}.png`);
    ffmpegGrid(batchPaths, batch, opts.frames);
    manifest.sheets.push({ file: `batch-${opts.batch}.png`, scenes: scenes.map((s) => s.id), frames: opts.frames });
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const m = contactSheets(opts.dir, opts);
    for (const s of m.sheets) console.log(`wrote ${s.file}`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
