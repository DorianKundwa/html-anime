/**
 * Contact-sheet helper tests. Run with `npm test`. node:test and node:assert only.
 * These cover the pure helpers; the snapshot and ffmpeg steps run on real projects.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL_H, CELL_W, frameTime, gridFilter, gridPositions, matchSnapshotNames, sampleFrames } from "./contact-sheet.js";

test("sampleFrames spreads frames evenly from the scene start", () => {
  assert.deepEqual(sampleFrames(0, 408, 4), [0, 102, 204, 306]);
  assert.deepEqual(sampleFrames(100, 200, 2), [100, 150]);
  assert.equal(sampleFrames(480, 504, 1)[0], 480, "a single frame is the scene start");
});

test("frameTime samples the middle of a frame, so it never lands on a boundary", () => {
  assert.equal(frameTime(0), 0.5 / 24);
  for (const f of [1, 24, 17850]) {
    const t = frameTime(f);
    assert.equal(Math.floor(t * 24), f, `frame ${f} maps back to itself`);
  }
});

test("matchSnapshotNames pairs rounded snapshot names with frames in order", () => {
  const files = ["at-774.707s.png", "at-0.021s.png", "at-4.271s.png"];
  assert.deepEqual(matchSnapshotNames(files, [102, 0, 204]), [
    { file: "at-0.021s.png", frame: 0 },
    { file: "at-4.271s.png", frame: 102 },
    { file: "at-774.707s.png", frame: 204 },
  ]);
});

test("matchSnapshotNames refuses a snapshot that wrote the wrong number of files", () => {
  assert.throws(() => matchSnapshotNames(["at-0s.png"], [0, 24]), /wrote 1 file\(s\) for 2 frame\(s\)/);
});

test("gridPositions lays cells out row by row", () => {
  assert.deepEqual(gridPositions(5, 2), [
    [0, 0],
    [CELL_W, 0],
    [0, CELL_H],
    [CELL_W, CELL_H],
    [0, 2 * CELL_H],
  ]);
});

test("gridFilter scales every input and tiles them with xstack", () => {
  const f = gridFilter(2, 2);
  assert.ok(f.includes(`[0:v]scale=${CELL_W}:${CELL_H},setsar=1[v0]`));
  assert.ok(f.endsWith(`xstack=inputs=2:layout=0_0|${CELL_W}_0[out]`));
});

test("gridFilter with one input is a plain scale", () => {
  assert.equal(gridFilter(1, 1), `[0:v]scale=${CELL_W}:${CELL_H},setsar=1[out]`);
});
