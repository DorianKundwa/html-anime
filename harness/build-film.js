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
import { PALETTE, TONES } from "./palette.js";
import { readSymbols, referencedIds } from "./inline-library.js";
import { CONTRAST } from "./ingest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIBRARY = join(HERE, "..", "assets", "library.svg");
const FONTS = join(HERE, "..", "assets", "fonts");
const VENDOR = join(HERE, "..", "assets", "vendor");

const W = 1920;
const H = 1080;
const FPS = 24;
const GROUND = 850; // the ground line: actors' feet and props' bases stand on it, above the captions
const ACTOR = { w: 448, h: 644, feetY: 850, top: 402, half: 224, cy: 724, reach: 150 }; // rig scale 1.4, feet on GROUND
const PROP = { w: 240, h: 260, top: 590, half: 120, cy: 720 };
const RIG_FEET = 320; // the rig's feet, in rig units, measured from the top of its 460 tall box
const POSE_LIMIT = 3;
const POSE_LIMIT_WITH_ACTION = 5;
const ENTER_VERBS = ["POP", "SLIDE", "STAMP"];
const FRAMING_WORDS = [
  [/\b(foreground|bust|closeup|close-up)\b/i, "bust"],
  [/\b(wide|full)\b/i, "wide"],
];

const EXPRESSIONS = {
  neutral: { eyes: "rig-eyes-neutral", brows: "rig-brows-neutral", mouth: "rig-mouth-neutral" },
  shock:   { eyes: "rig-eyes-shock",   brows: "rig-brows-raised",    mouth: "rig-mouth-open" },
  sly:     { eyes: "rig-eyes-sly",     brows: "rig-brows-neutral",   mouth: "rig-mouth-smile" },
  sweat:   { eyes: "rig-eyes-sweat",   brows: "rig-brows-droop",     mouth: "rig-mouth-frown" },
  confused:{ eyes: "rig-eyes-confused",brows: "rig-brows-raised-one",mouth: "rig-mouth-neutral" },
  angry:   { eyes: "rig-eyes-angry",   brows: "rig-brows-angry",     mouth: "rig-mouth-frown" },
  droop:   { eyes: "rig-eyes-neutral", brows: "rig-brows-droop",     mouth: "rig-mouth-frown" },
  tired:   { eyes: "rig-eyes-tired",   brows: "rig-brows-droop",     mouth: "rig-mouth-frown" },
  panic:   { eyes: "rig-eyes-shock",   brows: "rig-brows-raised",    mouth: "rig-mouth-scream" },
  dead:    { eyes: "rig-eyes-dead",    brows: "rig-brows-droop",     mouth: "rig-mouth-frown" },
  rage:    { eyes: "rig-eyes-rage",    brows: "rig-brows-angry",     mouth: "rig-mouth-open" },
  evil:    { eyes: "rig-eyes-sly",     brows: "rig-brows-angry",     mouth: "rig-mouth-evil" },
};
// Checked in order against a SWAP's text (with entry names removed).
const EXPRESSION_WORDS = [
  [/\b(dead|death|kill\w*|slain|defeat\w*|perish\w*|knock\w*|unconscious|fall\w*|collaps\w*|tumble\w*|mud|puddle)\b/i, "dead"],
  [/\b(rage|outrage\w*|livid|wrath)\b/i, "rage"],
  [/\b(evil|schem\w*|wicked|villain\w*|malic\w*|sinister)\b/i, "evil"],
  [/\b(panic\w*|terrif\w*|scream\w*|horror)\b/i, "panic"],
  [/\b(tired|exhausted|sleepy|droop\w*|downcast|sadly)\b/i, "tired"],
  [/\b(angry|mad|furious|annoy\w*)\b/i, "angry"],
  [/\b(sly|smug|wink\w*)\b/i, "sly"],
  [/\b(sweat\w*|nervous|worr\w*)\b/i, "sweat"],
  [/\b(confus\w*|puzzl\w*|doubt\w*|unsure)\b/i, "confused"],
  [/\b(shock\w*|raise[ds]?|surpris\w*|startl\w*|wide)\b/i, "shock"],
  [/\b(calm\w*|neutral|relax\w*|flat|normal|soft\w*|warm\w*|smil\w*|glance\w*|slide\w*|slid\w*|blink\w*|hover\w*)\b/i, "neutral"],
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
  if (hits.length === 0) {
    for (const e of ents) {
      const parts = e.name.toLowerCase().split(/[^a-z0-9]+/);
      for (const p of parts) {
        if (p.length >= 4 && new RegExp(`\\b${p}s?\\b`, "iu").test(text)) {
          hits.push({ ent: e, at: 0 });
          break;
        }
      }
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.ent);
}

function stripNames(text, ents) {
  let out = text;
  for (const e of ents) out = out.replace(nameRe(e.name), " ");
  return out;
}

export function canonicalToken(word) {
  if (!word) return null;
  const w = word.toLowerCase();
  if (Object.hasOwn(PALETTE, w)) return w;
  const SYN = { blue: "cobalt", gray: "grey", gold: "yellow", navy: "night", darkblue: "night" };
  return SYN[w] ?? null;
}

/** First palette token word in a CAST or PROPS description, else the fallback. */
function tokenIn(desc, fallback) {
  for (const word of String(desc ?? "").toLowerCase().split(/[^a-z]+/)) {
    const tok = canonicalToken(word);
    if (tok) return tok;
  }
  return fallback;
}

/**
 * The clothes a cast description asks for. The scene sheet names them in words
 * ("yellow knit beanie", "long cobalt robe", "round black glasses"), so the generator reads
 * the description and picks the library symbol and the palette colour for each one.
 */
const GARMENT_WORDS = [
  [/\b(pill\s*body|pill|hanfu|chinese\s*robe)\b/, "rig-body-pill"],
  [/\b(armor|armour|plate)\b/, "rig-armor"],
  [/\bcape\b/, "rig-cape"],
  [/\btunic\b/, "rig-tunic"],
  [/\brobe\b/, "rig-robe"],
  [/\blab-?coat\b/, "rig-labcoat"],
  [/\bsafety\s*vest\b/, "rig-vest-safety"],
  [/\bvest\b/, "rig-vest"],
  [/\b(dress|skirt)\b/, "rig-dress"],
  [/\bsuit\b/, "rig-suit"],
  [/\bsweater\b/, "rig-sweater"],
  [/\bhoodie\b/, "rig-sweater"],
  [/\b(blazer|jacket|coat|shirt)\b/, "rig-torso"],
];
const HAT_WORDS = [
  [/\b(mianliu|imperial\s*crown|beaded\s*crown)\b/, "rig-hat-mianliu"],
  [/\b(futou|magistrate|eunuch|scholar\s*hat)\b/, "rig-hat-futou"],
  [/\b(turban|yellow\s*turban|headband)\b/, "rig-hat-turban"],
  [/\b(lubu|pheasant|plume\s*helm\w*)\b/, "rig-helmet-lubu"],
  [/\bcrown\b/, "rig-hat-crown"],
  [/\b(helmet|bascinet|helm)\b/, "rig-hat-helmet"],
  [/\btricorn\b/, "rig-hat-tricorn"],
  [/\bhard\s*hat\b/, "rig-hat-hard"],
  [/\bhard\s*helm\w*\b/, "rig-hat-hard"],
  [/\bbeanie\b/, "rig-hat-beanie"],
  [/\b(cap|hat)\b/, "rig-hat-cap"],
];
const HAIR_WORDS = [
  [/ponytail\b/, "rig-hair-ponytail"],
  [/curl\w*\s+hair/, "rig-hair-curly"],
  [/hair bun|\bbun\b/, "rig-hair-bun"],
  [/long[\w\s-]{0,14}hair/, "rig-hair-long"],
  [/short[\w\s-]{0,14}hair/, "rig-hair-short"],
  [/\bhair\b/, "rig-hair-short"],
];
const BEARD_WORDS = [
  [/\b(full\s*beard|warlord\s*beard|heavy\s*beard|thick\s*beard|long\s*beard|big\s*beard)\b/, "rig-beard-full"],
  [/\b(goatee|mustache|mustachio|trimmed\s*beard)\b/, "rig-beard-goatee"],
  [/\bbeard\b/, "rig-beard-full"],
];
// Pose override words read from the cast description.
const POSE_WORDS = [
  [/\bwalk\w*|slump\w*\s*walk\w*/i, "rig-limb-walk"],
  [/\bclipboard\b/i, "rig-limb-clipboard"],
  [/\bcrossed\s*arms\b/i, "rig-limb-crossed"],
  [/\bpanic\w*\s*arms\b/i, "rig-limb-panic"],
];

/** Reads a cast description into the outfit the rig draws. */
function dressUp(desc) {
  const ws = String(desc ?? "").toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
  const joined = ws.join(" ");
  /** Index of the last word of the first match of `re` in the description. */
  const find = (re) => {
    const m = re.exec(joined);
    if (!m) return -1;
    const before = joined.slice(0, m.index).trim();
    const pre = before ? before.split(/\s+/).length : 0;
    return pre + m[0].trim().split(/\s+/).length - 1;
  };
  /** The palette token nearest before a word, looking back three words. */
  const tokenBefore = (end) => {
    for (let i = end; i >= 0 && i > end - 3; i--) {
      const tok = canonicalToken(ws[i]);
      if (tok) return tok;
    }
    return null;
  };
  const tokenAround = (end) => {
    const b = tokenBefore(end);
    if (b) return b;
    for (let i = end + 1; i < ws.length && i <= end + 5; i++) {
      const tok = canonicalToken(ws[i]);
      if (tok) return tok;
    }
    return null;
  };
  const headIdx = ws.findIndex((w) => w === "head" || w === "heads");
  const head = headIdx < 0 ? "white" : tokenBefore(headIdx) ?? "white";

  let garment = null;
  for (const [re, symbol] of GARMENT_WORDS) {
    const i = find(re);
    if (i < 0) continue;
    let color = tokenAround(i);
    if (!color && symbol === "rig-body-pill") color = "white";
    if (color) {
      garment = { symbol, color };
      break;
    }
  }
  if (!garment) {
    // "<colour> body" is a plain torso. "black stick body" is a bare stick body.
    const i = ws.findIndex((w) => w === "body");
    if (i > 0 && ws[i - 1] !== "stick") {
      const color = tokenBefore(i);
      if (color) garment = { symbol: "rig-torso", color };
    }
  }

  let hat = null;
  for (const [re, symbol] of HAT_WORDS) {
    const i = find(re);
    if (i < 0) continue;
    const fallbackColor = symbol === "rig-hat-turban" ? "yellow"
      : symbol === "rig-helmet-lubu" ? "grey"
      : symbol === "rig-hat-futou" ? "black"
      : "yellow";
    hat = { symbol, color: tokenAround(i) ?? fallbackColor };
    break;
  }
  let hair = null;
  for (const [re, symbol] of HAIR_WORDS) {
    const i = find(re);
    if (i < 0) continue;
    hair = { symbol, color: tokenBefore(i) ?? "black" };
    break;
  }
  let beard = null;
  for (const [re, symbol] of BEARD_WORDS) {
    const i = find(re);
    if (i < 0) continue;
    beard = { symbol, color: tokenAround(i) ?? "black" };
    break;
  }
  let scarf = null;
  const scarfIdx = find(/scarf\w*/);
  if (scarfIdx >= 0) scarf = { color: tokenBefore(scarfIdx) ?? "orange" };
  let tie = null;
  const tieIdx = find(/\btie\b/);
  if (tieIdx >= 0) tie = { color: tokenBefore(tieIdx) ?? "red" };
  let cape = null;
  const capeIdx = find(/\bcape\b/);
  if (capeIdx >= 0) cape = { symbol: "rig-cape", color: tokenBefore(capeIdx) ?? "red" };

  // Pose override from description words (e.g. "walking slumped" = walk-slump pose).
  let pose = null;
  for (const [re, symbol] of POSE_WORDS) {
    if (re.test(joined)) { pose = symbol; break; }
  }
  return {
    head,
    garment,
    cape,
    hat,
    hair,
    beard,
    scarf,
    tie,
    glasses: /glass\w*/.test(joined),
    hood: /hooded/.test(joined),
    pose,
  };
}

/** Size words in a LAYOUT clause, and the scale they ask for. */
const SIZE_WORDS = [
  [/\b(fills|giant|huge)\b/, 1.4],
  [/\b(large|big)\b/, 1.3],
  [/\bsmall\b/, 0.66],
  [/\btiny\b/, 0.42],
  [/\bdistant\b/, 0.6],
];

/** Library symbol that draws a prop, e.g. GREEN-BACKPACK -> prop-green-backpack. */
export const propSymbol = (name) => `prop-${String(name).toLowerCase()}`;

/**
 * Props that share a drawn shape. The scene sheets name a prop for what it is
 * (a book, a tag, a building), so many of them are the same object with another
 * word for it. This map sends each of those names to the symbol that draws it,
 * so no prop is ever left as a labelled box.
 */
export const PROP_ALIASES = {
  "AFFIDAVIT": "prop-paper", "AIRPLANE": "prop-airplane", "AIRSTRIP": "prop-airstrip",
  "ARCHIVE-SHELF": "prop-shelf", "BASKET": "prop-basket", "BELIEF-BUBBLE": "prop-cloud",
  "BUS-ICON": "prop-building", "BUSINESS-CARD": "prop-card", "CABIN": "prop-building",
  "CAMPUS-ICON": "prop-building", "CAR": "prop-car", "CHAIR": "prop-chair",
  "CHECKMARK": "prop-check", "CHINA-MAP": "prop-map", "CLOCK-ICON": "prop-clock",
  "COAT-RACK": "prop-tower", "COGS": "prop-gears", "COIN-JAR": "prop-coin-jar",
  "COINS": "prop-coins", "COIN-STACKS": "prop-coins", "COMMUNITY-TABLE": "prop-desk",
  "CRACK": "prop-crack", "CROSSING-BANNER": "prop-sign", "DEGREES-BAR": "prop-meter",
  "DELETE-BUTTON": "prop-delete-button", "DESK": "prop-desk", "DICTIONARY": "prop-book",
  "DOOR-SIGN": "prop-door-sign", "DOUBT-BOX": "prop-machine", "DOUBT-BUBBLE": "prop-cloud",
  "DRIFT-WAVE": "prop-thread", "DRAWER": "prop-file-drawer", "DRYER": "prop-dryer",
  "EAR": "prop-ear", "EYE": "prop-eye", "FILE-DRAWER": "prop-file-drawer",
  "FILE-FOLDER": "prop-folder", "FLOOD-WAVE": "prop-thread", "GARLIC": "prop-garlic",
  "GIVEN-PILE": "prop-pile", "GOVERNMENT-BUILDING": "prop-building",
  "GUARD-BOOTH": "prop-building", "GUYANA-MAP": "prop-map", "HARBOR-BUILDING": "prop-harbor-building",
  "HARBOR-SIGN": "prop-sign", "HEAT-WAVES": "prop-thread", "HOUSES-ICON": "prop-houses",
  "IDEA-BULB": "prop-lightbulb", "INVITATION": "prop-card", "KITCHEN-DOOR": "prop-door",
  "LABEL-STICKER": "prop-tag", "LEADER-CHAIR": "prop-chair", "LIST": "prop-paper",
  "LOAD-BAR": "prop-meter", "LOOSE-THREAD": "prop-thread", "LOUD-MACHINE": "prop-machine",
  "MAGNIFIER": "prop-magnifier", "MEGAPHONE": "prop-megaphone", "MIND-HEAD": "prop-mind-head",
  "MUGS": "prop-mugs", "NAME-TAG": "prop-card", "NEWSPAPER": "prop-newspaper",
  "OFFICE-ICON": "prop-building", "OLD-LEASE": "prop-paper", "PAPER-STACK": "prop-paper",
  "PLAN-PAPER": "prop-paper", "PRICE-TAG": "prop-tag", "PURSE": "prop-purse",
  "READING-LIST": "prop-paper", "RENT-TAG": "prop-tag", "ROAD-SIGN": "prop-sign",
  "ROOM-WALLS": "prop-wall", "SACRED-BOOK": "prop-book", "SCHEDULE-WALL": "prop-schedule-wall",
  "SCHOOL-ICON": "prop-building", "SIGH-CLOUD": "prop-cloud", "SLEEPING-ARM": "prop-arm",
  "SLOPE": "prop-slope", "SMELL-LINES": "prop-thread", "STAGE-STONES": "prop-stones",
  "STATIC-CLOUD": "prop-cloud", "STEP-MARKS": "prop-thread", "STOP-SIGN": "prop-sign",
  "SUBLET-KEY": "prop-key", "SUNRISE": "prop-sunrise", "TALLY-MARKS": "prop-thread",
  "TEACUP": "prop-teacup", "TEARS": "prop-thread", "TEMPLE-BUILDING": "prop-building",
  "THICK-BOOK": "prop-book", "TIME-CARD": "prop-card", "TOWELS": "prop-boxes",
  "TOWER": "prop-tower", "TRAFFIC-LIGHT": "prop-traffic-light", "TROUBLED-HOUSE": "prop-cracked-house",
  "VOICEMAIL-ICON": "prop-voicemail", "WARNING-TRIANGLE": "prop-warning-triangle",
  "WARMTH-METER": "prop-meter", "WEATHER-CLOUD": "prop-cloud", "WEIGHT": "prop-weight",
  "ZIGZAG-LINE": "prop-thread", "BOXES": "prop-boxes", "GAVEL": "prop-gavel",
  "LENS": "prop-lens", "NET": "prop-net", "CANDLES": "prop-candles",
  // Harbor project props
  "EMAIL-ICON": "prop-envelope", "CHECK-BLOCKS": "prop-boxes",
  "COAT": "prop-briefcase", "TEAM-ICON": "prop-team",
  "SIGN-WELCOMED": "prop-sign", "SIGN-COLLECTED": "prop-sign",
  // Generic extras
  "THOUGHT-BUBBLE": "prop-thought-bubble", "CALENDAR": "prop-calendar",
  "BRIEFCASE": "prop-briefcase", "TALLY": "prop-thread", "ENVELOPE": "prop-envelope",
  "ARROW": "prop-timeline", "LETTER": "prop-job-letter", "HOME": "prop-house",
  // Common Environment Sets
  "ENV-LAUNDROMAT": "prop-env-laundromat", "LAUNDROMAT-SET": "prop-env-laundromat", "LAUNDROMAT": "prop-env-laundromat",
  "ENV-CORRIDOR": "prop-env-corridor", "HALLWAY": "prop-env-corridor", "ELEVATOR-ROW": "prop-env-corridor", "CORRIDOR": "prop-env-corridor",
  "ENV-OFFICE": "prop-env-office", "OFFICE-SET": "prop-env-office", "CUBICLE": "prop-env-office",
  "ENV-CITY": "prop-env-city", "CITY-SET": "prop-env-city", "STREET": "prop-env-city",
  "ENV-ROOM": "prop-env-room", "ROOM-SET": "prop-env-room", "BEDROOM": "prop-env-room", "LIVING-ROOM": "prop-env-room", "APARTMENT": "prop-env-room",
  "ENV-COURT": "prop-env-courtroom", "COURT-SET": "prop-env-courtroom", "COURTROOM": "prop-env-courtroom", "HEARING-ROOM": "prop-env-courtroom",
  // Historical Props
  "SWORD": "prop-sword", "BLADE": "prop-sword", "DAGGER": "prop-sword",
  "SHIELD": "prop-shield",
  "CROWN": "prop-crown", "CORONET": "prop-crown",
  "SCROLL": "prop-scroll", "TREATY": "prop-scroll", "PARCHMENT": "prop-scroll", "DECREE": "prop-scroll",
  "TOMBSTONE": "prop-tombstone", "GRAVE": "prop-tombstone", "GRAVESTONE": "prop-tombstone",
  "SKULL": "prop-skull", "SKELETON": "prop-skull",
  "FIRE": "prop-fire", "FLAMES": "prop-fire", "BONFIRE": "prop-fire", "TORCH": "prop-fire",
  "FLAG": "prop-flag", "BANNER": "prop-flag", "STANDARD": "prop-flag",
  "THRONE": "prop-throne", "ROYAL-CHAIR": "prop-throne",
  "ARMY": "prop-army", "SOLDIERS": "prop-army", "TROOPS": "prop-army", "BATTALION": "prop-army",
  "SHIP": "prop-ship", "WARSHIP": "prop-ship", "GALLEON": "prop-ship", "BOAT": "prop-ship",
  "MAP-EUROPE": "prop-map-europe", "WAR-MAP": "prop-map-europe", "EUROPE-MAP": "prop-map-europe",
  // Historical Environment Sets
  "ENV-CASTLE": "prop-env-castle", "CASTLE-SET": "prop-env-castle", "CASTLE": "prop-env-castle", "FORTRESS": "prop-env-castle",
  "ENV-BATTLEFIELD": "prop-env-battlefield", "BATTLEFIELD-SET": "prop-env-battlefield", "BATTLEFIELD": "prop-env-battlefield", "BATTLE": "prop-env-battlefield",
  "ENV-WAR-ROOM": "prop-env-war-room", "WAR-ROOM-SET": "prop-env-war-room", "WAR-ROOM": "prop-env-war-room", "STRATEGY-ROOM": "prop-env-war-room",
  "ENV-SEA": "prop-env-sea", "SEA-SET": "prop-env-sea", "OCEAN": "prop-env-sea", "NAVAL-SET": "prop-env-sea",
  // Slapstick & Action VFX
  "FIGHT-CLOUD": "prop-fight-cloud", "DUST-CLOUD": "prop-fight-cloud", "BRAWL": "prop-fight-cloud",
  "MUD-PUDDLE": "prop-mud-puddle", "MUD": "prop-mud-puddle", "PUDDLE": "prop-mud-puddle",
  "CLASH-SPARK": "fx-clash-spark", "SPARK": "fx-clash-spark", "CLASH": "fx-clash-spark", "IMPACT": "fx-clash-spark",
  // Chinese Historical Environment Set
  "ENV-CHINESE-PALACE": "prop-env-chinese-palace", "CHINESE-PALACE": "prop-env-chinese-palace",
  "PALACE-SET": "prop-env-chinese-palace", "PALACE": "prop-env-chinese-palace",
  "IMPERIAL-PALACE": "prop-env-chinese-palace", "HAN-PALACE": "prop-env-chinese-palace",
};

export const isEnvName = (name) => {
  const sym = PROP_ALIASES[name] ?? propSymbol(name);
  return sym.startsWith("prop-env-") || /^ENV-/i.test(name) || /-SET$/i.test(name);
};

function sceneEntries(s, dict) {
  const prefix = idOf(s);
  return [
    ...s.cast.map((name) => ({ name, kind: "actor", desc: dict.cast[name] })),
    ...s.props.map((name) => ({ name, kind: "prop", desc: dict.props[name], isEnv: isEnvName(name) })),
  ].map((e, i) => ({
    ...e,
    id: `${prefix}-e${i}`,
    color: tokenIn(e.desc, e.kind === "actor" ? "white" : "tan"),
    outfit: e.kind === "actor" ? dressUp(e.desc) : null,
    scale: null,
  }));
}

/**
 * How big the actors of a scene are drawn. The count of actors, not of entries: a prop
 * does not make a person smaller. A scene with one actor is drawn close up, the way the
 * reference frames are: the figure fills most of the height instead of standing in the
 * middle of an empty frame. A crowded scene stays smaller so nobody overlaps.
 */
const ACTOR_SCALE = { 1: 1.45, 2: 1.15, 3: 1.02 };
const actorScale = (count) => ACTOR_SCALE[count] ?? 1;

/**
 * Horizontal centre of each entry. Entries share the width evenly. A LAYOUT clause
 * with left, right, or center/middle moves the entries it names to that third.
 */
function placeEntries(ents, layout, prevPositions = new Map()) {
  const envEnts = ents.filter((e) => e.isEnv);
  const foreEnts = ents.filter((e) => !e.isEnv);
  const clauses = layout.replace(/facing\s+(left|right)/gi, "").split(/[;,.]/);

  // A size word in a clause scales the entries it names, so "DRYER large on the right"
  // draws a big dryer and "NORA small on the left" draws a small one.
  for (const clause of clauses) {
    for (const [re, size] of SIZE_WORDS) {
      if (!re.test(clause)) continue;
      for (const e of namesIn(clause, ents)) e.scale ??= size;
      break;
    }
  }

  const anchor = new Map();
  for (const clause of clauses) {
    const word = /\b(left|right|center|centre|middle)\b/i.exec(clause);
    if (!word) continue;
    const x = { left: 480, right: 1440 }[word[1].toLowerCase()] ?? 960;
    for (const e of namesIn(clause, ents)) anchor.set(e, x);
  }

  // Inter-scene continuity: if an actor was placed in the previous scene
  // and has no explicit layout direction in this scene, inherit their previous anchor.
  if (prevPositions && prevPositions.size) {
    for (const e of foreEnts) {
      if (e.kind === "actor" && !anchor.has(e) && prevPositions.has(e.name)) {
        anchor.set(e, prevPositions.get(e.name));
      }
    }
  }

  // Environments default to screen center (or layout anchor if specified).
  envEnts.forEach((e) => {
    e.cx = anchor.get(e) ?? Math.round(W / 2);
  });

  const n = foreEnts.length;
  if (n === 0) return;

  const margin = 60;
  const slot = (W - 2 * margin) / n;
  const grid = foreEnts.map((_, i) => Math.round(margin + (i + 0.5) * slot));
  const xs = foreEnts.map(() => null);

  // The width an entry is drawn at, after the scene's actor scale and any size word.
  const widthOf = (e) => Math.round((e.kind === "actor" ? ACTOR.w : PROP.w) * (e.scale ?? 1) * (e.crowd ?? 1));
  // How much of that width is ink. An actor is drawn in a 320 unit box but its head is
  // only 180 wide, so two actors can stand closer than their boxes suggest.
  const visHalf = (e) => (widthOf(e) / 2) * (e.kind === "actor" ? 0.68 : 1);
  // Entries that share an anchor would stack on top of each other, so spread them
  // across it, side by side, by their widths.
  const groups = new Map();
  for (const [e, x] of anchor) {
    if (!e.isEnv) groups.set(x, [...(groups.get(x) ?? []), e]);
  }
  for (const [x, group] of groups) {
    const step = Math.max(...group.map((e) => visHalf(e) * 2 + 40));
    group.forEach((e, j) => {
      xs[foreEnts.indexOf(e)] = Math.round(x + (j - (group.length - 1) / 2) * step);
    });
  }
  // Entries with no LAYOUT anchor go in the free space that is left. The candidates are the
  // even grid slots and the middle of every gap between the entries already placed; the
  // one with the most room around it wins, so nothing lands on top of anything else.
  const placed = [];
  foreEnts.forEach((e, i) => {
    if (xs[i] !== null) placed.push({ x: xs[i], half: visHalf(e) });
  });
  foreEnts.forEach((e, i) => {
    if (xs[i] !== null) return;
    const half = visHalf(e);
    const lo = half + 8;
    const hi = W - half - 8;
    const sorted = [...placed].sort((a, b) => a.x - b.x);
    const gaps = [];
    let edge = 8;
    for (const p of sorted) {
      gaps.push([edge, p.x - p.half]);
      edge = p.x + p.half;
    }
    gaps.push([edge, W - 8]);
    const candidates = [...grid, ...gaps.filter(([a, b]) => b > a).map(([a, b]) => (a + b) / 2)]
      .filter((x) => x >= lo && x <= hi);
    const room = (x) => Math.min(...placed.map((p) => Math.abs(x - p.x) - p.half - half), Infinity);
    let best = candidates[0] ?? Math.round((lo + hi) / 2);
    let bestRoom = -Infinity;
    for (const c of candidates) {
      const r = room(c);
      if (r > bestRoom || (r === bestRoom && Math.abs(c - grid[i]) < Math.abs(best - grid[i]))) {
        bestRoom = r;
        best = c;
      }
    }
    xs[i] = Math.round(best);
    placed.push({ x: xs[i], half });
  });
  foreEnts.forEach((e, i) => {
    // Keep the drawn figure inside the frame: a head on the edge would be cut off.
    const half = Math.round(visHalf(e));
    e.cx = Math.max(half + 8, Math.min(W - half - 8, xs[i]));
  });
}

/** Beats in frame order, each with its named entries and its verb's arguments. Problems go to errors. */
function resolveBeats(s, ents, errors) {
  const actors = ents.filter((e) => e.kind === "actor");
  return [...s.beats]
    .sort((a, b) => a.frame - b.frame)
    .map((b) => {
      const hits = namesIn(b.text, ents);
      let first = hits[0] ?? null;
      if (!first) {
        if (actors.length === 1 && /\b(thumb|hand|face|eye|head|brow|arm)\b/i.test(b.text)) {
          first = actors[0];
        } else if (ents.length === 1) {
          first = ents[0];
        }
      }
      const item = { L: b.frame - s.startF, verb: b.verb, text: b.text, hits, first };
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
          if (!item.first) {
            bad("the text must name the CAST or PROPS entry");
            break;
          }
          if (item.first.kind === "actor") {
            const hit = EXPRESSION_WORDS.find(([re]) => re.test(stripNames(b.text, hits)));
            if (!hit) bad("no known expression word (angry, sly, sweat, confused, shock, tired, panic, or calm)");
            else item.expr = hit[1];
          } else {
            item.propSwap = true;
          }
          break;
        }
        case "DRAW":
          if (hits.length >= 2) {
            item.from = hits[0];
            item.to = hits[1];
          } else if (hits.length === 1 || item.first) {
            item.target = hits[0] || item.first;
            const labelMatch = /["\u201C\u201D]([^"\u201C\u201D]+)["\u201C\u201D]|label\s+["'“]?([a-zA-Z0-9_-]+)["'”]?/i.exec(b.text);
            item.calloutLabel = labelMatch ? (labelMatch[1] || labelMatch[2]).toUpperCase() : "";
          } else {
            bad("the text must name at least one CAST or PROPS entry");
          }
          break;
        case "CALLOUT": {
          // CALLOUT: "LABEL" -> ENTRY   or   CALLOUT: "LABEL" pointing at ENTRY
          const labelMatch = /["\u201C\u201D]([^"\u201C\u201D]+)["\u201C\u201D]/.exec(b.text);
          item.calloutLabel = labelMatch ? labelMatch[1].toUpperCase() : "";
          item.first = hits[0] ?? null;
          break;
        }
        case "HOLD":
        case "PUSH":
          break;
        default:
          bad("unknown verb");
      }
      return item;
    });
}

