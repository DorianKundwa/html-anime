---
name: doodle-style
description: The look of the doodle channel: flat palette fills, bold outlines, stick-figure rig, boil, and marker headlines. Use when drawing any shape or text.
---

# doodle-style

## Fills and outlines

- Flat fills, colors from `harness/palette.js` only.
- Bold black outline: about 6 px outer, 3 px interior at 1080p.
- Double stroke: every outer outline gets a slightly offset echo line (about 2 px, a few degrees off) in the same black. It reads as a marker sketch, not a vector.
- Tone shading: a flat shade of a palette color from `TONES` in `harness/palette.js` (for example `orange-dark`) may fill one shading band on the same object, such as the underside of a prop or the far side of a head. The library reads it from the `--tone` custom property, which the generator sets from the object's own color. Tones are never text colors, backgrounds or color-dip targets.
- Zero gradients, shadows, glows, textures and blurs. The boil filter is the only filter allowed.
- Backgrounds are flat fills of the matching token. `sky+ground` is `sky` with a `green` strip across the bottom 12%.
- Backgrounds are flat fills of the matching token. `sky+ground` is `sky` with a `green` strip across the bottom 12%.

## Characters

Stick figures: a large circle head, dot eyes, thick brow lines, line body. A head or body may be filled `red` (hot or embarrassed) or `white` (neutral).

- Hands: small white round hands at the end of each arm, outlined. Hands are part of the rig, not separate props.
- Feet: short flat strokes at the end of each leg, pointing outward.
- Mouths: a neutral line, a smile (upturned arc) for sly or pleased, and a frown (downturned arc) for angry or sweat. Pick one per beat; do not mix two on one face.
- Brows: flat for neutral, angled inward for angry, raised for shock.

Build one rig and reuse it:

- Head, body.
- Eyes: neutral, shock, sly, sweat, confused, angry, dead (X X eyes), rage (wide red glare), tired.
- Brows and mouths to match, including evil (grinning jagged grin) and panic/scream.
- Limb poses: idle, point, shrug, carry, row, walk, clipboard, crossed, panic.

Keep the rig in `assets/library.svg` as `<symbol>` elements. Do not redraw a figure per scene.

### Clothes and character detail

A bare stick figure is only for a character the cast card describes as a bare body
("black stick body"). Anyone else is dressed, because the clothes are what makes the
figure read as a person:

- Garments: `rig-torso` (a plain shirt or jacket), `rig-vest` (a safety vest with
  reflective bands), `rig-robe`, `rig-suit`, `rig-dress`, `rig-sweater`, `rig-labcoat`,
  `rig-armor` (knight/soldier plate cuirass with pauldrons and emblem), `rig-tunic` (historical belt tunic).
- Head: `rig-hat-hard`, `rig-hat-beanie`, `rig-hat-cap`, `rig-hat-crown` (regal jewelled crown with ermine fur band),
  `rig-hat-helmet` (iron bascinet helm with visor and red plume), `rig-hat-tricorn` (18th century naval/general tricorn hat with cockade),
  `rig-hair-short`, `rig-hair-long`, `rig-hair-curly`, `rig-hair-bun`, `rig-hair-ponytail`, `rig-hood`, `rig-glasses`.
- Extras: `rig-cape` (flowing royal or hero cape draped behind shoulders), `rig-scarf`, `rig-tie`.

The generator reads the cast card and picks the symbol and the palette colour from
the words in it ("yellow crown", "cobalt cape", "grey armor", "yellow knit beanie", "cobalt blazer body", "round black glasses"). So the cast card, not the scene file, decides the clothes:
write the colour next to the garment in `## CAST`.

Each garment has a shading band from `TONES`, drawn on one side of the body, and the
band is set through the `--tone` custom property like every other shade.

## Scale, the ground, and environment backdrops

- Everyone stands on one ground line, `GROUND` in `harness/build-film.js` (850 px).
  A figure's feet and a prop's base touch it. Nothing important goes below 864 px,
  where the subtitles start.
