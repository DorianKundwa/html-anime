/**
 * Film generator tests. Run with `npm test`. No dependencies: node:test and node:assert.
 * The project is synthetic: 600 s of narration (no real audio is read), 60 ten-second
 * scenes that share one cast, so the test covers the long-film path end to end.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject } from "./compile.js";
import { buildFilm, fallDrop } from "./build-film.js";
import { PROP_ALIASES } from "./build-film.js";
import { checkFilm } from "./check-film.js";
import { PALETTE } from "./palette.js";
import { readSymbols } from "./inline-library.js";

const here = dirname(fileURLToPath(import.meta.url));
const LIBRARY = readFileSync(join(here, "..", "assets", "library.svg"), "utf8");
const SCENES = 60;
const SECONDS = 600;
const PER_SCENE = SECONDS / SCENES;
const FRAMES = SECONDS * 24;

test("the props of the sample's pilot scenes are drawn in the library, not left as placeholders", () => {
  const symbols = readSymbols(LIBRARY);
  for (const name of ["dryer", "green-backpack", "folding-table", "phone", "thought-bubble", "city-skyline", "job-letter", "cult-stereotype", "moon-window"]) {
    assert.ok(symbols.has(`prop-${name}`), `library has no prop-${name}`);
  }
});

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const pad = (n) => String(n).padStart(2, "0");

/** A 10-minute project: one cue every 5 s, two cues per scene, the same cast in every scene. */
function longProject() {
  const dir = mkdtempSync(join(tmpdir(), "doodle-long-"));
  mkdirSync(join(dir, "audio"));
  writeFileSync(join(dir, "audio", "narration.mp3"), "not real audio: the test passes audioSeconds");

  const cues = [];
  for (let k = 0; k < SECONDS / 5; k++) cues.push(`[${clock(k * 5)}] Line ${k + 1} of the narration.`);
  writeFileSync(join(dir, "transcript.txt"), cues.join("\n") + "\n");

  const cards = [];
  for (let k = 0; k < SCENES; k++) {
    const start = k * PER_SCENE;
    const end = k === SCENES - 1 ? "END" : clock((k + 1) * PER_SCENE);
    const bg = k % 2 ? "white" : "sky";
    const headline = k % 2 ? "black" : "red";
    const camera = k % 2 ? "push" : "lock";
    const out = ["color-dip(black)", "wipe-left", "hard-cut"][k % 3];
    cards.push(
      `## S${pad(k + 1)} | ${clock(start)}-${end} | cues ${2 * k + 1}-${2 * k + 2} | bg=${bg}`,
      "CAST: INVESTIGATOR, WITNESS",
      "PROPS: CEREAL-BOX",
      "LAYOUT: INVESTIGATOR in the left third, WITNESS in the right third",
      "BEATS:",
      `- ${clock(start)}.0 POP INVESTIGATOR enters on the left`,
      `- ${clock(start + 2)}.0 SWAP INVESTIGATOR's brows to raised`,
      `- ${clock(start + 4)}.0 POP WITNESS appears at the right`,
      `- ${clock(start + 6)}.0 DRAW a black arrow from INVESTIGATOR to WITNESS`,
      `TEXT: top | ${headline} | "SCENE ${k + 1}" @${clock(start)}.0`,
      `CAMERA: ${camera}`,
      `OUT: ${out}`,
      "",
    );
  }
  const sheet = [
    "## CAST",
    "INVESTIGATOR: stick figure, large white circle head, dot eyes, thick brow lines, black stick body",
    "WITNESS: stick figure, large white circle head, dot eyes, thick brow lines, black stick body",
    "",
    "## PROPS",
    "CEREAL-BOX: chunky orange box, black outline",
    "PHONE: flat black phone, white screen",
    "FOLDING-TABLE: brown folding table, black outline",
    "",
    ...cards,
  ];
  writeFileSync(join(dir, "scene_sheet.md"), sheet.join("\n"));
  return dir;
}

