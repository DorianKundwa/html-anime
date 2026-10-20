---
name: doodle-style
description: The look of the doodle channel: flat palette fills, bold outlines, stick-figure rig, boil, and marker headlines. Use when drawing any shape or text.
---

# doodle-style

## Fills and outlines

- Flat fills, colors from `harness/palette.js` only.
- Bold black outline: about 6 px outer, 3 px interior at 1080p.
- Zero gradients, shadows, glows, textures and blurs. The boil filter is the only filter allowed.
- Backgrounds are flat fills of the matching token. `sky+ground` is `sky` with a `green` strip across the bottom 12%.

## Characters

Stick figures: a large circle head, dot eyes, thick brow lines, line body. A head or body may be filled `red` (hot or embarrassed) or `white` (neutral).

Build one rig and reuse it:

- Head, body.
- Eyes: neutral, shock, sly, sweat, confused, angry.
- Brows and mouths to match.
- Limb poses: idle, point, shrug, carry, row.

Keep the rig in `assets/library.svg` as `<symbol>` elements. Do not redraw a figure per scene.

## Props

Chunky, simplified, single-color fills with thick outlines. A prop used in two or more scenes goes into `assets/library.svg`.

## Boil

Each outline set has three slightly different wobbles, A, B and C, cycled every 3 frames (8 fps).

- Preferred: one SVG `feTurbulence` plus `feDisplacementMap` filter with three fixed seeds, displacement scale 3 to 4 px. Swap variants with `tl.set` on the 3-frame grid.
- If lint rejects the filter, or the same frame renders differently on two runs, use hand-authored variant paths for characters and key props instead.
- Boil applies to outlines and characters. It does not apply to text or subtitles.

## Headlines

- ALL CAPS, in the marker font shipped locally as `.woff2` with a `NOTICE.txt` (see `films/roof/fonts/`).
- Top of the frame, inside the top 150 px.
- Yellow text always gets a heavy black outline with `paint-order: stroke`.
- Enter with STAMP (see `doodle-motion`).

## Labels and bubbles

- Arrow labels: a black or yellow diagonal arrow, with one short ALL-CAPS word beside the arrowhead.
- Thought bubbles: a classic cloud with ALL-CAPS text.
