/**
 * Ingest: reads the transcript, script and scene sheet, checks them against
 * docs/scene-sheet-spec.md, and converts every time to integer frames at 24 fps.
 * Plain Node ES module. Only dependency: ffprobe, for the audio length.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BG_TOKENS, TOKEN_NAMES } from "./palette.js";

const execFileP = promisify(execFile);

export const FPS = 24;
export const CAPTION_LINE_CHARS = 42;
export const CAPTION_LINES = 2;

/** Headline color allowed on each background (spec: TEXT CONTRAST). */
export const CONTRAST = {
  white: ["black", "red"],
  tan: ["black", "red"],
  sky: ["black", "red"],
  "sky+ground": ["black", "red"],
  yellow: ["black"],
  orange: ["black"],
  red: ["yellow", "black"],
  cobalt: ["yellow"],
  grey: ["yellow"],
  night: ["yellow"],
  brown: ["yellow"],
};
export const TEXT_COLORS = ["black", "red", "yellow"];
export const BEAT_VERBS = ["POP", "DRAW", "SLIDE", "SHAKE", "STAMP", "SWAP", "CROSS", "PUSH", "HOLD"];
export const CAMERA_MODES = ["lock", "push"];
const OUT_RE = /^(hard-cut|wipe-left|wipe-right|color-dip\((\w+)\))$/;

export const toFrame = (sec) => Math.round(sec * FPS);

export class IngestError extends Error {}

/** Parses m:ss, m:ss.s, h:mm:ss or h:mm:ss.s into seconds. */
export function parseClock(s) {
  const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(s).trim());
  if (!m) throw new IngestError(`bad timestamp "${s}"`);
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + parseFloat(m[3]);
}

function fmtClock(sec) {
  const whole = Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2, "0");
  return Number.isInteger(sec) ? whole : whole + "." + Math.round((sec % 1) * 10);
}

/** Cues: `[m:ss] text`, one per line. Returns [{n, t, text}]. */
export function parseTranscript(text) {
  const cues = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^\[((?:\d+:)?\d+:\d{1,2})\]\s*(.*)$/.exec(line);
    if (!m) throw new IngestError(`transcript line ${i + 1}: not a cue "[m:ss] text": ${line}`);
    cues.push({ n: cues.length + 1, t: parseClock(m[1]), text: m[2].trim() });
  });
  cues.forEach((c, i) => {
    if (i && c.t < cues[i - 1].t) throw new IngestError(`transcript cue ${c.n}: timestamps go backwards`);
  });
  return cues;
}

/**
 * Scene sheet. Parses the CAST and PROPS blocks and every card.
 * Semantic checks (bg tokens, contrast, verbs, frame ranges) are in checkSheet,
 * so every problem is reported with its line, not just the first.
 */