async function compiled(dir) {
  const res = await compileProject(dir, { audioSeconds: SECONDS });
  assert.equal(res.ok, true, `compile failed:\n${(res.errors ?? []).join("\n")}`);
  return JSON.parse(readFileSync(join(dir, "build", "timeline.json"), "utf8"));
}

/** Adds beats to a compiled project's scene, to exercise the generator's own checks. */
function addBeats(dir, scene, beats) {
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.scenes[scene].beats.push(...beats);
  writeFileSync(path, JSON.stringify(tl));
}

test("a 10-minute, 60-scene film compiles, builds and passes the film gates", async () => {
  const dir = longProject();
  const tl = await compiled(dir);
  assert.equal(tl.scenes.length, SCENES);
  assert.equal(tl.totalFrames, FRAMES);

  const built = buildFilm(dir);
  assert.equal(built.ok, true, built.errors.join("\n"));
  assert.equal(built.files.length, SCENES + SECONDS / 60 + 1, "one file per scene, one captions file per minute, plus the root");

  const root = readFileSync(join(dir, "film", "index.html"), "utf8");
  assert.ok(root.includes(`data-duration="${SECONDS}"`), "root data-duration is the audio length");
  assert.ok(root.includes('data-fps="24"'), "root declares 24 fps, so the render does not default to 30");
  const clips = [
    ...root.matchAll(/data-composition-src="compositions\/(s\d\d)\.html" data-start="([\d.]+)" data-duration="([\d.]+)"/g),
  ];
  assert.equal(clips.length, SCENES, "one clip per scene");

  // Scene frames tile the root exactly: each starts where the last one ended.
  let cursor = 0;
  for (const m of clips) {
    assert.equal(Math.round(parseFloat(m[2]) * 24), cursor, `${m[1]} starts at frame ${cursor}`);
    cursor += Math.round(parseFloat(m[3]) * 24);
  }
  assert.equal(cursor, FRAMES, "scene frames sum to the root frame count");

  // Captions are split one file per minute, and each minute's clip covers exactly that minute.
  const captionClips = [
    ...root.matchAll(/data-composition-src="compositions\/(captions-\d\d)\.html" data-start="([\d.]+)" data-duration="([\d.]+)"/g),
  ];
  assert.equal(captionClips.length, SECONDS / 60, "one captions clip per minute");
  captionClips.forEach((m, k) => {
    assert.equal(m[1], `captions-${pad(k + 1)}`);
    assert.equal(Math.round(parseFloat(m[2]) * 24), k * 1440, `${m[1]} starts at its minute`);
    assert.equal(Math.round(parseFloat(m[3]) * 24), 1440, `${m[1]} covers one minute`);
  });
  // Caption times in a minute file are frames counted from that minute's start, so none exceed 1440 (60 s at 24 fps).
  const second = readFileSync(join(dir, "film", "compositions", "captions-02.html"), "utf8");
  const times = [...second.matchAll(/\{ opacity: \d \}, f\(([\d.]+)\)/g)].map((m) => parseFloat(m[1]));
  assert.ok(times.length > 0, "captions-02 has caption timings");
  assert.ok(times.every((t) => t >= 0 && t <= 1440), "captions-02 times are local to its minute");

  // One rig everywhere: every scene carries the same library symbols, byte for byte.
  const rigBody = /<symbol id="rig-body"[\s\S]*?<\/symbol>/.exec(LIBRARY)[0];
  for (let k = 1; k <= SCENES; k++) {
    const scene = readFileSync(join(dir, "film", "compositions", `s${pad(k)}.html`), "utf8");
    assert.ok(scene.includes(rigBody), `s${pad(k)} inlines the shared rig-body symbol`);
  }

  const gates = checkFilm(dir);
  assert.deepEqual(gates.errors, [], gates.errors.join("\n"));
});

test("building the same project twice gives the same bytes", async () => {
  const dir = longProject();
  await compiled(dir);
  const read = () => ({
    root: readFileSync(join(dir, "film", "index.html"), "utf8"),
    scene: readFileSync(join(dir, "film", "compositions", "s30.html"), "utf8"),
    captions: readFileSync(join(dir, "film", "compositions", "captions-01.html"), "utf8"),
  });
  assert.equal(buildFilm(dir).ok, true);
  const first = read();
  assert.equal(buildFilm(dir).ok, true);
  assert.deepEqual(read(), first);
});

