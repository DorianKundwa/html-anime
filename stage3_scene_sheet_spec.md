# STAGE 3 (REPLACEMENT): GENERATE THE SCENE SHEET

Drop-in replacement for "STAGE 3 — GENERATE IMAGE PROMPTS FOR EVERY TIMESTAMP" in the master prompt.

- Stages 1, 2 and 4 stay as they are.
- Stage 5 (thumbnails) stays a text-to-image prompt, because a thumbnail is one still image.
- Save a copy of this file in the repo as `docs/scene-sheet-spec.md`. The ingest script and the build agent read it as the grammar for the sheet.

Edits needed elsewhere in the master prompt are listed at the bottom.

---

## STAGE 3 — GENERATE THE SCENE SHEET (VIDEO PROMPTS)

Once the user pastes their timestamped script, group the cues into scenes and write one scene card per scene. The scene sheet is the brief for a coding agent that draws each scene in HTML/SVG and syncs it to the user's narration audio. Do not write text-to-image prompts. Do not use a style anchor, a style lock, or "Do not render the timestamp text."

### INPUT

- A cue is one timestamped line. Number the cues 1..N in the order pasted. Accept `[m:ss]`, `[mm:ss]` and `[h:mm:ss]`.
- The transcript comes from auto-captioning and may misspell names or swap words. If the Stage 2 script is in the conversation, use its spelling in every TEXT and LABEL. Otherwise pick the most plausible spelling and keep it identical across all scenes.
- The last cue has no end time. The last scene ends at `END`, which the build step reads from the audio file. Never invent an end time.

### GROUPING

1. A scene is one continuous moment on one background.
2. Start a new scene only when the background changes, the place or time jumps, a new numbered stage or list item begins, or the main visual concept changes completely. Hold the scene across consecutive cues that describe the same moment.
3. Aim for 25–45 scenes in a 7-minute video, about one scene per 8–20 seconds. A scene never runs past 25 seconds (split at the nearest cue). A scene is never shorter than 3 seconds (merge it into a neighbour).
4. Scene start = the timestamp of its first cue. Scene end = the start of the next scene. Every cue belongs to exactly one scene.

### CARD FORMAT (exact)

```
## S07 | 0:33-0:45 | cues 10-12 | bg=tan
CAST: INVESTIGATOR
PROPS: HORNED-HELMET, NUMBERED-LIST, MAGNIFIER, EVIDENCE-FOLDER
LAYOUT: one sentence on where things sit in the 16:9 frame
BEATS:
- 0:33.0 SLIDE a cartoon hand lifts HORNED-HELMET off the VIKING's head
- 0:37.0 POP INVESTIGATOR holding MAGNIFIER over NUMBERED-LIST
TEXT: top | red | "EVIDENCE" @0:42.0
CAMERA: lock
OUT: hard-cut
```

Header: `## S<nn> | <start>-<end> | cues <first>-<last> | bg=<token>`. The last scene's end is the word `END`. A single-cue scene writes `cues 4-4`. Use a plain hyphen, not an en dash.

Fields:

- **CAST** — names from the CAST block. Omit the line if no character appears.
- **PROPS** — ALL-CAPS names, hyphenated. Reuse the exact same name every time the same prop returns.
- **LAYOUT** — one sentence. Faces and key art stay out of the bottom 20% of the frame, which belongs to subtitles. Eyes sit on a third, with room in front of the gaze.
- **BEATS** — see below.
- **TEXT** — the on-screen headline. Repeat the line for each change; each one replaces the previous at its time. Format: `top | <red|black|yellow> | "<ALL CAPS, 4 words max>" @<m:ss.s>`. Omit the line if the scene has no headline.
- **CAMERA** — `lock` or `push` (a slow 100% to 106% across the scene). Use `push` only on scenes of 6 seconds or more with a long hold.
- **OUT** — how the scene ends: `hard-cut` (default), `color-dip(<palette token>)`, `wipe-left`, `wipe-right`. Use `color-dip` only for a chapter-level shift, such as the move from the setup to the first numbered stage.

### BACKGROUNDS

`bg` takes one of these tokens, always a flat fill with zero gradients, shadows or textures:

`white` (default) · `tan` · `brown` · `orange` · `cobalt` · `sky` · `sky+ground` (sky with a green strip along the bottom) · `grey` · `night` · `red` · `yellow`

Match the mood:

- Mystery or secret files: `grey` or `tan`
- Danger or threat: `white` with red text, or `red`
- Conspiracy or uncovered truth: `orange` or `cobalt`
- Historical evidence: `tan` or `brown`
- Outdoors or an investigation: `sky+ground`
- Night or suspense: `night`
- Underwater: `cobalt`

### TEXT CONTRAST

The headline color must be readable on the background:

