import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileProject } from "./harness/compile.js";
import { buildFilm } from "./harness/build-film.js";
const SECONDS = 600, SCENES = 60, PER_SCENE = 10;
const clock = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const pad = (n) => String(n).padStart(2,"0");
const dir = mkdtempSync(join(tmpdir(),"doodle-dbg-"));
mkdirSync(join(dir,"audio"));
writeFileSync(join(dir,"audio","narration.mp3"),"x");
const cues=[]; for(let k=0;k<SECONDS/5;k++) cues.push(`[${clock(k*5)}] Line ${k+1} of the narration.`);
writeFileSync(join(dir,"transcript.txt"), cues.join("\n")+"\n");
const cards=[];
for(let k=0;k<SCENES;k++){
  const start=k*PER_SCENE, end=k===SCENES-1?"END":clock((k+1)*PER_SCENE);
  const bg=k%2?"white":"sky", headline=k%2?"black":"red", camera=k%2?"push":"lock";
  const out=["color-dip(black)","wipe-left","hard-cut"][k%3];
  cards.push(
    `## S${pad(k+1)} | ${clock(start)}-${end} | cues ${2*k+1}-${2*k+2} | bg=${bg}`,
    "CAST: INVESTIGATOR, WITNESS",
    "PROPS: CEREAL-BOX",
    "LAYOUT: INVESTIGATOR in the left third, WITNESS in the right third",
    "BEATS:",
    `- ${clock(start)}.0 POP INVESTIGATOR enters on the left`,
    `- ${clock(start+2)}.0 SWAP INVESTIGATOR's brows to raised`,
    `- ${clock(start+4)}.0 POP WITNESS appears at the right`,
    `- ${clock(start+6)}.0 DRAW a black arrow from INVESTIGATOR to WITNESS`,
    `TEXT: top | ${headline} | "SCENE ${k+1}" @${clock(start)}.0`,
    `CAMERA: ${camera}`,
    `OUT: ${out}`,
    "");
}
writeFileSync(join(dir,"scene_sheet.md"), [
  "## CAST",
  "INVESTIGATOR: stick figure, large white circle head, dot eyes, thick brow lines, black stick body",
  "WITNESS: stick figure, large white circle head, dot eyes, thick brow lines, black stick body",
  "",
  "## PROPS",
  "CEREAL-BOX: chunky orange box, black outline",
  "PHONE: flat black phone, white screen",
  "FOLDING-TABLE: brown folding table, black outline",
  "", ...cards].join("\n"));
const res = await compileProject(dir,{audioSeconds:SECONDS});
console.log("compile ok", res.ok, res.errors);
const b = buildFilm(dir);
console.log("build ok", b.ok, b.errors);
const scene = readFileSync(join(dir,"film","compositions","s01.html"),"utf8");
console.log("has box:", scene.includes('x="5" y="5" width="230"'));
const i = scene.indexOf('x="5" y="5" width="230"');
console.log(scene.slice(Math.max(0,i-600), i+300));