/**
 * Shade step for a figure or prop: the flat -dark tone of its colour. Set as --tone on the
 * svg, which the library's shade bands read. --tone-head is the head's own shade.
 */
const SHADE_OF = { white: "white-dark", black: "black-dark" };
function toneOf(color) {
  return TONES[SHADE_OF[color] ?? `${color}-dark`] ?? TONES["grey-dark"];
}

/** The box an entry is drawn in, after the scale its LAYOUT clause asked for. */
function geom(e) {
  if (e.isEnv) {
    const s = e.scale ?? 1.6;
    const w = Math.round(1200 * s);
    const h = Math.round(400 * s);
    const floorY = 360 * s;
    const top = Math.round(GROUND - floorY);
    return { w, h, top, half: w / 2, cy: top + h / 2, reach: 0 };
  }
  const s = (e.scale ?? 1) * (e.crowd ?? 1);
  // FRAMING: bust/foreground scales actor to ~2× and anchors them low-left as a half-body crop.
  const framing = e.framing ?? "normal";
  if (e.kind === "actor") {
    const fs = framing === "bust" ? 1.9 : 1;
    const ws = Math.round(ACTOR.w * s * fs);
    const hs = Math.round(ACTOR.h * s * fs);
    const top = Math.round(ACTOR.feetY - (RIG_FEET / 460) * hs);
    return { w: ws, h: hs, top, half: ws / 2, cy: top + hs / 2, reach: ACTOR.reach * s * fs };
  }
  const w = Math.round(PROP.w * s);
  const h = Math.round(PROP.h * s);
  const top = Math.round(GROUND - h);
  return { w, h, top, half: w / 2, cy: top + h / 2, reach: 120 * s };
}

