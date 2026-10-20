/**
 * Harness tests. Run with `npm test`. No dependencies: node:test and node:assert.
 * The fixture is harness/fixtures/tiny: a 20 s, two-scene sheet with four cues.
 * Every hard-error case edits a copy of the fixture, so the fixture stays valid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject, renderBrief } from "./compile.js";
import {
  buildCaptionBlocks,
  buildTimeline,
  correctCues,
  parseClock,
  parseSceneSheet,
  parseTranscript,
  toFrame,
  toSrt,
  wrapLines,
} from "./ingest.js";
import { offPaletteColors } from "./palette.js";
import { checkFilm } from "./check-film.js";
import { inlineLibrary, readSymbols } from "./inline-library.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "tiny");
const AUDIO_SECONDS = 20;

function fixtureText(name) {
  return readFileSync(join(FIXTURE, name), "utf8");
}

/** Copies the fixture into a fresh temp dir, then applies one exact-text edit to one file. */
function tempProject(edit) {
  const dir = mkdtempSync(join(tmpdir(), "doodle-test-"));
  for (const f of ["transcript.txt", "script.txt", "scene_sheet.md"]) cpSync(join(FIXTURE, f), join(dir, f));
  if (edit) {
    const path = join(dir, edit.file);
    const before = readFileSync(path, "utf8");
    assert.ok(before.includes(edit.from), `fixture ${edit.file} lacks: ${edit.from}`);
    writeFileSync(path, before.replace(edit.from, edit.to));
  }
  return dir;
}

async function compileEdited(edit) {
  return compileProject(tempProject(edit), { audioSeconds: AUDIO_SECONDS });
}

function assertHardError(res, pattern) {
  assert.equal(res.ok, false, "expected a hard error, got ok");
  assert.ok(
    res.errors.some((e) => e.includes(pattern)),
    `no error containing "${pattern}". Got:\n${res.errors.join("\n")}`,
  );
}

// ---------- parsing ----------

test("parseClock reads m:ss, m:ss.s and h:mm:ss", () => {
  assert.equal(parseClock("0:33"), 33);
  assert.equal(parseClock("1:05"), 65);
  assert.equal(parseClock("0:33.5"), 33.5);
  assert.equal(parseClock("1:02:03"), 3723);
  assert.throws(() => parseClock("abc"), /bad timestamp/);
});

test("parseTranscript returns numbered cues with seconds", () => {
  const cues = parseTranscript(fixtureText("transcript.txt"));
  assert.equal(cues.length, 4);
  assert.deepEqual(cues.map((c) => c.n), [1, 2, 3, 4]);
  assert.deepEqual(cues.map((c) => c.t), [0, 4, 10, 14]);
  assert.equal(cues[0].text, "The serial box story starts here.");
});

test("parseTranscript rejects a line that is not a cue", () => {
  assert.throws(() => parseTranscript("[0:00] ok\nno timestamp here\n"), /not a cue/);
});

test("parseTranscript rejects timestamps that go backwards", () => {
  assert.throws(() => parseTranscript("[0:10] a\n[0:05] b\n"), /backwards/);
});

test("parseSceneSheet reads CAST, PROPS and every card", () => {
  const { cast, props, scenes } = parseSceneSheet(fixtureText("scene_sheet.md"));
  assert.ok("INVESTIGATOR" in cast);
  assert.ok("CEREAL-BOX" in props);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].bg, "sky");
  assert.equal(scenes[0].start, 0);
  assert.equal(scenes[0].end, 10);
  assert.equal(scenes[0].beats.length, 5);
  assert.equal(scenes[0].beats[2].verb, "POP");
  assert.equal(scenes[0].texts[0].color, "red");
  assert.equal(scenes[1].end, "END");
  assert.equal(scenes[1].camera, "push");
});

test("parseSceneSheet accepts an en dash in the card header", () => {
  const md = "## S01 | 0:00\u20130:10 | cues 1-1 | bg=sky\nBEATS:\n- 0:00.0 POP x\n";
  const { scenes } = parseSceneSheet(md);
  assert.equal(scenes[0].end, 10);
});

// ---------- captions ----------

