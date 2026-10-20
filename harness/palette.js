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
};

/** Background tokens from the scene-sheet spec. sky+ground is sky with a green strip. */
export const BG_TOKENS = [
  "white", "tan", "brown", "orange", "cobalt", "sky", "sky+ground", "grey", "night", "red", "yellow",
];

/** Palette tokens usable as TEXT colors and OUT color-dip targets. */
export const TOKEN_NAMES = Object.keys(PALETTE);

export function cssVars() {
  const lines = Object.entries(PALETTE).map(([k, v]) => `  --${k}: ${v};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}

/** Returns every hex color in `text` that is not in the palette (case-insensitive). */
export function offPaletteColors(text) {
  const allowed = new Set(Object.values(PALETTE).map((v) => v.toUpperCase()));
  const found = new Set();
  for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const hex = m[0].toUpperCase();
    const full = hex.length === 4 ? "#" + [...hex.slice(1)].map((c) => c + c).join("") : hex;
    if (!allowed.has(full)) found.add(m[0]);
  }
  for (const m of text.matchAll(/\b(rgba?|hsla?)\(/gi)) found.add(m[0]);
  return [...found];
}