function use(id) {
  return `<use href="#${id}" x="-160" y="-110" width="320" height="460"/>`;
}

function actorMarkup(e, enter) {
  const o = e.outfit;
  const g = geom(e);
  const layers = [...e.exprKeys]
    .map((k) => {
      const face = EXPRESSIONS[k];
      return `<g id="${e.id}-x-${k}" opacity="${k === "neutral" ? 1 : 0}">${use(face.brows)}${use(face.eyes)}${use(face.mouth)}</g>`;
    })
    .join("");
  const hidden = enter.has(e) ? 0 : 1;
  const vars = [
    `--tone:${toneOf(o.garment?.color ?? o.head)}`,
    `--tone-head:${toneOf(o.head)}`,
    o.cape ? `--c-cape:${PALETTE[o.cape.color]}` : "",
    o.cape ? `--tone-cape:${toneOf(o.cape.color)}` : "",
    o.garment ? `--c-garment:${PALETTE[o.garment.color]}` : "",
    o.hat ? `--c-hat:${PALETTE[o.hat.color]}` : "",
    o.hair ? `--c-hair:${PALETTE[o.hair.color]}` : "",
    o.beard ? `--c-beard:${PALETTE[o.beard.color]}` : "",
    o.scarf ? `--c-scarf:${PALETTE[o.scarf.color]}` : "",
    o.tie ? `--c-tie:${PALETTE[o.tie.color]}` : "",
  ].filter(Boolean).join(";");
  // Clothes under the head, and clothes over it.
  const under = [
    o.garment ? use(o.garment.symbol) : "",
    o.hood ? use("rig-hood") : "",
    o.tie ? use("rig-tie") : "",
  ].join("");
  const over = [
    o.hair ? use(o.hair.symbol) : "",
    o.beard ? use(o.beard.symbol) : "",
    o.hat ? use(o.hat.symbol) : "",
    o.glasses ? use("rig-glasses") : "",
    o.scarf ? use("rig-scarf") : "",
  ].join("");
  // Pose override: if the cast description requested a specific limb pose, show that idle variant.
  const defaultLimb = o.pose ?? "rig-limb-idle";
  const limbs = ["rig-limb-idle", "rig-limb-point", "rig-limb-walk", "rig-limb-clipboard", "rig-limb-crossed", "rig-limb-panic"]
    .map((sym) => `<g id="${e.id}-limb-${sym.replace("rig-limb-","")}" opacity="${sym === defaultLimb ? 1 : 0}">${use(sym)}</g>`)
    .join("\n");
  const isPill = o.garment?.symbol === "rig-body-pill";
  const bodyMarkup = isPill
    ? `${o.cape ? use(o.cape.symbol) : ""}${limbs}\n${under}`
    : `${o.cape ? use(o.cape.symbol) : ""}${use("rig-body")}${under}\n${limbs}`;
  return `<div id="${e.id}" class="actor" style="left:${e.cx - g.half}px;top:${g.top}px;width:${g.w}px;height:${g.h}px;opacity:${hidden}">
<svg width="${g.w}" height="${g.h}" viewBox="-160 -110 320 460" color="${PALETTE[o.head]}" style="display:block;overflow:visible;${vars}">
${bodyMarkup}
${use("rig-head")}
${layers}
${over}
</svg>
</div>`;
}