test("too many poses for one actor in a scene is a hard error, and nothing is written", async () => {
  const dir = longProject();
  await compiled(dir);
  // Scene 1's card already has one SWAP (raised = shock). Four more expressions push INVESTIGATOR past the limit of 3.
  addBeats(dir, 0, [
    { frame: 30, verb: "SWAP", text: "INVESTIGATOR's face to angry" },
    { frame: 60, verb: "SWAP", text: "INVESTIGATOR's face to sly" },
    { frame: 90, verb: "SWAP", text: "INVESTIGATOR's face to sweat" },
    { frame: 120, verb: "SWAP", text: "INVESTIGATOR's face to confused" },
  ]);
  const res = buildFilm(dir);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => /^S01: INVESTIGATOR takes \d+ poses; the limit is 3/.test(e)),
    res.errors.join("\n"),
  );
  assert.equal(existsSync(join(dir, "film")), false, "a failed build writes no film files");
});

test("a SWAP with no known expression word is a hard error, not a crash", async () => {
  const dir = longProject();
  await compiled(dir);
  addBeats(dir, 1, [{ frame: 300, verb: "SWAP", text: "INVESTIGATOR's brows to purple" }]);
  const res = buildFilm(dir);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("no known expression word")), res.errors.join("\n"));
});

test("two entries named in one LAYOUT anchor are spread apart, not stacked", async () => {
  const dir = longProject();
  await compiled(dir);
  // Scene 1: two props both "low in the center". They must not share an x.
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  // A third prop is not named in the LAYOUT clause, so it must also keep clear of the two named ones.
  tl.scenes[0].props = ["CEREAL-BOX", "PHONE", "FOLDING-TABLE"];
  tl.scenes[0].layout = "CEREAL-BOX and PHONE low in the center";
  writeFileSync(path, JSON.stringify(tl));
  assert.equal(buildFilm(dir).ok, true);
  const scene = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  // Two cast entries come first, so the props are s01-e2, s01-e3 and s01-e4.
  const left = (id) => Number(new RegExp(`id="${id}" class="actor" style="left:(-?\\d+)px`).exec(scene)[1]);
  for (const [a, b] of [["s01-e2", "s01-e3"], ["s01-e2", "s01-e4"], ["s01-e3", "s01-e4"]]) {
    const gap = Math.abs(left(a) - left(b));
    assert.ok(gap >= 240, `${a} and ${b} are ${gap}px apart; a 240px prop needs at least 240px`);
  }
});

test("a prop label on a dark background uses the spec's text colour, and a slide starts at its own beat", async () => {
  const dir = longProject();
  // Every scene slides WITNESS in, so the scene has slide tweens to check.
  const sheetPath = join(dir, "scene_sheet.md");
  writeFileSync(sheetPath, readFileSync(sheetPath, "utf8").replaceAll("POP WITNESS appears at the right", "SLIDE WITNESS in from the right"));
  await compiled(dir);
  // Inject a synthetic unmapped prop into scene 1 so propMarkup falls back to the labelled-box path.
  // This is independent of PROP_ALIASES completeness.
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.scenes[0].bg = "night";
  // Append the unknown prop name to scene 1's props list and register it in dict.props.
  tl.scenes[0].props = [...(tl.scenes[0].props ?? []), "XTEST-UNKNOWN-PROP"];
  if (!tl.dict) tl.dict = {};
  if (!tl.dict.props) tl.dict.props = {};
  tl.dict.props["XTEST-UNKNOWN-PROP"] = "chunky orange prop, black outline";
  writeFileSync(path, JSON.stringify(tl));
  assert.equal(buildFilm(dir).ok, true);
  const scene = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  // Scene 1 on night: black text there is unreadable, so the label must be yellow (CONTRAST.night).
  const label = /<text x="120" y="-14"[^>]*fill="([^"]+)"/.exec(scene);
  assert.ok(label, "the prop label is in the scene");
  assert.equal(label[1], PALETTE.yellow);
  // A slide that is not at time zero must not apply its start position when the page loads,
  // or the prop sits on top of its neighbour until its own beat.
  const slides = scene.split("\n").filter((l) => /tl\.fromTo\("#s01-e\d+", \{ x:/.test(l));
  assert.ok(slides.length > 0, "the scene has at least one slide");
  for (const l of slides) assert.ok(l.includes("immediateRender: false"), `slide without immediateRender: ${l}`);
});