export function parseSceneSheet(md) {
  const lines = md.replace(/\u2013/g, "-").split(/\r?\n/);
  const cast = {};
  const props = {};
  const sets = {};
  const scenes = [];
  let section = null;
  let cur = null;
  let inBeats = false;

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith("```")) return;

    if (line.startsWith("## ")) {
      const block = /^## (CAST|PROPS|SETS)(?: \(added\))?$/.exec(line);
      if (block) {
        section = block[1];
        cur = null;
        inBeats = false;
        return;
      }
      const h = /^## S(\d+) \| (\S+?)-(\S+?) \| cues (\d+)-(\d+) \| bg=(\S+)$/.exec(line);
      if (!h) throw new IngestError(`line ${ln}: bad scene header "${line}"`);
      section = null;
      inBeats = false;
      cur = {
        n: +h[1],
        start: parseClock(h[2]),
        end: h[3] === "END" ? "END" : parseClock(h[3]),
        cueFirst: +h[4],
        cueLast: +h[5],
        bg: h[6],
        cast: [],
        props: [],
        layout: "",
        beats: [],
        texts: [],
        camera: "lock",
        out: "hard-cut",
        line: ln,
      };
      scenes.push(cur);
      return;
    }

    if (section) {
      const def = /^([A-Za-z0-9-]+): (.+)$/.exec(line);
      if (!def) throw new IngestError(`line ${ln}: bad ${section} entry "${line}"`);
      (section === "CAST" ? cast : section === "SETS" ? sets : props)[def[1]] = def[2];
      return;
    }

    if (!cur) return; // preamble text, such as batch labels

    if (inBeats) {
      const beat = /^- (\d[\d:.]*) (\S+)(?: (.*))?$/.exec(line);
      if (beat) {
        cur.beats.push({ t: parseClock(beat[1]), verb: beat[2], text: beat[3] ?? "", line: ln });
        return;
      }
      inBeats = false;
    }

    let m;
    if ((m = /^CAST: (.*)$/.exec(line))) cur.cast = splitList(m[1]);
    else if ((m = /^PROPS: (.*)$/.exec(line))) cur.props = splitList(m[1]);
    else if ((m = /^SET: (\S+)$/.exec(line))) cur.set = m[1];
    else if ((m = /^LAYOUT: (.*)$/.exec(line))) cur.layout = m[1];
    else if (line === "BEATS:") inBeats = true;
    else if ((m = /^TEXT: (.*)$/.exec(line))) {
      const t = /^(\S+) \| (\S+) \| "([^"]*)" @(\S+)$/.exec(m[1]);
      if (!t) throw new IngestError(`line ${ln}: bad TEXT line "${line}"`);
      cur.texts.push({ pos: t[1], color: t[2], text: t[3], t: parseClock(t[4]), line: ln });
    } else if ((m = /^CAMERA: (\S+)$/.exec(line))) cur.camera = m[1];
    else if ((m = /^OUT: (.+)$/.exec(line))) cur.out = m[1].trim();
    else if (/^(Batch |>|\*\*)/.test(line)) return;
    else throw new IngestError(`line ${ln}: unknown card line "${line}"`);
  });

  return { cast, props, sets, scenes };
}

function splitList(s) {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Duration of an audio file in seconds, from ffprobe. */
export async function audioDuration(path) {
  let stdout;
  try {
    ({ stdout } = await execFileP("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path,
    ]));
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new IngestError("ffprobe is not installed or not on PATH: install FFmpeg (it includes ffprobe) to read the audio length");
    }
    throw new IngestError(`ffprobe failed on ${path}: ${(err.stderr || err.message).toString().trim()}`);
  }
  const sec = parseFloat(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new IngestError(`ffprobe gave no duration for ${path}`);
  return sec;
}

const normWord = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function wordScore(a, b) {
  if (a === b) return 2;
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return sim >= 0.6 ? sim * 1.5 : -0.5;
}

/**
 * Aligns the transcript to the script (global alignment, fuzzy word equality),
 * then gives each cue the script words aligned to it. Returns the corrected cues
 * and the diff for review. Without a script, the transcript passes through.
 */