| bg | allowed headline colors |
|---|---|
| white, tan, sky, sky+ground | black or red |
| yellow | black |
| orange | black |
| red | yellow or black |
| cobalt, grey, night, brown | yellow |

Yellow headlines always carry a heavy black outline. Never put black text on `grey` or `night`.

### BEATS

A beat is one change on screen, written `- <m:ss.s> VERB what happens`.

Verbs (use only these):

- **POP** — an element appears with a quick overshoot
- **DRAW** — a line, arrow, circle, checkmark or underline draws on
- **SLIDE** — an element enters or exits by sliding
- **SHAKE** — a short jitter for shock, fear or impact
- **STAMP** — a heavy appearance, used for words and verdict marks
- **SWAP** — an instant change of expression, pose or prop
- **CROSS** — a red X draws over something
- **PUSH** — the slow camera push
- **HOLD** — nothing changes (never longer than 3.0 seconds)

Rules:

1. Every cue in the scene gets at least one beat at or very near its start time. Place mid-line beats where the key word falls in the line, estimated by character position between this cue's start and the next cue's start.
2. No gap between beats longer than 3.0 seconds. If the narration holds longer, add a SWAP, SHAKE or PUSH so something changes at least every 3 seconds.
3. Turn the abstract into something drawable: documents burned → a stick figure tosses papers into a fire; the world was watching → a globe with eyes.
4. Use these frame types when they fit:
   - Concept frame: one large prop centered with the headline at the top
   - Timeline: a left-to-right sequence with a right-pointing arrow
   - Labeled diagram: a prop with a yellow diagonal arrow and one ALL-CAPS label word
   - Reaction: a thought bubble with `?`, `HMMMM`, `!` or `WAIT...`
   - Villain personified: a government or corporation with an angry cartoon face
   - Globe and clues: a globe surrounded by floating documents or symbols
5. Name colors by token (white, red, yellow, black, orange, cobalt, green, brown, sky, tan, grey, night), never by hex.
6. Do not describe the art style inside a card. The build step owns it: flat fills, bold black outlines, stick figures, no gradients, shadows or textures.

### CAST & PROPS BLOCK

At the top of the first batch, before scene S01, write one block that fixes every recurring character and the main recurring props. Later scenes use these names exactly. One line each: name, then construction.

```
## CAST
INVESTIGATOR: stick figure, large white circle head, dot eyes, thick brow lines, black stick body

## PROPS
LONGSHIP: chunky brown hull, curled prow, one square sail, black outline
```

A character may be a fully colored head or body when the story calls for it (red = hot or embarrassed, white = neutral). If a new recurring character or prop appears in a later batch, add it as a short `## CAST (added)` or `## PROPS (added)` block at the top of that batch.

### BATCHING

- Deliver the scene cards in batches of up to 10 scenes, each batch inside ONE fenced code block, with exactly one blank line between cards. No commentary inside the block.
- Before each code block write one label line, for example `Batch 1 of 4 — scenes S01 to S10 (0:00 to 1:48)`.
- After a batch that is not the last, end with exactly this line, then stop and wait:

> **Reply "next" for the next 10 scenes.**

- Keep cards in chronological order across batches. Every cue must appear in exactly one scene.

After the FINAL batch, end with exactly this:

> **The scene sheet is complete: every cue is covered by exactly one scene.**
>
> **Do you want all the scene cards combined into one downloadable file?** Reply **"yes"** and I'll generate `scene_sheet_[topic].md` with every card in order.

If the user replies "yes", create that single Markdown file (the CAST and PROPS blocks first, then every card, one blank line between cards, identical to the code blocks) and present it for download. Do NOT create it before the user asks.

Then output:

> **Put these in your project folder:**
>
> - `projects/[topic]/audio/narration.mp3`: your voiceover export
> - `projects/[topic]/transcript.txt`: the timestamped transcript you pasted
> - `projects/[topic]/script.txt`: the clean narration file from Stage 2 (used to correct subtitle spelling)
> - `projects/[topic]/scene_sheet.md`: the file above
>
> Then open the repo in Claude Code or Codex and run the build prompt.

---

## EDITS TO THE REST OF THE MASTER PROMPT

1. **Stage 2 closing message:** add one line: "Keep the exported audio file. The build step needs it." The rest of that message stays.
2. **Operator rules, Stage 3 bullets:** replace the three Stage 3 bullets (batches of 20 prompts, no file until requested, "Do not render the timestamp text") with:
   - In Stage 3, scene cards are delivered in batches of up to 10 scenes, each batch in ONE fenced code block with one blank line between cards. Wait for "next" between batches.
   - In Stage 3, do NOT create any file until after the final batch and an explicit request. Only then generate `scene_sheet_[topic].md`.
   - In Stage 3, every card must follow the exact card format, and the first batch must open with the CAST and PROPS block.