test("actors stay above the subtitle zone (y 864) in every scene", async () => {
  const dir = longProject();
  await compiled(dir);
  assert.equal(buildFilm(dir).ok, true);
  // The rig's feet are at rig y 320, and the box spans rig y -110..350, so the feet sit at
  // (320 + 110) / 460 of the box height. Only the feet must sit above the subtitle zone.
  for (let k = 1; k <= SCENES; k++) {
    const scene = readFileSync(join(dir, "film", "compositions", `s${pad(k)}.html`), "utf8");
    for (const m of scene.matchAll(/class="actor" style="left:-?\d+px;top:(-?\d+)px;width:\d+px;height:(\d+)px/g)) {
      const feet = Number(m[1]) + Math.round((430 / 460) * Number(m[2]));
      assert.ok(feet <= 864, `s${pad(k)} actor feet at y ${feet} run into the subtitle zone (864)`);
    }
  }
});

test("a falling actor is cut short so its feet stay above the subtitle zone", () => {
  const actor = { kind: "actor", scale: 1, crowd: 1, framing: "normal", cx: 400 };
  // Actors are always placed with their feet on GROUND (850), whatever their scale, so only
  // 14px remain above the caption band (864). A fall asking for more is cut to that.
  for (const scale of [0.5, 1, 1.4]) assert.equal(fallDrop({ ...actor, scale }, 160), 14);
  // A fall that already fits is kept as asked.
  assert.equal(fallDrop(actor, 5), 5);
});

test("a missing timeline asks for the compile step", () => {
  const dir = mkdtempSync(join(tmpdir(), "doodle-empty-"));
  const res = buildFilm(dir);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /run the compile step first/);
});

