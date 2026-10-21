/**
 * Builds the HyperFrames film from build/timeline.json (written by the compile step).
 *
 *   node harness/build-film.js projects/<slug>
 *
 * Writes, replacing what was there:
 *   film/index.html               root: one clip per scene, the captions layer, the narration
 *   film/compositions/sNN.html    one composition per scene, drawn from the shared rig
 *   film/compositions/captions-NN.html  one per minute of film: the captions that fall in that minute
 *   film/fonts/                   the fonts from assets/fonts
 *   film/vendor/                  the vendored gsap from assets/vendor (no CDN; the film works offline)
 *   film/narration.<ext>          copy of the narration
 *
 * Every timing is an integer frame. GSAP positions are frame / 24, and root clip
 * times are written from those frames. All scenes use one rig (assets/library.svg),
 * one palette (harness/palette.js) and one font set, so a long film reads as one drawing.
 * Nothing here is random or time-based, so rebuilding gives the same bytes.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PALETTE } from "./palette.js";
import { readSymbols, referencedIds } from "./inline-library.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(HERE, "..", "assets", "library.svg");
const FONTS = join(HERE, "..", "assets", "fonts");
const VENDOR = join(HERE, "..", "assets", "vendor");

const W = 1920;
const H = 1080;
const FPS = 24;
const GROUND = 900;
const ACTOR = { w: 448, h: 644, top: 298, half: 224, cy: 620, reach: 150 }; // rig scale 1.4, feet on GROUND
const PROP = { w: 240, h: 260, top: 640, half: 120, cy: 770 };
const POSE_LIMIT = 3;
const POSE_LIMIT_WITH_ACTION = 5;
const ENTER_VERBS = ["POP", "SLIDE", "STAMP"];

const EXPRESSIONS = {
  neutral: { eyes: "rig-eyes-neutral", mouth: "rig-mouth-neutral" },
  shock: { eyes: "rig-eyes-shock", mouth: "rig-mouth-open" },
  sly: { eyes: "rig-eyes-sly", mouth: "rig-mouth-neutral" },
  sweat: { eyes: "rig-eyes-sweat", mouth: "rig-mouth-neutral" },
  confused: { eyes: "rig-eyes-confused", mouth: "rig-mouth-neutral" },
  angry: { eyes: "rig-eyes-angry", mouth: "rig-mouth-neutral" },
};
// Checked in order against a SWAP's text (with entry names removed).
const EXPRESSION_WORDS = [
  [/\b(angry|mad|furious|annoy\w*)\b/i, "angry"],
  [/\b(sly|smug|wink\w*)\b/i, "sly"],
  [/\b(sweat\w*|nervous|worr\w*)\b/i, "sweat"],
  [/\b(confus\w*|puzzl\w*|doubt\w*|unsure)\b/i, "confused"],
  [/\b(shock\w*|raise[ds]?|surpris\w*|startl\w*|wide)\b/i, "shock"],
  [/\b(calm\w*|neutral|relax\w*|flat|normal)\b/i, "neutral"],
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const secs = (frame) => String(Number((frame / FPS).toFixed(6)));
const at = (n) => `f(${n})`;
const idOf = (s) => s.id.toLowerCase();
const poseKey = (st) => `${st.expr}|${st.limb}`;

function nameRe(name) {
  const body = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}-])${body}(?![\\p{L}\\p{N}-])`, "giu");
}

/** Entries named in `text`, in the order they appear. */
function namesIn(text, ents) {
  const hits = [];
  for (const e of ents) {
    const m = nameRe(e.name).exec(text);
    if (m) hits.push({ ent: e, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.ent);
}

function stripNames(text, ents) {
  let out = text;
  for (const e of ents) out = out.replace(nameRe(e.name), " ");
  return out;
}

/** First palette token word in a CAST or PROPS description, else the fallback. */
function tokenIn(desc, fallback) {
  for (const word of String(desc ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (Object.hasOwn(PALETTE, word)) return word;
  }
  return fallback;
}

function sceneEntries(s, dict) {
  const prefix = idOf(s);
  return [
    ...s.cast.map((name) => ({ name, kind: "actor", desc: dict.cast[name] })),
    ...s.props.map((name) => ({ name, kind: "prop", desc: dict.props[name] })),
  ].map((e, i) => ({
    ...e,
    id: `${prefix}-e${i}`,
    color: tokenIn(e.desc, e.kind === "actor" ? "white" : "tan"),
  }));
}

/**
 * Horizontal centre of each entry. Entries share the width evenly. A LAYOUT clause
 * with left, right, or center/middle moves the entries it names to that third.
 */
function placeEntries(ents, layout) {
  const n = ents.length;
  const xs = ents.map((_, i) => Math.round(((i + 0.5) * W) / n));
  for (const clause of layout.replace(/facing\s+(left|right)/gi, "").split(/[;,.]/)) {
    const word = /\b(left|right|center|centre|middle)\b/i.exec(clause);
    if (!word) continue;
    const x = { left: 480, right: 1440 }[word[1].toLowerCase()] ?? 960;
    for (const e of namesIn(clause, ents)) xs[ents.indexOf(e)] = x;
  }
  ents.forEach((e, i) => {
    e.cx = xs[i];
  });
}

/** Beats in frame order, each with its named entries and its verb's arguments. Problems go to errors. */
function resolveBeats(s, ents, errors) {
  return [...s.beats]
    .sort((a, b) => a.frame - b.frame)
    .map((b) => {
      const hits = namesIn(b.text, ents);
      const item = { L: b.frame - s.startF, verb: b.verb, text: b.text, hits, first: hits[0] };
      const bad = (msg) => errors.push(`${s.id} frame ${b.frame} ${b.verb}: ${msg}`);
      switch (b.verb) {
        case "POP":
        case "STAMP":
        case "SLIDE":
        case "SHAKE":
        case "CROSS":
          if (!item.first) bad("the text must name a CAST or PROPS entry on this card");
          break;
        case "SWAP": {
          const hit = EXPRESSION_WORDS.find(([re]) => re.test(stripNames(b.text, hits)));
          if (!item.first || item.first.kind !== "actor") bad("the text must name the CAST entry whose face changes");
          if (!hit) bad("no known expression word (angry, sly, sweat, confused, shock or raised, calm)");
          else item.expr = hit[1];
          break;
        }
        case "DRAW":
          if (hits.length < 2) bad("the text must name two entries: from X to Y");
          else {
            item.from = hits[0];
            item.to = hits[1];
          }
          break;
        case "HOLD":
        case "PUSH":
          break;
        default:
          bad("unknown verb");
      }
      return item;
    });
}

function use(id) {
  return `<use href="#${id}" x="-160" y="-110" width="320" height="460"/>`;
}

function actorMarkup(e, enter) {
  const layers = [...e.exprKeys]
    .map((k) => {
      const face = EXPRESSIONS[k];
      return `<g id="${e.id}-x-${k}" opacity="${k === "neutral" ? 1 : 0}">${use(face.eyes)}${use(face.mouth)}</g>`;
    })
    .join("");
  const hidden = enter.has(e) ? 0 : 1;
  return `<div id="${e.id}" class="actor" style="left:${e.cx - ACTOR.half}px;top:${ACTOR.top}px;width:${ACTOR.w}px;height:${ACTOR.h}px;opacity:${hidden}">
<svg width="${ACTOR.w}" height="${ACTOR.h}" viewBox="-160 -110 320 460" color="${PALETTE[e.color]}" style="display:block;overflow:visible">
${use("rig-head")}${use("rig-brows-neutral")}${use("rig-body")}
<g id="${e.id}-limb-idle" opacity="1">${use("rig-limb-idle")}</g>
<g id="${e.id}-limb-point" opacity="0">${use("rig-limb-point")}</g>
${layers}
</svg>
</div>`;
}

function propMarkup(e, enter) {
  const hidden = enter.has(e) ? 0 : 1;
  return `<div id="${e.id}" class="actor" style="left:${e.cx - PROP.half}px;top:${PROP.top}px;width:${PROP.w}px;height:${PROP.h}px;opacity:${hidden}">
<svg width="${PROP.w}" height="${PROP.h}" viewBox="0 0 ${PROP.w} ${PROP.h}" style="display:block;overflow:visible">
<rect x="5" y="5" width="230" height="250" fill="${PALETTE[e.color]}" stroke="${PALETTE.black}" stroke-width="10" stroke-linejoin="round"/>
<text x="120" y="150" text-anchor="middle" font-family="Lato" font-weight="700" font-size="22" fill="${PALETTE.black}">${esc(e.name)}</text>
</svg>
</div>`;
}

/** Arrow from the centre of a to the centre of b, stopped short of both, with a two-stroke head. */
function arrowD(a, b) {
  const cy = (e) => (e.kind === "actor" ? ACTOR.cy : PROP.cy);
  const ax = a.cx;
  const ay = cy(a);
  const dx = b.cx - ax;
  const dy = cy(b) - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = ax + ux * ACTOR.reach;
  const sy = ay + uy * ACTOR.reach;
  const ex = b.cx - ux * ACTOR.reach;
  const ey = cy(b) - uy * ACTOR.reach;
  const ang = (28 * Math.PI) / 180;
  const back = [-ux, -uy];
  const rot = (v, t) => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];
  const w1 = rot(back, ang);
  const w2 = rot(back, -ang);
  const r = Math.round;
  return `M${r(sx)} ${r(sy)} L${r(ex)} ${r(ey)} M${r(ex + w1[0] * 48)} ${r(ey + w1[1] * 48)} L${r(ex)} ${r(ey)} L${r(ex + w2[0] * 48)} ${r(ey + w2[1] * 48)}`;
}

/** Builds one scene composition. Returns { html, errors }. */
function buildScene(s, dict, symbols) {
  const errors = [];
  const sid = idOf(s);
  const N = s.frames;
  const ents = sceneEntries(s, dict);
  placeEntries(ents, s.layout || "");
  const beats = resolveBeats(s, ents, errors);
  if (errors.length) return { html: "", errors };
  const actors = ents.filter((e) => e.kind === "actor");

  // Pass A: which faces and entries exist, when entries enter, where the camera starts.
  for (const e of actors) e.exprKeys = new Set(["neutral"]);
  const enter = new Map();
  let pushStart = s.camera === "push" ? 0 : null;
  for (const b of beats) {
    if (b.verb === "SWAP" && b.expr) b.first.exprKeys.add(b.expr);
    if (ENTER_VERBS.includes(b.verb) && !enter.has(b.first)) enter.set(b.first, b.L);
    if (b.verb === "PUSH" && pushStart === null) pushStart = b.L;
  }
  const action = beats.some((b) => b.verb === "SHAKE" || b.verb === "CROSS");
  const poseLimit = action ? POSE_LIMIT_WITH_ACTION : POSE_LIMIT;
  for (const e of actors) {
    e.state = { expr: "neutral", limb: "idle" };
    e.poses = new Set([poseKey(e.state)]);
  }

  // Pass B: animation, in frame order.
  const ops = [];
  const arrows = [];
  const crosses = [];
  const inkId = `${sid}-ink`;
  for (let n = 0; n < N; n += 3) {
    ops.push(`tl.set("#${inkId}", { filter: "url(#${sid}-boil-${"abc"[(n / 3) % 3]})" }, ${at(n)});`);
  }
  let arrowN = 0;
  let crossN = 0;
  for (const b of beats) {
    const t = b.first;
    const L = b.L;
    const a = (k) => at(L + k);
    switch (b.verb) {
      case "POP":
        ops.push(`tl.fromTo("#${t.id}", { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1.06, duration: ${at(4)}, ease: "power2.out" }, ${at(L)});`);
        ops.push(`tl.to("#${t.id}", { scale: 1, duration: ${at(2)} }, ${a(4)});`);
        break;
      case "STAMP":
        ops.push(`tl.fromTo("#${t.id}", { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 0.96, duration: ${at(3)}, ease: "power4.in" }, ${at(L)});`);
        ops.push(`tl.to("#${t.id}", { scale: 1, duration: ${at(2)}, ease: "power1.out" }, ${a(3)});`);
        break;
      case "SLIDE": {
        const from = /from the right/i.test(b.text) ? 400 : -400;
        ops.push(`tl.fromTo("#${t.id}", { x: ${from}, opacity: 0 }, { x: 0, opacity: 1, duration: ${at(12)}, ease: "power2.out" }, ${at(L)});`);
        break;
      }
      case "SHAKE":
        for (let k = 0; k < 8; k++) ops.push(`tl.set("#${t.id}", { x: ${k % 2 ? -8 : 8} }, ${a(k)});`);
        ops.push(`tl.set("#${t.id}", { x: 0 }, ${a(8)});`);
        break;
      case "SWAP":
        for (const k of t.exprKeys) ops.push(`tl.set("#${t.id}-x-${k}", { opacity: ${k === b.expr ? 1 : 0} }, ${at(L)});`);
        t.state.expr = b.expr;
        t.poses.add(poseKey(t.state));
        break;
      case "DRAW": {
        const from = b.from;
        if (from.kind === "actor") {
          ops.push(`tl.set("#${from.id}-limb-idle", { opacity: 0 }, ${at(L)});`);
          ops.push(`tl.set("#${from.id}-limb-point", { opacity: 1 }, ${at(L)});`);
          from.state.limb = "point";
          from.poses.add(poseKey(from.state));
        }
        const id = `${sid}-arrow${arrowN++}`;
        arrows.push(`<path id="${id}" class="draw" pathLength="1" d="${arrowD(from, b.to)}"/>`);
        ops.push(`tl.fromTo("#${id}", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: ${at(14)}, ease: "power1.out" }, ${at(L)});`);
        break;
      }
      case "CROSS": {
        const c = t.kind === "actor" ? ACTOR : PROP;
        const cy = c.cy;
        const h = t.kind === "actor" ? ACTOR.reach : 120;
        const lines = [
          [`${t.cx - h}`, `${cy - h}`, `${t.cx + h}`, `${cy + h}`],
          [`${t.cx + h}`, `${cy - h}`, `${t.cx - h}`, `${cy + h}`],
        ];
        lines.forEach(([x1, y1, x2, y2], k) => {
          const id = `${sid}-x${crossN++}`;
          crosses.push(`<path id="${id}" class="draw" pathLength="1" stroke="${PALETTE.red}" stroke-width="18" d="M${x1} ${y1} L${x2} ${y2}"/>`);
          ops.push(`tl.fromTo("#${id}", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: ${at(8)}, ease: "none" }, ${a(8 * k)});`);
        });
        break;
      }
      case "PUSH":
      case "HOLD":
      default:
        break;
    }
  }

  for (const e of actors) {
    if (e.poses.size > poseLimit) {
      errors.push(`${s.id}: ${e.name} takes ${e.poses.size} poses; the limit is ${poseLimit}${action ? " (scene has SHAKE or CROSS)" : ""}`);
    }
  }

  if (pushStart !== null) {
    ops.push(`tl.fromTo("#${sid}-stage", { scale: 1 }, { scale: 1.06, duration: ${at(N - pushStart)}, ease: "none" }, ${at(pushStart)});`);
  }

  // Headlines (top only, as the spec requires). They stay until the scene ends.
  const headlines = s.texts.map((tx, k) => {
    const L = tx.frame - s.startF;
    ops.push(`tl.fromTo("#${sid}-t${k}", { opacity: 0, scale: 1.6 }, { opacity: 1, scale: 1, duration: ${at(3)}, ease: "power2.out" }, ${at(L)});`);
    return `<div id="${sid}-t${k}" class="ttl" style="color:${PALETTE[tx.color]};opacity:0">${esc(tx.text.toUpperCase())}</div>`;
  });

  // OUT: a dip to a palette color, or a wipe, over the last 6 frames. Hard cut leaves nothing.
  const d = Math.min(6, N);
  let overlay = "";
  const dip = /^color-dip\((\w+)\)$/.exec(s.out);
  const wipe = /^wipe-(left|right)$/.exec(s.out);
  if (dip) {
    overlay = `<div id="${sid}-dip" class="fill" style="opacity:0;background:${PALETTE[dip[1]]}"></div>`;
    ops.push(`tl.fromTo("#${sid}-dip", { opacity: 0 }, { opacity: 1, duration: ${at(d)}, ease: "none" }, ${at(N - d)});`);
  } else if (wipe) {
    overlay = `<div id="${sid}-wipe" class="fill" style="background:${PALETTE.black}"></div>`;
    const from = wipe[1] === "left" ? -W : W;
    ops.push(`tl.fromTo("#${sid}-wipe", { x: ${from} }, { x: 0, duration: ${at(d)}, ease: "none" }, ${at(N - d)});`);
  }

  const ground = s.bg === "sky+ground"
    ? `<div class="fill" style="top:${GROUND}px;height:${H - GROUND}px;background:${PALETTE.green}"></div>`
    : "";
  const bgHex = PALETTE[s.bg === "sky+ground" ? "sky" : s.bg];
  const overlaySvg = `<svg class="fill" viewBox="0 0 ${W} ${H}" fill="none" stroke="${PALETTE.black}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" style="overflow:visible">${arrows.join("")}${crosses.join("")}</svg>`;
  const entityMarkup = ents.map((e) => (e.kind === "actor" ? actorMarkup(e, enter) : propMarkup(e, enter))).join("\n");
  const stage = `<div id="${sid}-stage" class="fill" style="background:${bgHex}">
${ground}
<div id="${sid}-ink" class="fill">
${entityMarkup}
${overlaySvg}
</div>
${headlines.join("\n")}
</div>
${overlay}`;
  const root = `<div id="root" data-composition-id="${sid}" data-width="${W}" data-height="${H}">\n${stage}\n</div>`;

  const ids = referencedIds(root);
  const missing = ids.filter((id) => !symbols.has(id));
  if (missing.length) errors.push(`${s.id}: library has no symbol(s) ${missing.join(", ")}`);
  const defs = ids.filter((id) => symbols.has(id)).map((id) => symbols.get(id)).join("\n");
  const boil = ["a", "b", "c"].map((k, i) => `<filter id="${sid}-boil-${k}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${i + 1}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>`).join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template>
      <svg width="0" height="0" style="position: absolute" aria-hidden="true">
        <defs>
${boil}
${defs}
        </defs>
      </svg>
      <style>
${FONT_FACES}
${SCENE_CSS}
      </style>

${root}

      <script>
        const f = (n) => n / 24;
        const tl = gsap.timeline({ paused: true });
${ops.map((o) => "        " + o).join("\n")}
        window.__timelines["${sid}"] = tl;
      </script>
    </template>
  </body>
</html>
`;
  return { html, errors };
}

const FONT_FACES = `        @font-face {
          font-family: "Permanent Marker";
          src: url("../fonts/permanent-marker-regular.woff2") format("woff2");
          font-weight: 400;
          font-style: normal;
        }
        @font-face {
          font-family: "Lato";
          src: url("../fonts/lato-bold.woff2") format("woff2");
          font-weight: 700;
          font-style: normal;
        }`;

const SCENE_CSS = `        #root { position: absolute; inset: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
        .fill { position: absolute; inset: 0; width: ${W}px; height: ${H}px; overflow: visible; }
        .actor { position: absolute; transform-origin: 50% 50%; }
        .ttl {
          position: absolute; top: 60px; left: 0; width: ${W}px; margin: 0; text-align: center;
          font-family: "Permanent Marker", Arial, sans-serif; font-weight: 400; font-size: 110px; line-height: 1;
          transform-origin: 50% 50%;
        }
        .draw { stroke-dasharray: 1 1; }`;

const MINUTE = 60 * FPS;
const minuteCount = (tl) => Math.max(1, Math.ceil(tl.totalFrames / MINUTE));
const captionsId = (m) => `captions-${String(m + 1).padStart(2, "0")}`;

/**
 * The captions that overlap minute m, with frames counted from the start of that minute.
 * A caption that crosses a minute boundary appears in both minutes, cut at the boundary.
 * Captions keep their global index, so element ids are unique across the minute files.
 */
function captionsInMinute(tl, m) {
  const base = m * MINUTE;
  const end = Math.min(base + MINUTE, tl.totalFrames);
  return tl.captions.flatMap((cue, i) => {
    if (cue.endF <= base || cue.startF >= end) return [];
    return [{ i, cue, startF: Math.max(cue.startF, base) - base, endF: Math.min(cue.endF, end) - base }];
  });
}

function captionsHtml(tl, m) {
  const id = captionsId(m);
  const caps = captionsInMinute(tl, m);
  const markup = caps
    .map((c) => `      <div id="cap${c.i}" class="cap" style="opacity:0"><span>${c.cue.lines.map(esc).join("<br>")}</span></div>`)
    .join("\n");
  const ops = caps.flatMap((c) => [
    `        tl.set("#cap${c.i}", { opacity: 1 }, ${at(c.startF)});`,
    `        tl.set("#cap${c.i}", { opacity: 0 }, ${at(c.endF)});`,
  ]);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template>
      <style>
${FONT_FACES}
        #root { position: absolute; inset: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
        .cap {
          position: absolute; left: 0; bottom: 36px; width: ${W}px; text-align: center;
          font-family: "Lato", Arial, sans-serif; font-weight: 700; font-size: 44px; line-height: 1.2;
        }
        .cap span {
          display: inline-block; background: ${PALETTE.white}; color: ${PALETTE.black};
          border: 4px solid ${PALETTE.black}; padding: 6px 18px;
        }
      </style>

      <div id="root" data-composition-id="${id}" data-width="${W}" data-height="${H}">
${markup}
      </div>

      <script>
        const f = (n) => n / 24;
        const tl = gsap.timeline({ paused: true });
${ops.join("\n")}
        window.__timelines["${id}"] = tl;
      </script>
    </template>
  </body>
</html>
`;
}

function rootHtml(tl, slug, narrationFile) {
  const clips = tl.scenes.map((s) => {
    const sid = idOf(s);
    return `      <div id="${sid}-clip" class="clip" data-composition-id="${sid}" data-composition-src="compositions/${sid}.html" data-start="${secs(s.startF)}" data-duration="${secs(s.frames)}" data-track-index="1" data-width="${W}" data-height="${H}"></div>`;
  });
  const captionClips = Array.from({ length: minuteCount(tl) }, (_, m) => {
    const id = captionsId(m);
    const base = m * MINUTE;
    const len = Math.min(MINUTE, tl.totalFrames - base);
    return `      <div id="${id}-clip" class="clip" data-track-kind="captions" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${secs(base)}" data-duration="${secs(len)}" data-track-index="2" data-width="${W}" data-height="${H}"></div>`;
  });
  const total = secs(tl.totalFrames);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <title>${esc(slug)}</title>
    <script src="vendor/gsap.min.js"></script>
    <style>
      body { margin: 0; background: ${PALETTE.white}; }
      #root { position: absolute; inset: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
      .clip { position: absolute; inset: 0; width: ${W}px; height: ${H}px; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main" data-no-timeline
      data-start="0"
      data-fps="${FPS}"
      data-width="${W}"
      data-height="${H}"
      data-duration="${total}"
    >
${clips.join("\n")}
${captionClips.join("\n")}

      <audio id="narration" src="${narrationFile}" data-start="0" data-duration="${total}"></audio>
    </div>
  </body>
</html>
`;
}

function findAudio(dir) {
  for (const name of ["narration.mp3", "narration.wav"]) {
    const p = join(dir, "audio", name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Builds the film for a compiled project. Returns { ok, errors, files }.
 * Nothing is written when there are errors.
 */
export function buildFilm(projectDir) {
  const timelinePath = join(projectDir, "build", "timeline.json");
  if (!existsSync(timelinePath)) {
    return { ok: false, errors: [`missing ${timelinePath}: run the compile step first`], files: [] };
  }
  const audio = findAudio(projectDir);
  if (!audio) return { ok: false, errors: ["missing audio/narration.mp3 (or .wav)"], files: [] };

  const tl = JSON.parse(readFileSync(timelinePath, "utf8"));
  const dict = { cast: tl.cast ?? {}, props: tl.props ?? {} };
  const symbols = readSymbols(readFileSync(LIBRARY, "utf8"));

  const scenes = tl.scenes.map((s) => ({ id: idOf(s), ...buildScene(s, dict, symbols) }));
  const errors = scenes.flatMap((s) => s.errors);
  if (errors.length) return { ok: false, errors, files: [] };

  const filmDir = join(projectDir, "film");
  const compDir = join(filmDir, "compositions");
  rmSync(compDir, { recursive: true, force: true });
  mkdirSync(compDir, { recursive: true });
  mkdirSync(join(filmDir, "fonts"), { recursive: true });
  for (const file of readdirSync(FONTS)) copyFileSync(join(FONTS, file), join(filmDir, "fonts", file));
  mkdirSync(join(filmDir, "vendor"), { recursive: true });
  for (const file of readdirSync(VENDOR)) copyFileSync(join(VENDOR, file), join(filmDir, "vendor", file));

  const narrationFile = "narration" + extname(audio);
  copyFileSync(audio, join(filmDir, narrationFile));

  const files = [];
  for (const s of scenes) {
    const p = join(compDir, `${s.id}.html`);
    writeFileSync(p, s.html);
    files.push(p);
  }
  for (let m = 0; m < minuteCount(tl); m++) {
    const p = join(compDir, `${captionsId(m)}.html`);
    writeFileSync(p, captionsHtml(tl, m));
    files.push(p);
  }
  const rootPath = join(filmDir, "index.html");
  writeFileSync(rootPath, rootHtml(tl, basename(projectDir), narrationFile));
  files.push(rootPath);
  return { ok: true, errors: [], files };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node harness/build-film.js projects/<slug>");
    process.exit(2);
  }
  const res = buildFilm(dir);
  for (const e of res.errors) console.error(`error: ${e}`);
  if (!res.ok) {
    console.error(`${res.errors.length} error(s). Nothing was written.`);
    process.exit(1);
  }
  console.log(`ok: wrote ${res.files.length} file(s) to ${join(dir, "film")}`);
}
