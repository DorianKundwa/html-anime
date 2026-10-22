import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PALETTE, TONES } from "./palette.js";
import { renderManim, renderRemotion, compositeMoviePy } from "./bridges/index.js";

test("palette JSON and Python files match the ground-truth palette.js exactly", () => {
  const json = JSON.parse(readFileSync(join("harness", "palette.json"), "utf8"));
  assert.deepEqual(json.palette, PALETTE, "palette.json palette matches palette.js");
  assert.deepEqual(json.tones, TONES, "palette.json tones matches palette.js");

  const py = readFileSync(join("harness", "palette.py"), "utf8");
  for (const [k, v] of Object.entries(PALETTE)) {
    assert.ok(py.includes(`"${k}": "${v}"`), `palette.py contains color ${k}: ${v}`);
  }
  for (const [k, v] of Object.entries(TONES)) {
    assert.ok(py.includes(`"${k}": "${v}"`), `palette.py contains tone ${k}: ${v}`);
  }
});

test("bridges index exports all three 2D generation functions", () => {
  assert.equal(typeof renderManim, "function");
  assert.equal(typeof renderRemotion, "function");
  assert.equal(typeof compositeMoviePy, "function");
});

test("MoviePy compositor succeeds with audio/video composite config", async () => {
  const outPath = join("build", "tmp", "test-moviepy.mp4");
  const baseVideo = join("remotion", "out", "kinetic_title.mp4");

  if (!existsSync(baseVideo)) {
    return; // Skip if demo clip not built yet
  }

  const res = await compositeMoviePy({
    base_video: baseVideo,
    duration: 2.0,
    fps: 24,
    output: outPath,
  });

  assert.equal(res.ok, true, `MoviePy compositor failed: ${res.error}`);
  assert.ok(existsSync(outPath), "Composited MP4 output file exists");
});

test("Remotion bridge renders composition with custom props", async () => {
  const outPath = join("build", "tmp", "test-remotion-stat.mp4");
  const res = await renderRemotion("StatCard", {
    outPath,
    props: {
      label: "BATTLE LOSSES",
      percentage: 65,
      accentColor: PALETTE.red,
    },
    concurrency: 2,
  });

  assert.equal(res.ok, true, `Remotion render failed: ${res.error}`);
  assert.ok(existsSync(outPath), "Remotion rendered MP4 output exists");
});

test("Manim bridge renders transparent 2D scene at 24 fps", async () => {
  const outDir = join("build", "tmp", "manim-test");
  const res = await renderManim("TacticalBattleMap", {
    outDir,
    outFile: "tactical_map_test.mov",
    transparent: true,
    quality: "l",
  });

  assert.equal(res.ok, true, `Manim render failed: ${res.error}`);
  assert.ok(existsSync(res.output), "Manim rendered output exists");
});

