/**
 * Inlines the library symbols that a scene file references.
 *
 *   node harness/inline-library.js projects/<slug> [file.html ...]
 *
 * Each scene file gets one hidden <svg> with the <symbol>s it uses, between
 * BEGIN/END markers. Rerunning replaces the block. A reference to a symbol that
 * the library does not define is an error.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BEGIN = "<!-- library:begin -->";
const END = "<!-- library:end -->";

/** Map of symbol id -> full <symbol>…</symbol> markup from the library SVG. */
export function readSymbols(librarySvg) {
  const symbols = new Map();
  for (const m of librarySvg.matchAll(/<symbol\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/symbol>/g)) {
    symbols.set(m[1], m[0]);
  }
  return symbols;
}

/** Ids referenced as href="#id" or xlink:href="#id" in a scene file. */
export function referencedIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/(?:xlink:)?href="#([^"]+)"/g)) ids.add(m[1]);
  return [...ids];
}

/** Returns the scene html with its library block rebuilt. Throws on unknown ids. */
export function inlineLibrary(html, symbols) {
  const stripped = html.replace(new RegExp(`\\n?${BEGIN}[\\s\\S]*?${END}\\n?`, "g"), "");
  const ids = referencedIds(stripped);
  const missing = ids.filter((id) => !symbols.has(id));
  if (missing.length) throw new Error(`library has no symbol(s): ${missing.join(", ")}`);
  if (!ids.length) return stripped;

  const defs = ids.map((id) => symbols.get(id)).join("\n");
  const block = `${BEGIN}\n<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>\n${defs}\n</defs></svg>\n${END}\n`;

  const bodyOpen = /<body\b[^>]*>/i.exec(stripped);
  if (!bodyOpen) return block + stripped;
  const at = bodyOpen.index + bodyOpen[0].length;
  return stripped.slice(0, at) + "\n" + block + stripped.slice(at);
}

/** Inlines into each file. Returns the list of files it wrote. */
export function inlineIntoFiles(files, librarySvg) {
  const symbols = readSymbols(librarySvg);
  const written = [];
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const after = inlineLibrary(before, symbols);
    if (after !== before) {
      writeFileSync(file, after);
      written.push(file);
    }
  }
  return written;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node harness/inline-library.js projects/<slug> [file.html ...]");
    process.exit(2);
  }
  const libraryPath = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "library.svg");
  if (!existsSync(libraryPath)) {
    console.error(`error: ${libraryPath} is missing`);
    process.exit(1);
  }
  let files = process.argv.slice(3);
  if (!files.length) {
    const compDir = join(dir, "film", "compositions");
    files = existsSync(compDir)
      ? readdirSync(compDir).filter((f) => f.endsWith(".html")).map((f) => join(compDir, f))
      : [];
  }
  try {
    const written = inlineIntoFiles(files, readFileSync(libraryPath, "utf8"));
    for (const f of written) console.log(`inlined library into ${basename(f)}`);
    console.log(`ok: ${files.length} file(s) checked, ${written.length} updated`);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}
