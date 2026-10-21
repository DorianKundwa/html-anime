/**
 * Compiles a doodle project into frame-exact build files.
 *
 *   node harness/compile.js projects/<slug>
 *
 * Writes (only when there are no hard errors):
 *   build/timeline.json     scenes, beats, headlines and cues as integer frames
 *   build/brief.md          the per-scene brief the agent draws from
 *   build/captions-diff.md  every caption substitution, for review
 *   captions.srt            corrected subtitles
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { PALETTE } from "./palette.js";
import {
  FPS,
  IngestError,
  audioDuration,
  buildTimeline,
  checkSheet,
  correctCues,
  parseSceneSheet,
  parseTranscript,
  toSrt,
} from "./ingest.js";

const pad = (n) => String(n).padStart(2, "0");

function findAudio(dir) {
  for (const name of ["narration.mp3", "narration.wav"]) {
    const p = join(dir, "audio", name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Runs ingest and checks. Returns { ok, errors, warnings, counts, timeline }.
 * log(text) receives progress lines as each stage finishes, so a UI can stream them.
 */
export async function compileProject(dir, { audioSeconds, log = () => {} } = {}) {
  const errors = [];
  const warnings = [];
  log(`compile ${basename(dir)}\n`);
  const audioPath = findAudio(dir);
  if (!audioPath && audioSeconds == null) errors.push("missing audio/narration.mp3 (or .wav)");
  const transcriptPath = join(dir, "transcript.txt");
  const sheetPath = join(dir, "scene_sheet.md");
  if (!existsSync(transcriptPath)) errors.push("missing transcript.txt");
  if (!existsSync(sheetPath)) errors.push("missing scene_sheet.md");
  if (errors.length) return { ok: false, errors, warnings, counts: null, timeline: null };

  const scriptPath = join(dir, "script.txt");
  const scriptText = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : null;
  if (scriptText == null) warnings.push("no script.txt: captions keep the transcript's spelling (loud: check captions-diff)");

  const rawCues = parseTranscript(readFileSync(transcriptPath, "utf8"));
  const sheet = parseSceneSheet(readFileSync(sheetPath, "utf8"));
  let seconds;
  try {
    seconds = audioSeconds ?? (await audioDuration(audioPath));
  } catch (err) {
    if (!(err instanceof IngestError)) throw err;
    errors.push(err.message);
    return { ok: false, errors, warnings, counts: null, timeline: null };
  }
  log(`read ${rawCues.length} cues, ${sheet.scenes.length} scenes, ${seconds.toFixed(2)} s of audio\n`);

  const { cues, diffs, warnings: cueWarnings } = correctCues(rawCues, scriptText);
  warnings.push(...cueWarnings);

  const check = checkSheet({ cues: rawCues, scenes: sheet.scenes, audioSeconds: seconds, cast: sheet.cast, props: sheet.props });
  errors.push(...check.errors);
  warnings.push(...check.warnings);
  log(`checked: ${errors.length} error(s), ${warnings.length} warning(s)\n`);

  const counts = {
    cues: cues.length,
    scenes: sheet.scenes.length,
    audioSeconds: seconds,
    totalFrames: Math.round(seconds * FPS),
    captionSubstitutions: diffs.length,
  };
  if (errors.length) return { ok: false, errors, warnings, counts, timeline: null };

  const timeline = buildTimeline({ cues, scenes: sheet.scenes, audioSeconds: seconds, cast: sheet.cast, props: sheet.props });
  const build = join(dir, "build");
  mkdirSync(build, { recursive: true });
  writeFileSync(join(build, "timeline.json"), JSON.stringify(timeline, null, 2) + "\n");
  writeFileSync(join(build, "brief.md"), renderBrief(timeline, basename(dir)));
  writeFileSync(join(build, "captions-diff.md"), renderDiff(diffs, scriptText == null));
  writeFileSync(join(dir, "captions.srt"), toSrt(timeline.captions));
  log("wrote build/ and captions.srt\n");
  return { ok: true, errors, warnings, counts, timeline };
}

const clock = (frame) => {
  const sec = frame / FPS;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
};

export function renderDiff(diffs, noScript) {
  const head = "# Caption substitutions\n\nReview each line. Every change is cue n: old → new.\n\n";
  if (noScript) return head + "No script.txt was given, so no substitutions were made.\n";
  if (!diffs.length) return head + "None. The transcript already matches the script.\n";
  return head + diffs.map((d) => `- cue ${d.n}: ${d.old} → ${d.new}`).join("\n") + "\n";
}

export function renderBrief(tl, slug) {
  const lines = [];
  lines.push(`# Brief: ${slug}`, "");
  lines.push(`Size 1920×1080, ${FPS} fps. Audio ${tl.audioSeconds.toFixed(2)} s = ${tl.totalFrames} frames. All frame numbers are root frames.`, "");
  lines.push("## Palette (the only colors in film/)", "");
  for (const [k, v] of Object.entries(PALETTE)) lines.push(`- ${k} ${v}`);
  lines.push("");
  lines.push("## Rules", "");
  lines.push("- Stick figures, bold black outline, flat fills, zero gradients, shadows, glows, blurs.");
  lines.push("- At most 3 poses per character per scene; 5 in a scene with SHAKE or CROSS.");
  lines.push("- Cuts are hard unless OUT says color-dip(token). PUSH is the only camera move; CAMERA lock means none.");
  lines.push("- Headlines ALL CAPS, top 150 px. Subtitles y 864–1030. Nothing important below y 864.");
  lines.push("- Do not add, merge, reorder or drop scenes, and do not add beats that are not on a card.");
  lines.push("");
  for (const s of tl.scenes) {
    lines.push(`## ${s.id}: frames ${s.startF}–${s.endF} (${clock(s.startF)}–${clock(s.endF)}), ${s.frames} frames, bg=${s.bg}`, "");
    lines.push(`- Cast: ${s.cast.join(", ") || "none"}`);
    lines.push(`- Props: ${s.props.join(", ") || "none"}`);
    lines.push(`- Layout: ${s.layout || "none given"}`);
    lines.push(`- Camera: ${s.camera}   Out: ${s.out}`);
    lines.push(`- Cues: ${s.cueFirst}–${s.cueLast}`);
    for (const tx of s.texts) lines.push(`- Headline (${tx.color}, frame ${tx.frame}): "${tx.text}"`);
    if (s.beats.length) {
      lines.push("- Beats:");
      for (const b of s.beats) lines.push(`  - frame ${b.frame} ${b.verb} ${b.text}`.trimEnd());
    } else {
      lines.push("- Beats: none on the card (idle life only)");
    }
    lines.push("");
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node harness/compile.js projects/<slug>");
    process.exit(2);
  }
  const res = await compileProject(dir);
  if (res.counts) {
    const c = res.counts;
    console.log(`cues ${c.cues} | scenes ${c.scenes} | audio ${c.audioSeconds.toFixed(2)} s | frames ${c.totalFrames} | caption substitutions ${c.captionSubstitutions}`);
  }
  for (const w of res.warnings) console.warn(`warning: ${w}`);
  for (const e of res.errors) console.error(`error: ${e}`);
  if (!res.ok) {
    console.error(`${res.errors.length} error(s). Nothing was written.`);
    process.exit(1);
  }
  console.log(`ok: wrote ${join(dir, "build")} and ${join(dir, "captions.srt")}`);
}
