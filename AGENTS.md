# doodle pipeline

You build one finished MP4 from a narration audio file, a timestamped transcript and a scene sheet. The look is a hand-drawn doodle cartoon: flat fills, bold black outlines, stick figures. You write code. You never call a video model.

## Inputs (`projects/<slug>/`)

- `audio/narration.mp3` (or `.wav`). Its duration is the video length.
- `transcript.txt`. One cue per line, `[m:ss] text`. Auto-captioned, so it has spelling errors.
- `script.txt`. Clean narration. Ground truth for spelling.
- `scene_sheet.md`. Scene cards in the grammar of `docs/scene-sheet-spec.md`. Read that file in full before you parse or draw anything.

## Outputs

- `projects/<slug>/film/`. HyperFrames composition at 1920×1080, 24 fps. Root `data-duration` equals the audio duration.
- `projects/<slug>/captions.srt`. Corrected subtitles. Always written.
- `projects/<slug>/out/<slug>.mp4`. Rendered with the HyperFrames CLI.

## Order of work

1. `npm test` must pass.
2. `node -e "import('./harness/compile.js').then(m => m.compileProject('projects/<slug>'))"` writes `build/timeline.json`, `build/brief.md`, `build/captions-diff.md`. Fix every hard error. Stop and ask the user if a decision is theirs.
3. Draw from `build/brief.md`. Follow the skills in `skills/doodle-*/` in this order: `doodle-direct`, `doodle-style`, `doodle-motion`, `doodle-camera`, `doodle-render`.
4. Pilot: root, audio, captions layer, scenes S01 to S03. Stop for the user's "continue".
5. Remaining scenes in batches of 5. Lint and commit after each batch.

## Gates

A project is done only when all pass:

1. `npm test`.
2. Ingest reports zero hard errors.
3. `checkFilm` (in `harness/check-film.js`) finds no color in `film/` outside `harness/palette.js`.
4. `checkFilm` finds none of `gradient`, `box-shadow`, `drop-shadow`, `text-shadow`, `blur(`, `Math.random`, `Date.now`, `setTimeout`, `async`. The boil's `feTurbulence` and `feDisplacementMap` are the only allowed filters.
5. `npx hyperframes lint` and `npx hyperframes validate` (or `check`) pass in `film/`.
6. Scene frames sum to the root frame count, which equals the audio duration × 24.
7. Placeholder check: the contact sheets in `build/qa/` show no placeholder art. A placeholder is a bare labelled rectangle standing in for a drawn prop or character.

## Hard rules

- Palette only, from `harness/palette.js`. No hex outside it.
- Tones: a flat shade of a palette color may be used only from `TONES` in `harness/palette.js` (for example `orange-dark`), and only as a shading step on the same object. Tones are not tokens. They cannot be text colors, backgrounds or color-dip targets.
- Zero gradients. Zero shadows, glows, textures, blurs.
- Hard cut unless a card says `OUT: color-dip(token)` or a wipe.
- No sakuga shot. At most 3 poses per character per scene, 5 in a scene that uses SHAKE or CROSS. A character changes pose at most once every 12 frames (half a second).
- Determinism: no `Math.random`, `Date.now`, `async`, `setTimeout`, `repeat: -1`, or `play()` on media.
- Frames are integers at 24 fps. Never carry float seconds into the composition.
- Fonts ship locally as `.woff2` with a `NOTICE.txt`. No network fonts.
- Do not touch `index.html`, `site.css`, `site.js`, `tokens.css`, `media/` or `films/roof/`.
  Exception (approved 2026-10-20): `site.js` and `index.html` may be edited to repair the site's imports and skill links. `ui/` is the local control panel (`npm run ui`).
- Old anime material is in `legacy/`. Do not read it as a rule source.