test("correctCues aligns the transcript to the script and records each change", () => {
  const cues = parseTranscript(fixtureText("transcript.txt"));
  const { cues: fixed, diffs, warnings } = correctCues(cues, fixtureText("script.txt"));
  assert.deepEqual(warnings, []);
  assert.equal(fixed[0].text, "The cereal box story starts here.");
  assert.equal(fixed[1].text, "The Oseberg ship was buried in Norway.");
  assert.equal(fixed[2].text, "Alcuin wrote about raiding.");
  assert.equal(fixed[3].text, "The invoice came later.");
  assert.equal(diffs.length, 3, "cue 4 already matched the script, so it is not in the diff");
  assert.equal(diffs[0].old, "The serial box story starts here.");
});

test("correctCues without a script keeps the transcript and warns", () => {
  const cues = parseTranscript(fixtureText("transcript.txt"));
  const { cues: kept, diffs, warnings } = correctCues(cues, null);
  assert.deepEqual(diffs, []);
  assert.equal(warnings.length, 1);
  assert.equal(kept[0].text, cues[0].text);
});

test("wrapLines keeps every line within 42 characters", () => {
  const lines = wrapLines("word ".repeat(40).trim());
  assert.ok(lines.length > 2);
  assert.ok(lines.every((l) => l.length <= 42), lines.join("|"));
});

test("a cue longer than two lines is split into timed blocks that meet end to end", () => {
  const cues = [
    { n: 1, t: 0, text: "word ".repeat(40).trim() },
    { n: 2, t: 10, text: "Short." },
  ];
  const blocks = buildCaptionBlocks(cues, AUDIO_SECONDS);
  const first = blocks.filter((b) => b.cue === 1);
  assert.ok(first.length > 1, "long cue should be split");
  assert.equal(first[0].startF, 0);
  assert.equal(first[first.length - 1].endF, toFrame(10));
  for (let k = 1; k < first.length; k++) assert.equal(first[k].startF, first[k - 1].endF);
  assert.ok(blocks.every((b) => b.lines.length <= 2 && b.lines.every((l) => l.length <= 42)));
  const last = blocks.filter((b) => b.cue === 2);
  assert.deepEqual([last[0].startF, last[0].endF], [toFrame(10), toFrame(AUDIO_SECONDS)]);
});

test("toSrt writes numbered blocks with comma milliseconds", () => {
  const cues = parseTranscript(fixtureText("transcript.txt"));
  const fixed = correctCues(cues, fixtureText("script.txt")).cues;
  const tl = buildTimeline({ cues: fixed, scenes: parseSceneSheet(fixtureText("scene_sheet.md")).scenes, audioSeconds: AUDIO_SECONDS });
  const srt = toSrt(tl.captions);
  assert.ok(srt.startsWith("1\n00:00:00,000 --> 00:00:04,000\nThe cereal box story starts here.\n"), srt);
  assert.ok(srt.includes("00:00:10,000 --> 00:00:14,000"));
});

// ---------- frame math ----------

test("toFrame rounds seconds to whole frames at 24 fps", () => {
  assert.equal(toFrame(0.5), 12);
  assert.equal(toFrame(33.04), 793);
  assert.equal(toFrame(10), 240);
});

test("buildTimeline puts every time on an integer frame and sums to the root", () => {
  const cues = parseTranscript(fixtureText("transcript.txt"));
  const { scenes } = parseSceneSheet(fixtureText("scene_sheet.md"));
  const tl = buildTimeline({ cues, scenes, audioSeconds: AUDIO_SECONDS });
  assert.equal(tl.totalFrames, 480);
  assert.deepEqual(tl.scenes.map((s) => [s.startF, s.endF]), [[0, 240], [240, 480]]);
  assert.deepEqual(tl.cues.map((c) => c.frame), [0, 96, 240, 336]);
  assert.deepEqual(tl.scenes[0].beats.map((b) => b.frame), [0, 48, 96, 144, 192]);
  const all = [...tl.scenes.flatMap((s) => [s.startF, s.endF, ...s.beats.map((b) => b.frame)]), ...tl.cues.map((c) => c.frame)];
  assert.ok(all.every(Number.isInteger));
  assert.equal(tl.scenes.reduce((a, s) => a + s.frames, 0), tl.totalFrames);
});

