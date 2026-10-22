---
name: doodle-direct
description: Directs a doodle film from a closed scene sheet. Use first, before any drawing.
---

# doodle-direct

The scene sheet is the script for the picture. You build what it says, in the order it says.

## Rules

- The sheet is closed. Do not add, merge, reorder or drop scenes.
- Do not invent a beat that is not on a card. The one exception is idle life, which `doodle-motion` defines.
- Every card's `bg=`, TEXT color, beat verb and `OUT:` value must already be in `docs/scene-sheet-spec.md`. If one is not, stop and report it. Do not improvise.
- At most 3 poses per character per scene. Up to 5 in a scene that uses SHAKE or CROSS.
- No sakuga. A shot is a shot.
- Hard cut by default. Use `color-dip` only when a card says `OUT: color-dip(...)`.
- `TEXT:` is optional. Only include `TEXT:` when introducing a title, major chapter, or key date. Omit it on standard narrative and action scenes.

## Build order

1. Run `node harness/compile.js projects/<slug>` and read `build/brief.md` and `build/timeline.json`. Every frame number you use comes from the timeline, not from your estimate.
2. Read `doodle-style`, `doodle-motion`, `doodle-camera`, then `doodle-render`.
3. For each scene in order: draw its beats from the card, one beat per verb, using the library in `assets/library.svg`.
4. Lint the batch you just built (see `doodle-render`). Fix before the next batch.
5. Run the gates in `AGENTS.md`.

## Reading a card

A card gives you the cue range, the background, the cast and the beats. Each beat has a time and a verb. Take the verb's motion from `doodle-motion`. Take the look from `doodle-style`. Take the framing from `doodle-camera`. Do not restate any of those here.