/** Every prop a project names, from the card lines and from the PROPS sections. */
function propNames(sheet) {
  const names = new Set();
  for (const m of sheet.matchAll(/^PROPS:\s*(.+)$/gm)) {
    for (const w of m[1].split(/[,\n]/)) {
      const n = w.trim().split(/\s+/)[0];
      if (n && /^[A-Z][A-Z-]*$/.test(n)) names.add(n);
    }
  }
  for (const m of sheet.matchAll(/^## PROPS[^\n]*\n([\s\S]*?)(?=^## |\Z)/gm)) {
    for (const line of m[1].split("\n")) {
      const n = /^([A-Z][A-Z-]+):/.exec(line)?.[1];
      if (n) names.add(n);
    }
  }
  return [...names];
}

test("every prop a project names is drawn, not a labelled box", () => {
  const symbols = readSymbols(LIBRARY);
  for (const slug of ["sample", "sample-2min", "harbor"]) {
    const path = join(here, "..", "projects", slug, "scene_sheet.md");
    if (!existsSync(path)) continue;
    const names = propNames(readFileSync(path, "utf8"));
    assert.ok(names.length, `${slug} names no props`);
    const missing = names.filter((n) => !symbols.has(PROP_ALIASES[n] ?? `prop-${n.toLowerCase()}`));
    assert.deepEqual(missing, [], `${slug}: no drawn symbol for ${missing.join(", ")}`);
  }
});

test("a built film has no prop left as a labelled rectangle", async () => {
  const dir = longProject();
  await compiled(dir);
  assert.equal(buildFilm(dir).ok, true);
  const scene = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  assert.ok(!scene.includes('x="5" y="5" width="230"'), "the scene still draws a prop as a labelled box");
});

test("environment set backdrop renders wide behind actors without displacing them", async () => {
  const dir = longProject();
  await compiled(dir);
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.scenes[0].props = ["ENV-OFFICE", "CEREAL-BOX"];
  tl.scenes[0].layout = "INVESTIGATOR in the left third, WITNESS in the right third";
  writeFileSync(path, JSON.stringify(tl));
  assert.equal(buildFilm(dir).ok, true);
  const scene = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  assert.ok(scene.includes('class="actor env-backdrop"'), "renders env backdrop element");
  assert.ok(scene.includes('width="1920"'), "env backdrop spans wide stage");
  const envIndex = scene.indexOf('class="actor env-backdrop"');
  const actorIndex = scene.indexOf('id="s01-e0" class="actor"');
  assert.ok(envIndex < actorIndex, "env backdrop is rendered before actors in the ink layer");
});

test("actors maintain inter-scene position continuity across consecutive cuts", async () => {
  const dir = longProject();
  await compiled(dir);
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.scenes[0].layout = "INVESTIGATOR in the left third, WITNESS in the right third";
  tl.scenes[1].cast = ["INVESTIGATOR"];
  tl.scenes[1].props = [];
  tl.scenes[1].layout = "INVESTIGATOR holds evidence folder";
  writeFileSync(path, JSON.stringify(tl));
  assert.equal(buildFilm(dir).ok, true);
  const s02 = readFileSync(join(dir, "film", "compositions", "s02.html"), "utf8");
  const leftS02 = Number(/id="s02-e0" class="actor" style="left:(-?\d+)px/.exec(s02)[1]);
  assert.ok(leftS02 < 500, `INVESTIGATOR in s02 should stay on the left (${leftS02}px), not jump to center`);
});

test("historical costumes, hats, expressions and OverSimplified defeat tumble render accurately", async () => {
  const dir = longProject();
  await compiled(dir);
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.cast["INVESTIGATOR"] = "stick figure, white head, yellow crown, cobalt cape, grey armor";
  tl.cast["WITNESS"] = "stick figure, white head, grey helmet, red tunic";
  tl.scenes[0].beats = [
    { frame: 24, verb: "SWAP", text: "INVESTIGATOR falls dead" },
    { frame: 48, verb: "SWAP", text: "WITNESS's face to evil" },
  ];
  writeFileSync(path, JSON.stringify(tl));
  const res = buildFilm(dir);
  assert.equal(res.ok, true, `build failed: ${res.errors?.join("\n")}`);
  const s01 = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  assert.ok(s01.includes('href="#rig-hat-crown"'), "includes royal crown hat");
  assert.ok(s01.includes('href="#rig-cape"'), "includes cape garment");
  assert.ok(s01.includes('href="#rig-armor"'), "includes knight armor");
  assert.ok(s01.includes('href="#rig-hat-helmet"'), "includes warrior helmet");
  assert.ok(s01.includes('href="#rig-tunic"'), "includes historical tunic");
  assert.ok(s01.includes('rotation: 90') || s01.includes('rotation: -90'), "includes comedic 90-degree tumble rotation");
  assert.ok(s01.includes('ease: "bounce.out"'), "includes comedic bounce ease");
});

test("historical props and castle environment render cleanly with zero placeholders", async () => {
  const dir = longProject();
  await compiled(dir);
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.scenes[0].props = ["ENV-CASTLE", "SWORD", "SHIELD", "CROWN", "SCROLL"];
  writeFileSync(path, JSON.stringify(tl));
  const res = buildFilm(dir);
  assert.equal(res.ok, true, `build failed: ${res.errors?.join("\n")}`);
  const s01 = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  assert.ok(s01.includes('href="#prop-env-castle"'), "inlines castle environment set");
  assert.ok(s01.includes('href="#prop-sword"'), "inlines sword prop");
  assert.ok(s01.includes('href="#prop-shield"'), "inlines shield prop");
  assert.ok(s01.includes('href="#prop-crown"'), "inlines crown prop");
  assert.ok(s01.includes('href="#prop-scroll"'), "inlines scroll prop");
  const gates = checkFilm(dir);
  assert.deepEqual(gates.errors, [], `film gates failed:\n${gates.errors.join("\n")}`);
});

test("OverSimplified Three Kingdoms rigs, historical headwear, beards, fight clouds, and mud falls render accurately", async () => {
  const dir = longProject();
  await compiled(dir);
  const path = join(dir, "build", "timeline.json");
  const tl = JSON.parse(readFileSync(path, "utf8"));
  tl.cast["DONG ZHUO"] = "pill body in dark blue hanfu robe, warlord full beard, beaded imperial crown";
  tl.cast["LU BU"] = "pill body in red chinese robe, pheasant plume helm";
  tl.cast["SIMA YI"] = "pill body, black scholar hat futou, trimmed goatee";
  tl.cast["REBEL"] = "pill body, yellow turban headband";
  tl.props = {
    "ENV-CHINESE-PALACE": "imperial palace court backdrop with tiered glazed roofs and red columns",
    "FIGHT-CLOUD": "cartoon billowing fight cloud with action stars and dust",
    "MUD-PUDDLE": "slapstick mud puddle with splashes",
    "CLASH-SPARK": "weapon clash impact spark",
  };
  tl.scenes[0].cast = ["DONG ZHUO", "LU BU"];
  tl.scenes[0].props = ["ENV-CHINESE-PALACE", "FIGHT-CLOUD", "MUD-PUDDLE", "CLASH-SPARK"];
  tl.scenes[0].beats = [
    { frame: 24, verb: "POP", text: "POP FIGHT-CLOUD between DONG ZHUO and LU BU" },
    { frame: 48, verb: "POP", text: "POP CLASH-SPARK above" },
    { frame: 72, verb: "SWAP", text: "DONG ZHUO falls in mud puddle" },
  ];
  writeFileSync(path, JSON.stringify(tl));
  const res = buildFilm(dir);
  assert.equal(res.ok, true, `build failed: ${res.errors?.join("\n")}`);
  const s01 = readFileSync(join(dir, "film", "compositions", "s01.html"), "utf8");
  assert.ok(s01.includes('href="#rig-body-pill"'), "inlines OverSimplified pill body rig");
  assert.ok(s01.includes('href="#rig-hat-mianliu"'), "inlines imperial beaded crown mianliu");
  assert.ok(s01.includes('href="#rig-helmet-lubu"'), "inlines Lu Bu pheasant plume warlord helmet");
  assert.ok(s01.includes('href="#rig-beard-full"'), "inlines warlord full beard");
  assert.ok(s01.includes('href="#prop-env-chinese-palace"'), "inlines Chinese palace environment set");
  assert.ok(s01.includes('href="#prop-fight-cloud"'), "inlines Looney-tunes cartoon fight cloud");
  assert.ok(s01.includes('href="#prop-mud-puddle"'), "inlines slapstick mud puddle");
  assert.ok(s01.includes('href="#fx-clash-spark"'), "inlines clash spark burst");
  assert.ok(s01.includes('rotation: 180'), "includes 180-degree upside down face-first mud defeat tumble");
  assert.ok(s01.includes('back.out(2)'), "includes fight cloud dynamic overshoot entry");

  // Also check Sima Yi and Rebel in scene 2
  tl.scenes[1].cast = ["SIMA YI", "REBEL"];
  tl.scenes[1].props = [];
  tl.scenes[1].beats = [];
  writeFileSync(path, JSON.stringify(tl));
  const res2 = buildFilm(dir);
  assert.equal(res2.ok, true, `scene 2 build failed: ${res2.errors?.join("\n")}`);
  const s02 = readFileSync(join(dir, "film", "compositions", "s02.html"), "utf8");
  assert.ok(s02.includes('href="#rig-hat-futou"'), "inlines scholar futou hat");
  assert.ok(s02.includes('href="#rig-beard-goatee"'), "inlines trimmed strategist goatee");
  assert.ok(s02.includes('href="#rig-hat-turban"'), "inlines yellow turban rebel headband");

  const gates = checkFilm(dir);
  assert.deepEqual(gates.errors, [], `film gates failed:\n${gates.errors.join("\n")}`);
});