export function correctCues(cues, scriptText) {
  if (!cues.length) return { cues: [], diffs: [], warnings: [] };
  if (scriptText == null) {
    return { cues: cues.map((c) => ({ ...c })), diffs: [], warnings: ["no script.txt: subtitles use the transcript text as is"] };
  }
  const scriptTokens = scriptText.split(/\s+/).filter(Boolean).map((tok) => ({ tok, norm: normWord(tok) }));
  const cueWords = [];
  cues.forEach((c, ci) => {
    for (const tok of c.text.split(/\s+/).filter(Boolean)) {
      const norm = normWord(tok);
      if (norm) cueWords.push({ norm, cue: ci });
    }
  });
  const A = scriptTokens.map((s, i) => ({ ...s, i })).filter((s) => s.norm);
  const B = cueWords;
  const n = A.length;
  const m = B.length;
  const GAP = -0.6;
  const dp = new Float64Array((n + 1) * (m + 1));
  const tb = new Uint8Array((n + 1) * (m + 1)); // 0 diag, 1 up (script word unaligned), 2 left (cue word unaligned)
  const at = (i, j) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) { dp[at(i, 0)] = i * GAP; tb[at(i, 0)] = 1; }
  for (let j = 1; j <= m; j++) { dp[at(0, j)] = j * GAP; tb[at(0, j)] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = dp[at(i - 1, j - 1)] + wordScore(A[i - 1].norm, B[j - 1].norm);
      const u = dp[at(i - 1, j)] + GAP;
      const l = dp[at(i, j - 1)] + GAP;
      if (d >= u && d >= l) { dp[at(i, j)] = d; tb[at(i, j)] = 0; }
      else if (u >= l) { dp[at(i, j)] = u; tb[at(i, j)] = 1; }
      else { dp[at(i, j)] = l; tb[at(i, j)] = 2; }
    }
  }
  const cueOfScript = new Map(); // script token index -> cue index
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const dir = i === 0 ? 2 : j === 0 ? 1 : tb[at(i, j)];
    if (dir === 0) { cueOfScript.set(A[i - 1].i, B[j - 1].cue); i--; j--; }
    else if (dir === 1) i--;
    else j--;
  }

  // Unaligned script words go to the cue of the next aligned word (a sentence's
  // opening word belongs with the cue that follows it). Trailing words go to the last cue.
  const assigned = scriptTokens.map((_, k) => (cueOfScript.has(k) ? cueOfScript.get(k) : null));
  let fill = cues.length - 1;
  for (let k = scriptTokens.length - 1; k >= 0; k--) {
    if (assigned[k] == null) assigned[k] = fill;
    else fill = assigned[k];
  }
  const buckets = cues.map(() => []);
  scriptTokens.forEach((s, k) => buckets[assigned[k]].push(s.tok));

  const warnings = [];
  const diffs = [];
  const out = cues.map((c, ci) => {
    if (!buckets[ci].length) {
      warnings.push(`cue ${c.n}: no script words aligned; kept the transcript text`);
      return { ...c };
    }
    const text = buckets[ci].join(" ");
    if (text !== c.text.replace(/\s+/g, " ").trim()) diffs.push({ n: c.n, old: c.text, new: text });
    return { ...c, text };
  });
  return { cues: out, diffs, warnings };
}