- The figure is drawn as big as the scene allows: one actor in the scene is drawn
  close up (1.45), two at 1.15, three at 1.02. A prop never shrinks a person.
- A size word in a LAYOUT clause ("DRYER large on the right", "NORA small on the
  left") scales that entry on top of the scene scale.
- A LAYOUT clause that names a third (left, right, center) puts the entry there.
  The rest fill the free space around what is placed, so nothing overlaps.
- Environment Sets: Scene cards can name wide environment backdrops in `PROPS` (`ENV-CASTLE`, `ENV-BATTLEFIELD`, `ENV-WAR-ROOM`, `ENV-SEA`, `ENV-OFFICE`, `ENV-CITY`, `ENV-ROOM`, `ENV-COURT`, `ENV-LAUNDROMAT`, `ENV-CORRIDOR`).
  These render as full-width $1920\times 640$ sets behind actors with their drawn floor line landing at exactly $y = 850$ (`GROUND`), providing rich contextual depth without displacing character placement.

## Props

Chunky, simplified, single-color fills with thick outlines, double stroke and one tone band for shading. A prop used in two or more scenes goes into `assets/library.svg`. A prop that is only a labelled rectangle is a placeholder and fails the gate in `AGENTS.md`.

Every prop in a project therefore needs a drawn symbol. Two ways to get one:

- A symbol of its own: `prop-<name in lower case>`, drawn in a 240 x 260 box with
  `currentColor` for the body, `--tone` for the shade, and a black outline with an
  echo line.
  Standard and historical props in `library.svg`: `prop-sword`, `prop-shield`, `prop-crown`, `prop-scroll`, `prop-tombstone`, `prop-skull`, `prop-fire`, `prop-flag`, `prop-throne`, `prop-army`, `prop-ship`, `prop-map-europe`, `prop-book`, `prop-dryer`, `prop-phone`, `prop-laptop`, `prop-clipboard`, etc.
- An alias: many props are the same object with another word for it (a book, a tag,
  a building, a cloud). `PROP_ALIASES` in `harness/build-film.js` sends those names to
  a symbol that draws them. Add the alias rather than a near-copy of the same shape.

A symbol can carry words: a slot marked `class="prop-text"` takes the words the scene
card gives the prop (a calendar reading 1961, a sign reading "40 MILES", a box
labeled EVERYTHING), and `class="prop-label"` takes a small word on a strip. The
generator fills the slot and leaves it empty when the card gives no words.

## Boil

Each outline set has three slightly different wobbles, A, B and C, cycled every 3 frames (8 fps).

- Preferred: one SVG `feTurbulence` plus `feDisplacementMap` filter with three fixed seeds, displacement scale 3 to 4 px. Swap variants with `tl.set` on the 3-frame grid.
- If lint rejects the filter, or the same frame renders differently on two runs, use hand-authored variant paths for characters and key props instead.
- Boil applies to outlines and characters. It does not apply to text or subtitles.

## Headlines

- ALL CAPS, in the marker font shipped locally as `.woff2` with a `NOTICE.txt` (see `films/roof/fonts/`).
- Top of the frame, inside the top 150 px.
- Yellow text always gets a heavy black outline with `paint-order: stroke`. Every
  headline gets that outline, whatever the colour: it is what makes the type read as
  marker on a flat background.
- The size follows the length: a short headline fills the width, a long one steps
  down, so the text never runs off the frame.
- Enter with STAMP (see `doodle-motion`).
- **Frequency & Selection**: Headlines are strictly for chapter titles, key years/dates, or major milestone beats (e.g. roughly 1 in every 4 to 8 scenes, or an opening title). Do NOT place headlines on every scene. Omit the `TEXT:` line for ordinary narrative action scenes so the animation remains clean and uncluttered.

## Labels and bubbles

- Arrow labels: a black or yellow diagonal arrow, with one short ALL-CAPS word beside the arrowhead.
- Thought bubbles: a classic cloud with ALL-CAPS text.