3. **Keep unchanged:** "If the user pastes a timestamped script with fewer than 20 timestamps…" and "Always output … in chronological timestamp order."
4. **Stage 5 closing checklist:** replace "✅ Image prompts for every scene" with "✅ Scene sheet (video prompts)", and add "✅ Narration audio" if you want the list to match the new inputs.
5. **Stage 3 trigger line in the Stage 4 handoff message:** the "Important: remove the timestamp prefix" note no longer applies. Delete it.

---

## WORKED EXAMPLE

First four scenes of the Viking raid video (cues 1 to 12, 0:00 to 0:45).

```
## CAST
INVESTIGATOR: stick figure, large white circle head, dot eyes, thick brow lines, black stick body
VIKING: stick figure, large white circle head, dot eyes, thick brow lines, grey horned helmet, wide shouting mouth

## PROPS
LONGSHIP: chunky brown hull, curled prow, one square white sail, black outline

## S01 | 0:00-0:13 | cues 1-3 | bg=sky
CAST: VIKING
PROPS: LONGSHIP, WAVES, OLD-TV-FRAME, CEREAL-BOX
LAYOUT: LONGSHIP low and center with VIKING at the bow, flat cobalt wave shapes across the bottom third, facing right
BEATS:
- 0:00.0 SLIDE LONGSHIP in from the left, crashing through cobalt WAVES, VIKING on the bow shouting
- 0:03.0 SHAKE VIKING and LONGSHIP (the roar)
- 0:06.0 DRAW a thick black OLD-TV-FRAME around the whole picture
- 0:08.0 POP CEREAL-BOX at the lower right of the frame
- 0:11.0 CROSS a huge red X over the whole picture
TEXT: top | red | "MOVIE MYTH" @0:06.0
TEXT: top | red | "WRONG" @0:11.0
CAMERA: lock
OUT: color-dip(red)

## S02 | 0:13-0:25 | cues 4-6 | bg=white
CAST: INVESTIGATOR
PROPS: CHAOS-SCRIBBLE-SHIP, SHIP-ICON-GRID, COGS, CLIPBOARD, CALENDAR
LAYOUT: SHIP-ICON-GRID in the left two thirds, INVESTIGATOR in the right third with eyes on the upper third line
BEATS:
- 0:13.0 SLIDE CHAOS-SCRIBBLE-SHIP off to the right
- 0:13.5 POP SHIP-ICON-GRID, nine identical small ships in three neat rows
- 0:15.0 DRAW three black COGS across the grid
- 0:16.0 POP INVESTIGATOR holding CLIPBOARD
- 0:18.0 DRAW a checkmark on the CLIPBOARD
- 0:19.5 DRAW a second checkmark on the CLIPBOARD
- 0:21.0 POP CALENDAR beside INVESTIGATOR
- 0:22.5 SWAP the CALENDAR page (the years flip)
TEXT: top | black | "A MACHINE" @0:15.0
TEXT: top | red | "250 YEARS" @0:21.0
CAMERA: lock
OUT: hard-cut

## S03 | 0:25-0:33 | cues 7-9 | bg=white
CAST: INVESTIGATOR, VIKING
PROPS: THOUGHT-BUBBLE, FLOWCHART
LAYOUT: INVESTIGATOR large on the left third, VIKING small on the right, THOUGHT-BUBBLE above INVESTIGATOR
BEATS:
- 0:25.0 POP INVESTIGATOR, eyes wide, with THOUGHT-BUBBLE reading "WAIT..."
- 0:27.0 SLIDE VIKING in from the right, wildly waving his arms
- 0:29.0 CROSS a red X over VIKING
- 0:31.0 DRAW FLOWCHART (three boxes joined by arrows) where VIKING was
TEXT: top | black | "A SYSTEM" @0:31.0
CAMERA: lock
OUT: hard-cut

## S04 | 0:33-0:45 | cues 10-12 | bg=tan
CAST: INVESTIGATOR, VIKING
PROPS: HORNED-HELMET, NUMBERED-LIST, MAGNIFIER, EVIDENCE-FOLDER
LAYOUT: VIKING on the left, NUMBERED-LIST on the right, EVIDENCE-FOLDER centered for the last beat
BEATS:
- 0:33.0 SLIDE a cartoon hand lifts HORNED-HELMET off VIKING's head
- 0:34.5 DRAW a yellow ARROW from VIKING to NUMBERED-LIST (1 to 8)
- 0:37.0 POP INVESTIGATOR holding MAGNIFIER over NUMBERED-LIST
- 0:39.0 SWAP INVESTIGATOR's brows to raised
- 0:42.0 POP EVIDENCE-FOLDER, bursting open with papers flying out
TEXT: top | black | "EVIDENCE" @0:42.0
CAMERA: lock
OUT: hard-cut
```