/** Checks the sheet against the cues and the audio length. Returns every error and warning. */
export function checkSheet({ cues, scenes, audioSeconds, cast = {}, props = {}, sets = {} }) {
  const errors = [];
  const warnings = [];
  const err = (msg) => errors.push(msg);
  const warn = (msg) => warnings.push(msg);
  const N = cues.length;
  const totalFrames = toFrame(audioSeconds);
  if (!N) err("transcript has no cues");
  if (!scenes.length) err("scene sheet has no scenes");

  scenes.forEach((s, i) => {
    const where = `S${String(s.n).padStart(2, "0")} (line ${s.line})`;
    const isLast = i === scenes.length - 1;
    const startF = toFrame(s.start);
    const endF = isLast ? totalFrames : toFrame(s.end);
    const endSec = isLast ? audioSeconds : s.end;

    if (s.n !== i + 1) err(`${where}: scene numbers must run 1..N in order`);
    if (!BG_TOKENS.includes(s.bg)) err(`${where}: bg=${s.bg} is not a background token`);
    if (isLast && s.end !== "END") err(`${where}: the last scene must end at END`);
    if (!isLast && s.end === "END") err(`${where}: only the last scene may end at END`);
    if (s.cueFirst < 1 || s.cueLast > N || s.cueFirst > s.cueLast) {
      err(`${where}: cues ${s.cueFirst}-${s.cueLast} are outside 1..${N}`);
    }
    if (i === 0 && s.cueFirst !== 1) err(`${where}: the first scene must start at cue 1`);
    if (i > 0) {
      const prev = scenes[i - 1];
      if (s.cueFirst !== prev.cueLast + 1) err(`${where}: cues must continue from ${prev.cueLast + 1}`);
      if (typeof prev.end === "number" && toFrame(prev.end) !== startF) {
        err(`${where}: starts at ${fmtClock(s.start)} but the previous scene ends at ${fmtClock(prev.end)}`);
      }
    }
    if (isLast && s.cueLast !== N) err(`${where}: the last scene must cover through cue ${N}`);
    if (!(endF > startF)) err(`${where}: ends at or before its start`);
    if (cues[s.cueFirst - 1] && toFrame(cues[s.cueFirst - 1].t) !== startF) {
      err(`${where}: start ${fmtClock(s.start)} is not the timestamp of cue ${s.cueFirst}`);
    }
    for (let k = Math.max(1, s.cueFirst); k <= Math.min(s.cueLast, N); k++) {
      const f = toFrame(cues[k - 1].t);
      if (f < startF || f >= endF) err(`${where}: cue ${k} at ${fmtClock(cues[k - 1].t)} is outside the scene`);
    }

    if (!OUT_RE.test(s.out)) err(`${where}: OUT ${s.out} is not in the spec`);
    const dip = /^color-dip\((\w+)\)$/.exec(s.out);
    if (dip && !TOKEN_NAMES.includes(dip[1])) err(`${where}: color-dip(${dip[1]}) is not a palette token`);
    if (!CAMERA_MODES.includes(s.camera)) err(`${where}: CAMERA ${s.camera} must be lock or push`);

    for (const tx of s.texts) {
      if (tx.pos !== "top") err(`${where} line ${tx.line}: TEXT position must be top`);
      if (!TEXT_COLORS.includes(tx.color)) {
        err(`${where} line ${tx.line}: TEXT color ${tx.color} is not in the spec`);
      } else if (CONTRAST[s.bg] && !CONTRAST[s.bg].includes(tx.color)) {
        err(`${where} line ${tx.line}: ${tx.color} headline breaks the contrast table on bg=${s.bg}`);
      }
      const f = toFrame(tx.t);
      if (f < startF || f >= endF) err(`${where} line ${tx.line}: TEXT time ${fmtClock(tx.t)} is outside the scene`);
      if (tx.text !== tx.text.toUpperCase()) warn(`${where} line ${tx.line}: headline is not ALL CAPS`);
      if (tx.text.trim().split(/\s+/).length > 4) warn(`${where} line ${tx.line}: headline has more than 4 words`);
    }

    for (const b of s.beats) {
      if (!BEAT_VERBS.includes(b.verb)) err(`${where} line ${b.line}: beat verb ${b.verb} is not in the spec`);
      const f = toFrame(b.t);
      if (f < startF || f >= endF) err(`${where} line ${b.line}: beat ${fmtClock(b.t)} is outside the scene`);
    }

    const points = [s.start, ...s.beats.map((b) => b.t), endSec];
    for (let k = 1; k < points.length; k++) {
      if (points[k] - points[k - 1] > 3.0) {
        warn(`${where}: ${(points[k] - points[k - 1]).toFixed(1)} s with no change, from ${fmtClock(points[k - 1])}`);
      }
    }
    const dur = (endF - startF) / FPS;
    if (dur > 25) warn(`${where}: scene is ${dur.toFixed(1)} s, over 25 s`);
    if (dur < 3) warn(`${where}: scene is ${dur.toFixed(1)} s, under 3 s`);
    for (let k = Math.max(1, s.cueFirst); k <= Math.min(s.cueLast, N); k++) {
      const t = cues[k - 1].t;
      if (!s.beats.some((b) => Math.abs(b.t - t) <= 1.0)) warn(`${where}: cue ${k} has no beat within 1.0 s of its start`);
    }
    for (const name of s.cast) if (!(name in cast)) warn(`${where}: CAST ${name} is not declared`);
    for (const name of s.props) if (!(name in props)) warn(`${where}: PROPS ${name} is not declared`);
    if (s.set && !Object.keys(sets).some((k) => k.toUpperCase() === s.set.toUpperCase())) warn(`${where}: SET ${s.set} is not declared`);
  });

  const sum = scenes.reduce((acc, s, i) => {
    const endF = i === scenes.length - 1 ? totalFrames : toFrame(s.end);
    return acc + (endF - toFrame(s.start));
  }, 0);
  if (scenes.length && sum !== totalFrames) err(`scene frames sum to ${sum}, audio is ${totalFrames} frames`);

  return { errors, warnings };
}