test("a fractional audio length still gives an integer root frame count", () => {
  const cues = parseTranscript(fixtureText("transcript.txt"));
  const { scenes } = parseSceneSheet(fixtureText("scene_sheet.md"));
  const tl = buildTimeline({ cues, scenes, audioSeconds: 20.02 });
  assert.equal(tl.totalFrames, 480);
  assert.equal(tl.scenes.at(-1).endF, 480);
});

// ---------- compile ----------

test("compileProject on the fixture writes the build files and captions.srt", async () => {
  const dir = tempProject();
  const res = await compileProject(dir, { audioSeconds: AUDIO_SECONDS });
  assert.equal(res.ok, true, res.errors.join("\n"));
  assert.deepEqual(res.errors, []);
  assert.equal(res.counts.cues, 4);
  assert.equal(res.counts.scenes, 2);
  assert.equal(res.counts.totalFrames, 480);
  assert.equal(res.counts.captionSubstitutions, 3);
  assert.ok(res.warnings.some((w) => /no change/.test(w)), "the 4 s gap in S02 should warn");

  for (const f of ["build/timeline.json", "build/brief.md", "build/captions-diff.md", "captions.srt"]) {
    assert.ok(existsSync(join(dir, f)), `missing ${f}`);
  }
  const tl = JSON.parse(readFileSync(join(dir, "build/timeline.json"), "utf8"));
  assert.equal(tl.scenes[1].startF, 240);
  const brief = readFileSync(join(dir, "build/brief.md"), "utf8");
  assert.ok(brief.includes("frame 0 POP INVESTIGATOR enters on the left"));
  assert.ok(brief.includes("## S02: frames 240"));
});

test("compileProject without audio and without a length reports the missing file", async () => {
  const res = await compileProject(tempProject());
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("missing audio")));
});

test("a hard error stops the compile and writes nothing", async () => {
  const dir = tempProject({ file: "scene_sheet.md", from: "bg=sky", to: "bg=mauve" });
  const res = await compileProject(dir, { audioSeconds: AUDIO_SECONDS });
  assert.equal(res.ok, false);
  assert.equal(existsSync(join(dir, "build")), false);
  assert.equal(existsSync(join(dir, "captions.srt")), false);
});

// ---------- hard errors: each one must stop the compile ----------

test("hard error: a background token that is not in the spec", async () => {
  assertHardError(await compileEdited({ file: "scene_sheet.md", from: "bg=sky", to: "bg=mauve" }), "bg=mauve is not a background token");
});

test("hard error: a headline color that breaks the contrast table", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "| red | \"THE CEREAL", to: "| yellow | \"THE CEREAL" }),
    "breaks the contrast table",
  );
});

test("hard error: a headline color that is not in the spec", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "| black | \"LATER\"", to: "| cobalt | \"LATER\"" }),
    "TEXT color cobalt is not in the spec",
  );
});

test("hard error: a beat verb that is not in the spec", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "- 0:04.0 POP", to: "- 0:04.0 BOUNCE" }),
    "beat verb BOUNCE is not in the spec",
  );
});

test("hard error: an OUT value that is not in the spec", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "OUT: hard-cut\n\n## S02", to: "OUT: fade\n\n## S02" }),
    "OUT fade is not in the spec",
  );
});

test("hard error: a color-dip to a token that is not in the palette", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "OUT: hard-cut\n\n## S02", to: "OUT: color-dip(mauve)\n\n## S02" }),
    "color-dip(mauve) is not a palette token",
  );
});

test("hard error: scenes that do not join end to start", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "## S02 | 0:10-END", to: "## S02 | 0:11-END" }),
    "but the previous scene ends at",
  );
});

test("hard error: the last scene does not end at END", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "## S02 | 0:10-END", to: "## S02 | 0:10-0:20" }),
    "the last scene must end at END",
  );
});

test("hard error: a beat outside its scene", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "- 0:08.0 SHAKE", to: "- 0:12.0 SHAKE" }),
    "beat 0:12 is outside the scene",
  );
});

