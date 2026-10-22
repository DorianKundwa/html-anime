import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * Executes the MoviePy compositor with multi-track audio & video layering.
 *
 * @param {object} config - Compositor configuration
 * @param {string} [config.base_video] - Path to base video
 * @param {Array<object>} [config.overlays] - Overlay videos with start times, positions, etc.
 * @param {string} [config.narration_audio] - Primary narration audio path
 * @param {string} [config.bgm_audio] - Background music audio path
 * @param {number} [config.bgm_volume=0.18] - Ducked volume for BGM
 * @param {Array<object>} [config.sfx] - Sound effect files with time and volume
 * @param {string} config.output - Master output path (e.g. "out/final.mp4")
 * @param {number} [config.fps=24] - Frame rate
 * @returns {Promise<{ ok: boolean, output: string, error?: string }>}
 */
export async function compositeMoviePy(config) {
  const compositorScript = resolve(join(process.cwd(), "harness", "moviepy", "compositor.py"));
  const tmpDir = resolve(join(process.cwd(), "build", "tmp"));
  mkdirSync(tmpDir, { recursive: true });

  const cfgFile = join(tmpDir, `compose-${Date.now()}.json`);
  writeFileSync(cfgFile, JSON.stringify(config, null, 2), "utf8");

  try {
    const { stdout, stderr } = await execFileAsync("python", [compositorScript, cfgFile]);
    return { ok: true, output: config.output, stdout, stderr };
  } catch (err) {
    return { ok: false, output: config.output, error: err.message, stderr: err.stderr };
  }
}