/** Wraps text into lines of at most `width` characters, on word boundaries. */
export function wrapLines(text, width = CAPTION_LINE_CHARS) {
  const lines = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + w).length > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Caption blocks: each cue runs to the next cue's start (the last to the audio end).
 * A cue longer than two lines is split into timed blocks, time split by word position.
 */
export function buildCaptionBlocks(cues, audioSeconds) {
  const total = toFrame(audioSeconds);
  const blocks = [];
  cues.forEach((c, ci) => {
    const startF = toFrame(c.t);
    const endF = ci + 1 < cues.length ? toFrame(cues[ci + 1].t) : total;
    const lines = wrapLines(c.text);
    if (!lines.length) return;
    const groups = [];
    for (let k = 0; k < lines.length; k += CAPTION_LINES) groups.push(lines.slice(k, k + CAPTION_LINES));
    const words = (g) => g.join(" ").split(/\s+/).length;
    const totalWords = groups.reduce((a, g) => a + words(g), 0);
    let before = 0;
    groups.forEach((g, gi) => {
      const s = gi === 0 ? startF : startF + Math.round(((endF - startF) * before) / totalWords);
      before += words(g);
      const e = gi === groups.length - 1 ? endF : startF + Math.round(((endF - startF) * before) / totalWords);
      blocks.push({ cue: c.n, startF: s, endF: e, lines: g });
    });
  });
  return blocks;
}

function srtTime(frame) {
  const ms = Math.round((frame * 1000) / FPS);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":") + "," + String(r).padStart(3, "0");
}

export function toSrt(blocks) {
  return blocks
    .map((b, i) => `${i + 1}\n${srtTime(b.startF)} --> ${srtTime(b.endF)}\n${b.lines.join("\n")}\n`)
    .join("\n");
}

/** Converts checked ingest data to integer frames. */
export function buildTimeline({ cues, scenes, audioSeconds, cast = {}, props = {} }) {
  const totalFrames = toFrame(audioSeconds);
  const outScenes = scenes.map((s, i) => {
    const startF = toFrame(s.start);
    const endF = i === scenes.length - 1 ? totalFrames : toFrame(s.end);
    return {
      id: `S${String(s.n).padStart(2, "0")}`,
      n: s.n,
      startF,
      endF,
      frames: endF - startF,
      bg: s.bg,
      cast: s.cast,
      props: s.props,
      layout: s.layout,
      camera: s.camera,
      out: s.out,
      cueFirst: s.cueFirst,
      cueLast: s.cueLast,
      beats: s.beats.map((b) => ({ frame: toFrame(b.t), verb: b.verb, text: b.text })),
      texts: s.texts.map((tx) => ({ frame: toFrame(tx.t), pos: tx.pos, color: tx.color, text: tx.text })),
    };
  });
  const sum = outScenes.reduce((a, s) => a + s.frames, 0);
  if (sum !== totalFrames) throw new IngestError(`scene frames ${sum} != root frames ${totalFrames}`);
  return {
    fps: FPS,
    audioSeconds,
    totalFrames,
    scenes: outScenes,
    cues: cues.map((c) => ({ n: c.n, frame: toFrame(c.t), text: c.text })),
    captions: buildCaptionBlocks(cues, audioSeconds),
    cast,
    props,
  };
}
