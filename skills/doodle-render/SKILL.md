---
name: doodle-render
description: Builds the HyperFrames film from scene files: root with audio and captions, one sub-composition per scene, determinism rules, cuts, and gates. Use when writing or checking any film file.
---

# doodle-render

Follow `.agents/skills/hyperframes-core` for exact attribute and sub-composition syntax. Read `references/sub-compositions.md` before writing a scene file. It explains why styles and scripts must sit inside `<template>`.

## Root (`projects/<slug>/film/index.html`)

- `data-width="1920"`, `data-height="1080"`, `data-fps="24"`. `data-duration` equals the audio duration in seconds.
- One `<audio>` element with an `id`, `data-start="0"`, `data-duration` equal to the audio duration, and `data-has-audio="true"`.
- A captions layer on the highest z-index.
- One clip per scene: `data-composition-src`, `data-composition-id`, `data-start`, `data-duration`, `data-track-index`, `data-width`, `data-height`. Times are frame-exact, taken from `build/timeline.json`.

## Scene file

- `<template>` wraps everything: `<style>`, the root `div`, and the `<script>`.
- Style the root by `#root`, never by class.
- Build the scene's timeline paused. Register it: `window.__timelines["<composition-id>"] = tl;`.
- Target 2 to 6 KB. If a scene passes 8 KB, simplify it.

## Forbidden

- Calling `play()` on media.
- `repeat: -1`.
- `Math.random()`, `Date.now()`, `async`, `setTimeout`. Use seeded values or written-out numbers.
- Any gradient, `box-shadow`, `drop-shadow`, `text-shadow`, `blur(`. The boil's `feTurbulence` and `feDisplacementMap` are the only filters allowed.
- Any color not in `harness/palette.js`.

## Cuts

- Hard cut unless the card says otherwise.
- `OUT: color-dip(token)` straddles the cut by 6 frames on each side, as `films/roof/index.html` does.

## Gates

Run in `projects/<slug>/film/`:

```
npx hyperframes lint
npx hyperframes validate
```

If the CLI reports `check` instead of `validate`, run that. Report which one you ran.
