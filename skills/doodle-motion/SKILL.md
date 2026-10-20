---
name: doodle-motion
description: The motion vocabulary for doodle scenes at 24 fps. Use when animating any beat, including idle life.
---

# doodle-motion

All timings are in frames at 24 fps. Convert a beat's time to a frame from `build/timeline.json`. Never use float seconds in the composition.

## Verbs

- **POP** (entrance). Opacity 0 to 1 in the first 2 frames. Scale 0.85 to 1.06 over 4 frames (`power2.out`). Settle to 1.0 over 2 frames.
- **DRAW**. Reveal a path with `stroke-dashoffset` on `pathLength="1"`, over 10 to 18 frames, `power1.out`.
- **SLIDE**. Translate from off-frame, or from a 200 to 400 px offset, over 8 to 12 frames, `power3.out`.
- **SHAKE**. Alternate ±8 px every 2 frames for 12 frames, then rest. Use stepped `tl.set`, not a tween.
- **STAMP**. Scale 1.6 to 1.0 over 3 frames, opacity 0 to 1 on frame 1. Headlines enter this way.
- **SWAP**. An instant change at a frame boundary, using `tl.set` on opacity.
- **CROSS**. Two red DRAW strokes of 6 frames each, offset by 3 frames.
- **PUSH**. Scale 100% to 106% across the whole scene, `power1.inOut`, origin on the subject.
- **WIPE**. A full-frame shape crosses in 8 frames. Used only for OUT.

## Rules

- Characters enter with POP, never a fade.
- Hold a pose once it settles. Do not ease a settled pose.
- Idle life: when a card leaves a gap of 3.0 s or more between beats, add a 2-frame blink or a small SHAKE in the gap. The boil keeps drawings moving, but it is not a beat.
- Swaps and shakes land on frame boundaries. Do not split a frame.