/** Label colour for a background: black where the spec allows it, else the spec's first allowed text colour. */
function labelColor(bg) {
  const allowed = CONTRAST[bg] ?? ["black"];
  return allowed.includes("black") ? "black" : allowed[0];
}



/**
 * A prop is drawn from its library symbol. A prop with no symbol yet is a labelled
 * box, which is a placeholder and fails the placeholder gate in AGENTS.md.
 */
function propMarkup(e, enter, label, symbols, text) {
  const g = geom(e);
  const hidden = enter.has(e) ? 0 : 1;
  const id = PROP_ALIASES[e.name] ?? propSymbol(e.name);
  const sym = symbols.get(id);
  if (e.isEnv) {
    const art = sym
      ? `<use href="#${id}" x="0" y="0" width="${g.w}" height="${g.h}"/>`
      : `<rect x="0" y="0" width="${g.w}" height="${g.h}" fill="${PALETTE[e.color]}" stroke="${PALETTE.black}" stroke-width="4"/>`;
    return `<div id="${e.id}" class="actor env-backdrop" style="left:${e.cx - g.half}px;top:${g.top}px;width:${g.w}px;height:${g.h}px;opacity:${hidden};z-index:0;pointer-events:none">
<svg width="${g.w}" height="${g.h}" viewBox="0 0 1200 400" color="${PALETTE[e.color]}" style="display:block;overflow:visible;--tone:${toneOf(e.color)}">
${art}
</svg>
</div>`;
  }
  const art = sym
    ? /<text class="prop-(text|label)"/.test(sym)
      ? filledSymbol(sym, text, e.color)
      : `<use href="#${id}" x="0" y="0" width="${PROP.w}" height="${PROP.h}"/>`
    : `<rect x="5" y="5" width="230" height="250" fill="${PALETTE[e.color]}" stroke="${PALETTE.black}" stroke-width="10" stroke-linejoin="round"/>
<text x="120" y="-14" text-anchor="middle" font-family="Lato" font-weight="700" font-size="22" fill="${PALETTE[label]}">${esc(e.name)}</text>`;
  return `<div id="${e.id}" class="actor" style="left:${e.cx - g.half}px;top:${g.top}px;width:${g.w}px;height:${g.h}px;opacity:${hidden}">
<svg width="${g.w}" height="${g.h}" viewBox="0 0 ${PROP.w} ${PROP.h}" color="${PALETTE[e.color]}" style="display:block;overflow:visible;--tone:${toneOf(e.color)}">
${art}
</svg>
</div>`;
}