test("hard error: cue ranges that run past the transcript", async () => {
  assertHardError(
    await compileEdited({ file: "scene_sheet.md", from: "cues 3-4 | bg=white", to: "cues 3-5 | bg=white" }),
    "cues 3-5 are outside 1..4",
  );
});

test("hard error: a cue timestamp that does not match its scene start", async () => {
  assertHardError(
    await compileEdited({ file: "transcript.txt", from: "[0:10] Alquin", to: "[0:11] Alquin" }),
    "is not the timestamp of cue 3",
  );
});

test("hard error: a transcript that is not the sheet's cue count", async () => {
  assertHardError(
    await compileEdited({ file: "transcript.txt", from: "[0:14] The invoice came later.\n", to: "" }),
    "the last scene must cover through cue 3",
  );
});

// ---------- palette and frame-lock helpers ----------

test("offPaletteColors flags colors outside the palette and nothing else", () => {
  const css = "fill: #F5820D; stroke: #f5820d; color: #123456; background: rgb(1,2,3); fill: #fff;";
  const found = offPaletteColors(css);
  assert.ok(found.includes("#123456"));
  assert.ok(found.includes("rgb("));
  assert.ok(!found.includes("#F5820D"));
  assert.ok(!found.includes("#f5820d"));
});

test("renderBrief names the palette and the rules the agent draws under", async () => {
  const dir = tempProject();
  const res = await compileProject(dir, { audioSeconds: AUDIO_SECONDS });
  const brief = renderBrief(res.timeline, "tiny");
  assert.ok(brief.includes("## Palette"));
  assert.ok(brief.includes("- night #1B2A4A"));
  assert.ok(brief.includes("zero gradients"));
});

// ---------- film gates ----------

test("checkFilm passes a clean film and fails on an off-palette color", () => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "film"), { recursive: true });
  writeFileSync(join(dir, "film", "index.html"), '<div data-duration="20" style="color:#FFFFFF"></div>');
  assert.deepEqual(checkFilm(dir).errors, []);
  writeFileSync(join(dir, "film", "index.html"), '<div data-duration="20" style="color:#123456"></div>');
  assert.ok(checkFilm(dir).errors.some((e) => e.includes("#123456")));
});

test("checkFilm flags banned tokens and a root duration that is not the audio", () => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  mkdirSync(join(dir, "film"), { recursive: true });
  mkdirSync(join(dir, "build"), { recursive: true });
  writeFileSync(join(dir, "build", "timeline.json"), JSON.stringify({ fps: 24, totalFrames: 480 }));
  writeFileSync(join(dir, "film", "index.html"), '<div data-duration="19" style="background:linear-gradient(red,blue)"></div>');
  const { errors } = checkFilm(dir);
  assert.ok(errors.some((e) => e.includes("gradient")));
  assert.ok(errors.some((e) => e.includes("is not the audio's 480 frames")));
});

test("checkFilm reports a missing film directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "film-"));
  assert.equal(checkFilm(dir).errors.length, 1);
});

// ---------- library inlining ----------

const LIB = '<svg><symbol id="head" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></symbol><symbol id="box"><rect width="4" height="4"/></symbol></svg>';

test("readSymbols maps each symbol id to its markup", () => {
  const syms = readSymbols(LIB);
  assert.deepEqual([...syms.keys()], ["head", "box"]);
  assert.ok(syms.get("box").startsWith("<symbol"));
});

test("inlineLibrary adds only the symbols a scene uses, once, and rerunning is stable", () => {
  const scene = '<html><body><svg><use href="#head"/></svg></body></html>';
  const once = inlineLibrary(scene, readSymbols(LIB));
  assert.ok(once.includes('<symbol id="head"'));
  assert.ok(!once.includes('<symbol id="box"'));
  assert.equal(inlineLibrary(once, readSymbols(LIB)), once);
});

test("inlineLibrary fails on a symbol the library does not define", () => {
  const scene = '<body><use xlink:href="#missing"/></body>';
  assert.throws(() => inlineLibrary(scene, readSymbols(LIB)), /missing/);
});
