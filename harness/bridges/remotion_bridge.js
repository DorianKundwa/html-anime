import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * Renders a Remotion 2D composition at 24 fps.
 *
 * @param {string} compositionId - Composition ID (e.g. "KineticTitle", "StatCard", "DialogueBox")
 * @param {object} [opts]
 * @param {string} [opts.outPath] - Destination MP4 path
 * @param {object} [opts.props] - Dynamic React props to pass into composition
 * @param {number} [opts.concurrency=4] - Parallel render workers
 * @returns {Promise<{ ok: boolean, output: string, error?: string }>}
 */
export async function renderRemotion(compositionId, opts = {}) {
  const remotionDir = resolve(join(process.cwd(), "remotion"));
  const entryPoint = join("src", "index.js");
  const outPath = resolve(opts.outPath || join(process.cwd(), "media", "remotion", `${compositionId.toLowerCase()}.mp4`));

  mkdirSync(join(outPath, ".."), { recursive: true });

  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";

  const args = [
    "remotion", "render",
    entryPoint,
    compositionId,
    outPath,
    "--port", "30333",
    "--concurrency", String(opts.concurrency || 4),
  ];

  if (opts.props) {
    const tmpProps = join(process.cwd(), "build", "tmp", `remotion-props-${Date.now()}.json`);
    mkdirSync(join(tmpProps, ".."), { recursive: true });
    writeFileSync(tmpProps, JSON.stringify(opts.props), "utf8");
    args.push(`--props=${tmpProps}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: remotionDir, shell: true });
    return { ok: true, output: outPath, stdout, stderr };
  } catch (err) {
    return { ok: false, output: outPath, error: err.message, stderr: err.stderr };
  }
}