/** The words a prop shows: a calendar reading 1961, a sign reading DANGER, a box labeled
 * EVERYTHING. They come from the prop's description or from the beat that brings it on. */
const LABEL_PATTERNS = [
  /reading\s+["'“]?([^"'”,;]+)["'”]?/i,
  /labeled\s+["'“]?([^"'”,;]+)["'”]?/i,
  /with a single\s+["'“]?([\w?]+)["'”]?/i,
  /with a big\s+(?:black\s+)?(?:number\s+)?([\w?]+)/i,
  /showing\s+["'“]?([^"'”,;]+)["'”]?/i,
];
const NOT_A_LABEL = new Set(["number", "big", "black", "white", "the", "a", "an", "one", "two"]);

function propLabel(e, dict, beats) {
  const texts = [dict.props?.[e.name], ...beats.filter((b) => namesIn(b.text, [e]).length).map((b) => b.text)];
  for (const t of texts) {
    for (const re of LABEL_PATTERNS) {
      const m = re.exec(String(t ?? ""));
      if (!m) continue;
      const label = m[1].trim().replace(/[.,;]+$/, "");
      if (!label || label.length > 12 || NOT_A_LABEL.has(label.toLowerCase())) continue;
      return label;
    }
  }
  return null;
}

/** The inner markup of a library symbol, with its text slot filled or cleared. */
const DARK_PROPS = new Set(["black", "night", "cobalt", "brown", "grey"]);
function filledSymbol(symbolMarkup, text, color) {
  let body = symbolMarkup.replace(/^<symbol\b[^>]*>/, "").replace(/<\/symbol>$/, "").trim();
  if (!/<text class="prop-(text|label)"/.test(body)) return body;
  if (!text) return body.replace(/<text class="prop-(text|label)"[\s\S]*?<\/text>/, "");
  const size = text.length <= 2 ? 64 : text.length <= 5 ? 44 : 28;
  const small = Math.max(10, Math.min(22, Math.round(110 / Math.max(1, text.length * 0.62))));
  const fill = DARK_PROPS.has(color) ? PALETTE.white : PALETTE.black;
  return body.replace(/<text class="(prop-text|prop-label)"([^>]*)>([\s\S]*?)<\/text>/, (m, kind, attrs) => {
    const a = attrs
      .replace(/font-size="[^"]*"/, `font-size="${kind === "prop-label" ? small : size}"`)
      .replace(/fill="[^"]*"/, `fill="${fill}"`);
    return `<text class="${kind}"${a}>${esc(text)}</text>`;
  });
}

/** Arrow from the centre of a to the centre of b, stopped short of both, with a two-stroke head. */
function arrowD(a, b) {
  const ga = geom(a);
  const gb = geom(b);
  const ax = a.cx;
  const ay = ga.cy;
  const dx = b.cx - ax;
  const dy = gb.cy - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = ax + ux * ga.reach;
  const sy = ay + uy * ga.reach;
  const ex = b.cx - ux * gb.reach;
  const ey = gb.cy - uy * gb.reach;
  const ang = (28 * Math.PI) / 180;
  const back = [-ux, -uy];
  const rot = (v, t) => [v[0] * Math.cos(t) - v[1] * Math.sin(t), v[0] * Math.sin(t) + v[1] * Math.cos(t)];
  const w1 = rot(back, ang);
  const w2 = rot(back, -ang);
  const r = Math.round;
  return `M${r(sx)} ${r(sy)} L${r(ex)} ${r(ey)} M${r(ex + w1[0] * 48)} ${r(ey + w1[1] * 48)} L${r(ex)} ${r(ey)} L${r(ex + w2[0] * 48)} ${r(ey + w2[1] * 48)}`;
}

/** Builds one scene composition. Returns { html, errors, positions }. */
function buildScene(s, dict, symbols, prevPositions = new Map()) {
  const errors = [];
  const sid = idOf(s);
  const N = s.frames;
  const ents = sceneEntries(s, dict);
  const aScale = actorScale(ents.filter((e) => e.kind === "actor").length);
  for (const e of ents) e.crowd = e.kind === "actor" ? aScale : 1;
  placeEntries(ents, s.layout || "", prevPositions);
  const beats = resolveBeats(s, ents, errors);
  if (errors.length) return { html: "", errors, positions: new Map() };
  const actors = ents.filter((e) => e.kind === "actor");

  // Pass A: which faces and entries exist, when entries enter, where the camera starts.
  for (const e of actors) e.exprKeys = new Set(["neutral"]);
  const enter = new Map();
  let pushStart = s.camera === "push" ? 0 : null;
  for (const b of beats) {
    if (b.verb === "SWAP" && b.expr && b.first?.kind === "actor") b.first.exprKeys.add(b.expr);
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
  // The boil swaps once a second (every 24 frames). Each swap re-runs the turbulence filter over the whole ink layer, so a faster swap is the heaviest part of the render.
  for (let n = 0; n < N; n += 24) {
    ops.push(`tl.set("#${inkId}", { filter: "url(#${sid}-boil-${"abc"[(n / 24) % 3]})" }, ${at(n)});`);
  }
  let arrowN = 0;
  let crossN = 0;
  for (const b of beats) {
    const t = b.first;
    const L = b.L;
    const a = (k) => at(L + k);
    switch (b.verb) {
      case "POP": {
        const sym = t ? (PROP_ALIASES[t.name] ?? propSymbol(t.name)) : "";
        if (sym === "prop-fight-cloud") {
          ops.push(`tl.fromTo("#${t.id}", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1.15, duration: ${at(3)}, ease: "back.out(2)", immediateRender: false }, ${at(L)});`);
          for (let k = 0; k < 10; k++) {
            const jx = k % 2 === 0 ? 10 : -10;
            const rot = k % 4 === 0 ? 6 : k % 4 === 2 ? -6 : 0;
            ops.push(`tl.set("#${t.id}", { x: ${jx}, rotation: ${rot} }, ${a(3 + k * 2)});`);
          }
          ops.push(`tl.set("#${t.id}", { x: 0, rotation: 0 }, ${a(23)});`);
        } else if (sym === "fx-clash-spark") {
          ops.push(`tl.fromTo("#${t.id}", { opacity: 0, scale: 0.3 }, { opacity: 1, scale: 1.4, duration: ${at(2)}, ease: "power4.out", immediateRender: false }, ${at(L)});`);
          ops.push(`tl.to("#${t.id}", { scale: 1.8, opacity: 0, duration: ${at(4)}, ease: "power2.in" }, ${a(2)});`);
        } else {
          ops.push(`tl.fromTo("#${t.id}", { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1.06, duration: ${at(4)}, ease: "power2.out", immediateRender: false }, ${at(L)});`);
          ops.push(`tl.to("#${t.id}", { scale: 1, duration: ${at(2)} }, ${a(4)});`);
        }
        break;
      }
      case "STAMP":
        ops.push(`tl.fromTo("#${t.id}", { opacity: 0, scale: 1.5 }, { opacity: 1, scale: 0.96, duration: ${at(3)}, ease: "power4.in", immediateRender: false }, ${at(L)});`);
        ops.push(`tl.to("#${t.id}", { scale: 1, duration: ${at(2)}, ease: "power1.out" }, ${a(3)});`);
        break;
      case "SLIDE": {
        const from = /from the right/i.test(b.text) ? 400 : -400;
        ops.push(`tl.fromTo("#${t.id}", { x: ${from}, opacity: 0 }, { x: 0, opacity: 1, duration: ${at(12)}, ease: "power2.out", immediateRender: false }, ${at(L)});`);
        break;
      }
      case "SHAKE":
        for (let k = 0; k < 8; k++) ops.push(`tl.set("#${t.id}", { x: ${k % 2 ? -8 : 8} }, ${a(k)});`);
        ops.push(`tl.set("#${t.id}", { x: 0 }, ${a(8)});`);
        break;
      case "SWAP":
        if (t && t.kind === "actor" && b.expr) {
          for (const k of t.exprKeys) ops.push(`tl.set("#${t.id}-x-${k}", { opacity: ${k === b.expr ? 1 : 0} }, ${at(L)});`);
          t.state.expr = b.expr;
          t.poses.add(poseKey(t.state));
          if (/\b(mud|puddle|face-first|headfirst)\b/i.test(b.text)) {
            ops.push(`tl.to("#${t.id}", { rotation: 180, y: "+=160", transformOrigin: "center center", duration: ${at(6)}, ease: "power2.in" }, ${at(L)});`);
          } else if (b.expr === "dead" || /\b(dead|collaps\w*|fall\w*|tumble\w*)\b/i.test(b.text)) {
            const rot = t.cx < W / 2 ? 90 : -90;
            ops.push(`tl.to("#${t.id}", { rotation: ${rot}, y: "+=120", transformOrigin: "center center", duration: ${at(6)}, ease: "bounce.out" }, ${at(L)});`);
          }
        } else if (t) {
          ops.push(`tl.fromTo("#${t.id}", { scale: 1.08 }, { scale: 1, duration: ${at(2)}, ease: "power1.out" }, ${at(L)});`);
        }
        break;
      case "DRAW": {
        if (b.from && b.to) {
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
        } else if (b.target) {
          const tgt = b.target;
          const ga = geom(tgt);
          const cx = tgt.cx;
          const cy = ga.cy;
          const id = `${sid}-draw${arrowN++}`;
          if (/checkmark|check/i.test(b.text)) {
            const chk = `M${cx - 24} ${cy} L${cx - 6} ${cy + 20} L${cx + 28} ${cy - 20}`;
            arrows.push(`<path id="${id}" class="draw" pathLength="1" stroke="${PALETTE.green}" stroke-width="14" d="${chk}"/>`);
            ops.push(`tl.fromTo("#${id}", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: ${at(8)}, ease: "power1.out" }, ${at(L)});`);
          } else {
            const tx1 = Math.max(60, cx - 180);
            const ty1 = Math.max(80, cy - 140);
            const dx = cx - tx1;
            const dy = cy - ty1;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len; const uy = dy / len;
            const ex = cx - ux * 40; const ey = cy - uy * 40;
            const arr = `M${Math.round(tx1)} ${Math.round(ty1)} L${Math.round(ex)} ${Math.round(ey)}`;
            const labelFill = PALETTE[labelColor(s.bg)];
            const svg = `<path id="${id}-line" class="draw" pathLength="1" stroke="${PALETTE.yellow}" stroke-width="8" d="${arr}"/>` +
              (b.calloutLabel ? `<text id="${id}-txt" class="callout-label" x="${Math.round(tx1 - 10)}" y="${Math.round(ty1 - 10)}" text-anchor="end" font-family="Permanent Marker, Arial, sans-serif" font-weight="400" font-size="44" fill="${labelFill}" style="-webkit-text-stroke:4px ${PALETTE.black};paint-order:stroke fill">${esc(b.calloutLabel)}</text>` : "");
            arrows.push(svg);
            ops.push(`tl.fromTo("#${id}-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: ${at(10)}, ease: "power1.out" }, ${at(L)});`);
            if (b.calloutLabel) ops.push(`tl.fromTo("#${id}-txt", { opacity: 0 }, { opacity: 1, duration: ${at(3)}, ease: "power1.out" }, ${at(L + 8)});`);
          }
        }
        break;
      }
      case "CALLOUT": {
        // Render a hand-drawn diagonal callout arrow with a short label beside the arrowhead.
        const calloutN = arrowN++;
        const callId = `${sid}-co${calloutN}`;
        const tgtX = t ? t.cx : W / 2;
        const tgtY = t ? (geom(t).top + geom(t).h / 2) : H / 2;
        const tx1 = Math.max(60, tgtX - 220);
        const ty1 = Math.max(80, tgtY - 180);
        const dx = tgtX - tx1;
        const dy = tgtY - ty1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len; const uy = dy / len;
        const ang = (28 * Math.PI) / 180;
        const cos28 = Math.cos(ang); const sin28 = Math.sin(ang);
        const ex = tgtX - ux * 40; const ey = tgtY - uy * 40;
        const h1x = -ux * cos28 - uy * sin28; const h1y = -ux * sin28 + uy * cos28;
        const h2x = -ux * cos28 + uy * sin28; const h2y = ux * sin28 + uy * cos28;
        const arrowPath = `M${Math.round(tx1)},${Math.round(ty1)} Q${Math.round(tx1 + dx * 0.4 + uy * 60)},${Math.round(ty1 + dy * 0.4 - ux * 60)} ${Math.round(ex)},${Math.round(ey)} M${Math.round(ex)},${Math.round(ey)} L${Math.round(ex + h1x * 42)},${Math.round(ey + h1y * 42)} M${Math.round(ex)},${Math.round(ey)} L${Math.round(ex + h2x * 42)},${Math.round(ey + h2y * 42)}`;
        const labelFill = PALETTE[labelColor(s.bg)];
        const calloutSvg = `<path id="${callId}-line" class="draw" pathLength="1" d="${arrowPath}" fill="none" stroke="${PALETTE.black}" stroke-width="7" stroke-linecap="round"/>` +
          (b.calloutLabel ? `<text id="${callId}-txt" class="callout-label" x="${Math.round(tx1 - 10)}" y="${Math.round(ty1 - 14)}" text-anchor="end" font-family="Permanent Marker, Arial, sans-serif" font-weight="400" font-size="44" fill="${labelFill}" style="-webkit-text-stroke:4px ${PALETTE.black};paint-order:stroke fill">${esc(b.calloutLabel)}</text>` : "");
        arrows.push(calloutSvg);
        if (L > 0) {
          ops.push(`tl.fromTo("#${callId}-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: ${at(10)}, ease: "power1.out", immediateRender: false }, ${at(L)});`);
          if (b.calloutLabel) ops.push(`tl.fromTo("#${callId}-txt", { opacity: 0 }, { opacity: 1, duration: ${at(3)}, ease: "power1.out", immediateRender: false }, ${at(L + 8)});`);
        }
        break;
      }
      case "CROSS": {
        const c = geom(t);
        const h = c.reach;
        const lines = [
          [`${t.cx - h}`, `${c.cy - h}`, `${t.cx + h}`, `${c.cy + h}`],
          [`${t.cx + h}`, `${c.cy - h}`, `${t.cx - h}`, `${c.cy + h}`],
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

  // Headlines (top only, as the spec requires). Each one replaces the previous at its time, so the previous one is hidden when the next starts.
  // The size follows the length, so a short headline fills the width like the reference frames
  // and a long one still fits inside 1920.
  const headlines = s.texts.map((tx, k) => {
    const L = tx.frame - s.startF;
    const text = tx.text.toUpperCase();
    const size = Math.max(80, Math.min(150, Math.round(1700 / Math.max(1, text.length * 0.62))));
    // The headline pops in from a bigger size, but never from so big that it leaves the frame.
    const pop = Math.min(1.45, 1800 / Math.max(1, text.length * 0.62 * size));
    if (k > 0) ops.push(`tl.set("#${sid}-t${k - 1}", { opacity: 0 }, ${at(L)});`);
    ops.push(`tl.fromTo("#${sid}-t${k}", { opacity: 0, scale: ${pop.toFixed(2)} }, { opacity: 1, scale: 1, duration: ${at(3)}, ease: "power2.out" }, ${at(L)});`);
    return `<div id="${sid}-t${k}" class="ttl" style="color:${PALETTE[tx.color]};opacity:0;font-size:${size}px">${esc(text)}</div>`;
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
  const label = labelColor(s.bg);
  const envEnts = ents.filter((e) => e.isEnv);
  const foreEnts = ents.filter((e) => !e.isEnv);
  const entityMarkup = [
    ...envEnts.map((e) => propMarkup(e, enter, label, symbols, propLabel(e, dict, beats))),
    ...foreEnts.map((e) => (e.kind === "actor" ? actorMarkup(e, enter) : propMarkup(e, enter, label, symbols, propLabel(e, dict, beats)))),
  ].join("\n");
  const stage = `<div id="${sid}-stage" class="fill" style="background:${bgHex}">
${ground}
<div id="${sid}-ink" class="fill">
${entityMarkup}
${overlaySvg}
</div>
${headlines.join("\n")}
</div>
${overlay}`;
  const ids = referencedIds(stage);
  const missing = ids.filter((id) => !symbols.has(id));
  if (missing.length) errors.push(`${s.id}: library has no symbol(s) ${missing.join(", ")}`);
  const defs = ids.filter((id) => symbols.has(id)).map((id) => symbols.get(id)).join("\n");
  const boil = ["a", "b", "c"].map((k, i) => `<filter id="${sid}-boil-${k}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${i + 1}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>`).join("\n");

  // The defs sit inside #root, not in a <template>-level svg: only #root is kept in the live DOM,
  // so symbols and boil filters outside it were lost and the actors did not render.
  const root = `<div id="root" data-composition-id="${sid}" data-width="${W}" data-height="${H}">\n<svg width="0" height="0" style="position: absolute" aria-hidden="true">\n<defs>\n${boil}\n${defs}\n</defs>\n</svg>\n${stage}\n</div>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <template>
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
  const positions = new Map();
  for (const e of actors) positions.set(e.name, e.cx);
  return { html, errors, positions };
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
        .env-backdrop { position: absolute; transform-origin: 50% 50%; }
        .ttl {
          position: absolute; top: 60px; left: 0; width: ${W}px; margin: 0; text-align: center;
          font-family: "Permanent Marker", Arial, sans-serif; font-weight: 400; font-size: 110px; line-height: 1;
          transform-origin: 50% 50%;
          -webkit-text-stroke: 12px ${PALETTE.black}; paint-order: stroke fill;
          letter-spacing: 2px;
        }
        .draw { stroke-dasharray: 1 1; }
        .callout-label { pointer-events: none; }`;

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
function fallDrop(actor, maxDrop) {
  return Math.min(maxDrop, 864 - GROUND);
}

export { fallDrop };

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

  const scenes = [];
  let prevPositions = new Map();
  for (const s of tl.scenes) {
    const res = buildScene(s, dict, symbols, prevPositions);
    scenes.push({ id: idOf(s), ...res });
    prevPositions = res.positions ?? new Map();
  }
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
