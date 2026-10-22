import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * Renders a Manim 2D scene at 24 fps.
 *
 * @param {string} sceneName - Class name of the scene in harness/manim/scenes.py
 * @param {object} [opts]
 * @param {string} [opts.scriptPath] - Custom Python script path (defaults to harness/manim/scenes.py)
 * @param {string} [opts.outDir] - Directory where output is saved
 * @param {string} [opts.outFile] - Custom output filename (e.g. "map.mov")
 * @param {boolean} [opts.transparent=true] - Render with transparent alpha channel
 * @param {string} [opts.quality="l"] - "l" (low/fast preview), "m" (medium), "h" (1080p production)
 * @returns {Promise<{ ok: boolean, output: string, error?: string }>}
 */
export async function renderManim(sceneName, opts = {}) {
  const script = resolve(opts.scriptPath || join(process.cwd(), "harness", "manim", "scenes.py"));
  const quality = opts.quality || "m";
  const transparent = opts.transparent !== false;
  const outDir = resolve(opts.outDir || join(process.cwd(), "media", "manim"));
  mkdirSync(outDir, { recursive: true });

  const outFile = opts.outFile || `${sceneName.toLowerCase()}.${transparent ? "mov" : "mp4"}`;
  const targetPath = join(outDir, outFile);

  const args = [
    `-q${quality}`,
    "--fps", "24",
    "-r", "1920,1080",
  ];
  if (transparent) args.push("-t");
  args.push(script, sceneName, "-o", outFile, "--media_dir", outDir);

  try {
    const { stdout, stderr } = await execFileAsync("manim", args);

    // Locate the rendered movie from stdout or recursively in outDir
    const match = /File ready at '([^']+)'/.exec(stdout);
    let actualPath = match ? match[1] : null;
    if (!actualPath || !existsSync(actualPath)) {
      const findFile = (dir) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, item.name);
          if (item.isDirectory()) {
            const found = findFile(p);
            if (found) return found;
          } else if (item.name === outFile) {
            return p;
          }
        }
        return null;
      };
      actualPath = findFile(outDir);
    }
    if (actualPath && actualPath !== targetPath && existsSync(actualPath)) {
      copyFileSync(actualPath, targetPath);
    }

    return { ok: true, output: targetPath, actualPath, stdout, stderr };
  } catch (err) {
    return { ok: false, output: targetPath, error: err.message, stderr: err.stderr };
  }
}
