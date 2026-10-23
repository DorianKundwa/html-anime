/** Static page parts for a scene: entities, arrows/crosses SVG, headlines, overlay.
 * buildFilm calls this with the scene-level pieces so the timeline and HTML template
 * stay in sync and the page assembly is easy to read.
 */
function buildLabels(overlay, ground, overlaySvg, envEnts, foreEnts, label, bgHex) {
  const emptyEnter = new Map();
  const emptyDict = { props: {} };
  const emptyBeats = [];
  const propFor = (e) => propMarkup(e, emptyEnter, label, new Map(), propLabel(e, emptyDict, emptyBeats));
  const entityMarkup = [
    ...envEnts.map((e) => propMarkup(e, emptyEnter, label, new Map())),
    ...foreEnts.map((e) => e.kind === "actor" ? actorMarkup(e, emptyEnter) : propFor(e)),
  ].join("\n");
  return { entityMarkup, arrowsSvg: overlaySvg, headlines: "", overlay };
}
export { buildLabels };
