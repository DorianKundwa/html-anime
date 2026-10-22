import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { renderManim, renderRemotion, compositeMoviePy } from "./bridges/index.js";
import { PALETTE } from "./palette.js";

async function main() {
  console.log("=== Running Hybrid 2D Generation Demo (Remotion + Manim + MoviePy) ===");
  const tmpDir = join(process.cwd(), "build", "tmp", "demo");
  mkdirSync(tmpDir, { recursive: true });

  // 1. Remotion: Render a 2D Kinetic Intro Title
  console.log("\n[1/3] Rendering Remotion 2D Kinetic Title...");
  const remotionOut = join(tmpDir, "remotion_title.mp4");
  const remResult = await renderRemotion("KineticTitle", {
    outPath: remotionOut,
    props: {
      title: "REVENGE AT SEA",
      subtitle: "TACTICAL CAMPAIGN",
      bgColor: PALETTE.night,
      textColor: PALETTE.yellow,
    },
    concurrency: 4,
  });
  if (!remResult.ok) throw new Error(`Remotion failed: ${remResult.error}`);
  console.log("Remotion rendered:", remResult.output);

  // 2. Manim: Render a 2D Transparent Tactical Map
  console.log("\n[2/3] Rendering Manim Transparent Tactical Battle Map...");
  const manimResult = await renderManim("TacticalBattleMap", {
    outDir: tmpDir,
    outFile: "tactical_map.mov",
    transparent: true,
    quality: "l",
  });
  if (!manimResult.ok) throw new Error(`Manim failed: ${manimResult.error}`);
  console.log("Manim rendered:", manimResult.output);

  // 3. MoviePy: Composite everything into master video
  console.log("\n[3/3] Compositing with MoviePy (Video layers + Audio mixing)...");
  const baseVideo = join(process.cwd(), "projects", "history", "out", "history.mp4");
  const masterOut = join(process.cwd(), "out", "test_hybrid_output.mp4");
  mkdirSync(join(masterOut, ".."), { recursive: true });

  const compResult = await compositeMoviePy({
    base_video: baseVideo,
    overlays: [
      {
        file: manimResult.output,
        start: 4.0, // Appears as invasion starts
        duration: 4.0,
        transparent: true,
      },
    ],
    narration_audio: join(process.cwd(), "projects", "history", "audio", "narration.wav"),
    output: masterOut,
    fps: 24,
  });

  if (!compResult.ok) throw new Error(`MoviePy failed: ${compResult.error}`);
  console.log("\n=== SUCCESS! Master output created at:", masterOut);

  // Extract snapshot frames from the master output to preview visually
  const qaDir = join(tmpDir, "qa");
  mkdirSync(qaDir, { recursive: true });
  const frames = [2.0, 5.5, 7.0, 15.0];
  for (let i = 0; i < frames.length; i++) {
    const t = frames[i];
    const framePath = join(qaDir, `frame-${i + 1}.png`);
    execFileSync("ffmpeg", ["-y", "-ss", String(t), "-i", masterOut, "-vframes", "1", framePath], { stdio: "ignore" });
    console.log(`Extracted preview frame @${t}s -> ${framePath}`);
  }
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
