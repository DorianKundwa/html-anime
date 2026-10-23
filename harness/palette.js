/**
 * The hex lock. Every color allowed in film/ is in this file.
 * black and night are additions to the channel palette (outlines, text, night scenes).
 */

export const PALETTE = {
  orange: "#F5820D",
  cobalt: "#2D5FBF",
  green: "#3A9E3A",
  yellow: "#F5C518",
  red: "#D94040",
  brown: "#8B5E3C",
  sky: "#6EB5E8",
  tan: "#C4965A",
  grey: "#4A4A4A",
  white: "#FFFFFF",
  black: "#000000",
  night: "#1B2A4A",
  pink: "#F4A7B9",
  gold: "#D4A017",
  purple: "#7B4FA0",
  mint: "#A8E6CF",
};

/**
 * Flat tone variants for shading one flat fill against itself (a shadow side, a highlight).
 * They are NOT channel tokens: they are absent from PALETTE, so they cannot be used as
 * TEXT colors, BG tokens, OUT color-dip targets or cast/prop colors. They are allowed in film/.
 * -dark is 70% of the base channel; -light is the base 45% of the way to white.
 */
export const TONES = {
  "orange-dark": "#AC5B09",
  "orange-light": "#FABA7A",
  "cobalt-dark": "#1F4386",
  "cobalt-light": "#8CA7DC",
  "green-dark": "#296F29",
  "green-light": "#93CA93",
  "yellow-dark": "#AC8A11",
  "yellow-light": "#FADF80",
  "red-dark": "#982D2D",
  "red-light": "#EA9696",
  "brown-dark": "#61422A",
  "brown-light": "#BFA694",
  "sky-dark": "#4D7FA2",
  "sky-light": "#AFD6F2",
  "tan-dark": "#89693F",
  "tan-light": "#DFC5A4",
  "grey-dark": "#343434",
  "grey-light": "#9B9B9B",
  "night-dark": "#131D34",
  "night-light": "#828A9B",
  "white-dark": "#D8D8D8",
  "white-light": "#F0F0F0",
  "black-dark": "#1A1A1A",
  "black-light": "#3A3A3A",
  "pink-dark": "#C97A90",
  "pink-light": "#FBD3DE",
  "gold-dark": "#9E7A10",
  "gold-light": "#EBC766",
  "purple-dark": "#5A3677",
  "purple-light": "#A98BC6",
  "mint-dark": "#7DB59B",
  "mint-light": "#D3F3E5",
};

/** Background tokens from the scene-sheet spec. sky+ground is sky with a green strip. */
export const BG_TOKENS = [
  "white", "tan", "brown", "orange", "cobalt", "sky", "sky+ground", "grey", "night", "red", "yellow",
];

/** Palette tokens usable as TEXT colors and OUT color-dip targets. */
export const TOKEN_NAMES = Object.keys(PALETTE);

export function cssVars() {
  const lines = Object.entries({ ...PALETTE, ...TONES }).map(([k, v]) => `  --${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

/** Returns every hex color in `text` that is not in the palette (case-insensitive). */
export function offPaletteColors(text) {
  const allowed = new Set([...Object.values(PALETTE), ...Object.values(TONES)].map((v) => v.toUpperCase()));
  const found = new Set();
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const hex = m[0].toUpperCase();
    const full = hex.length === 4 ? "#" + [...hex.slice(1)].map((c) => c + c).join("") : hex;
    if (!allowed.has(full)) found.add(m[0]);
  }
  for (const m of text.matchAll(/\b(rgba?|hsla?)\(/gi)) found.add(m[0]);
  return [...found];
}
