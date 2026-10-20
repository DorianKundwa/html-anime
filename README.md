<h1 align="center">html-anime</h1>

<p align="center">
  <b>Prompt an anime. Your coding agent draws it in code.</b>
</p>

<p align="center">
  <a href="https://github.com/blixvip/html-anime/stargazers"><img src="https://img.shields.io/github/stars/blixvip/html-anime?style=flat-square&color=e8434b" alt="GitHub stars"></a>
  <a href="https://blixvip.github.io/html-anime/"><img src="https://img.shields.io/badge/site-blixvip.github.io%2Fhtml--anime-111?style=flat-square" alt="Site"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-111?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/render-HyperFrames-111?style=flat-square" alt="HyperFrames">
  <img src="https://img.shields.io/badge/agents-Claude%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20Grok-111?style=flat-square" alt="Claude, Codex, Cursor, Grok">
  <a href="https://discord.gg/zEB4VjmfSb"><img src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://blixvip.github.io/html-anime/"><img src="media/city.jpg" width="860" alt="A moon over the night city, a still from Kokuyō"></a>
</p>

<p align="center">
  <sub>A still from <i>Kokuyō</i>, drawn entirely in HTML. <a href="https://blixvip.github.io/html-anime/">Watch it on the site</a> · <a href="media/film.mp4">media/film.mp4</a></sub>
</p>

An anime, written as HTML. You write a scene. [The site](https://blixvip.github.io/html-anime/) turns it into a shot sheet: holds, one expensive shot, a closed color script. Paste that sheet into Claude, Codex, Cursor, or Grok. The agent draws the frames.

The pictures are HTML, timed for [HyperFrames](https://github.com/heygen-com/hyperframes). Nothing here calls a video model.

## The film

Kokuyō. Watch it on [the site](https://blixvip.github.io/html-anime/) or open [media/film.mp4](media/film.mp4).

<table>
  <tr>
    <td width="50%"><img src="media/moon.jpg" alt="A cracked moon falling through rain"></td>
    <td width="50%"><img src="media/fight.jpg" alt="Two figures crossing blades in front of the moon"></td>
  </tr>
  <tr>
    <td width="50%"><img src="media/helm.jpg" alt="A dark helm with a red crescent"></td>
    <td width="50%"><img src="media/ren.jpg" alt="A close-up washed in white light"></td>
  </tr>
</table>

## Start

```
git clone https://github.com/blixvip/html-anime.git
cd html-anime
```

Open the folder in the agent you already use and paste a sheet as the first message. The site builds the sheet in the browser.

Serve the site from this folder, then open the address it prints:

```
python -m http.server
```

Opening `index.html` as a file shows that same instruction. The sheet will not run until the folder is served.

| Agent | What it reads | Open |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` | `claude` |
| Codex | `AGENTS.md` | `codex` |
| Cursor | `.cursor/rules/html-anime.mdc` | `cursor .` |
| Grok | `AGENTS.md` | `grok` |

## What is in the repo

- `index.html` — the site
- `skills/doodle-*/SKILL.md` — the doodle pipeline's skills (direct, style, motion, camera, render)
- `harness/` — ingest, compile, film gates and library inliner for the pipeline
- `legacy/` — the retired anime skills and harness
- `media/film.mp4` — Kokuyō, the film
- `media/city.jpg`, `media/moon.jpg`, `media/fight.jpg`, `media/helm.jpg`, `media/ren.jpg` — stills from it
- `films/roof/` — an 8 second reference. File shape and the color-dip cut, not a film to remix
- `AGENTS.md` — the contract

## Test

```
npm test
```

Checks the transcript and sheet parsers, every hard error, the frame math, caption correction, the film gates and the library inliner.

## Render the reference

```
cd films/roof
npx hyperframes preview
```

Lint before you trust a new film:

```
npx hyperframes lint
npx hyperframes validate
```

## Pipeline rules the agent is not allowed to break

- Scene frames sum to the audio's frame count at 24 fps
- No sakuga. At most three poses per character per scene
- Zero gradients, shadows or blurs
- Only the hexes in `harness/palette.js`
- The line you wrote, verbatim, or no dialogue at all

## Community

💬 [Join the Discord](https://discord.gg/zEB4VjmfSb) for questions, help, feedback, and updates.

## License

[MIT](LICENSE). The reference film's font keeps its own license: see [films/roof/fonts/NOTICE.txt](films/roof/fonts/NOTICE.txt).

## Doodle pipeline (narration to MP4)

The repo now also builds a doodle cartoon from three inputs: `projects/<slug>/audio/narration.mp3`, `transcript.txt`, `script.txt` and `scene_sheet.md`. The scene-sheet grammar is in [docs/scene-sheet-spec.md](docs/scene-sheet-spec.md). The contract is [AGENTS.md](AGENTS.md).

```
npm test
node -e "import('./harness/compile.js').then(m => m.compileProject('projects/<slug>'))"
```

The compile step writes `build/brief.md`, `build/timeline.json`, `build/captions-diff.md` and `captions.srt`. The old anime pipeline lives in `legacy/`.
