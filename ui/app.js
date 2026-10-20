// Control panel for the doodle pipeline. Talks to ui/server.mjs. Text is set with textContent only.
const $ = (sel) => document.querySelector(sel);
const state = { slug: null, busy: false };

async function api(path, method = "GET") {
  const res = await fetch(path, { method });
  const body = await res.json();
  return { status: res.status, body };
}

async function loadPalette() {
  const { body } = await api("/api/palette");
  for (const [name, hex] of Object.entries(body.palette)) {
    document.documentElement.style.setProperty(`--${name}`, hex);
  }
}

function setBusy(on) {
  state.busy = on;
  for (const btn of document.querySelectorAll("button")) btn.disabled = on;
}

function chip(text, cls) {
  const span = document.createElement("span");
  span.className = `chip ${cls ?? ""}`.trim();
  span.textContent = text;
  return span;
}

async function refreshList() {
  const { body } = await api("/api/projects");
  const list = $("#project-list");
  list.replaceChildren();
  $("#empty").hidden = body.projects.length > 0;
  for (const p of body.projects) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = p.slug;
    if (p.slug === state.slug) btn.classList.add("current");
    const done = p.rendered ? "rendered" : p.film ? "film" : p.built ? "built" : "inputs";
    btn.append(chip(done));
    btn.addEventListener("click", () => selectProject(p.slug));
    li.append(btn);
    list.append(li);
  }
}

function statusRow(label, ok) {
  const tr = document.createElement("tr");
  const th = document.createElement("td");
  th.textContent = label;
  const td = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = ok ? "ok" : "no";
  badge.textContent = ok ? "yes" : "no";
  td.append(badge);
  tr.append(th, td);
  return tr;
}

function renderDetail(d) {
  $("#pick").hidden = true;
  $("#detail").hidden = false;
  $("#slug").textContent = d.slug;
  $("#status-rows").replaceChildren(
    statusRow("audio/narration", Boolean(d.inputs.audio)),
    statusRow("transcript.txt", d.inputs.transcript),
    statusRow("script.txt", d.inputs.script),
    statusRow("scene_sheet.md", d.inputs.sceneSheet),
    statusRow("build/timeline.json", d.built),
    statusRow("captions.srt", d.captions),
    statusRow("film/index.html", d.film),
    statusRow("out/" + d.slug + ".mp4", d.rendered),
  );
  $("#brief").textContent = d.brief ?? "Not built yet.";
  $("#diff").textContent = d.captionsDiff ?? "Not built yet.";
  const last = d.runs?.at(-1);
  if (last) showResult(last);
  else $("#result").hidden = true;
}

function showResult(run) {
  const box = $("#result");
  box.hidden = false;
  box.classList.toggle("pass", Boolean(run.ok));
  box.classList.toggle("fail", !run.ok);
  $("#result-title").textContent = `${run.action}: ${run.ok ? "passed" : "failed"}${run.code != null ? ` (exit ${run.code})` : ""}`;
  fillList($("#result-errors"), run.errors);
  fillList($("#result-warnings"), run.warnings);
  showPre($("#result-counts"), run.counts ? JSON.stringify(run.counts, null, 2) : "");
  const output = [run.stdout, run.stderr].filter(Boolean).join("\n");
  showPre($("#result-output"), output);
}

function fillList(ul, items) {
  ul.replaceChildren();
  for (const item of items ?? []) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.append(li);
  }
}

function showPre(pre, text) {
  pre.hidden = !text;
  pre.textContent = text;
}

async function selectProject(slug) {
  state.slug = slug;
  const { body } = await api(`/api/projects/${encodeURIComponent(slug)}`);
  renderDetail(body);
  await refreshList();
}

async function runAction(action) {
  if (!state.slug || state.busy) return;
  setBusy(true);
  const path = `/api/projects/${encodeURIComponent(state.slug)}/${action}`;
  try {
    const { body } = await api(path, "POST");
    showResult(body);
    await selectProject(state.slug);
  } finally {
    setBusy(false);
  }
}

async function runTests() {
  if (state.busy) return;
  setBusy(true);
  const out = $("#test-out");
  try {
    const { body } = await api("/api/test", "POST");
    out.hidden = false;
    out.textContent = `npm test: ${body.ok ? "passed" : "failed"} (exit ${body.code})\n${[body.stdout, body.stderr].filter(Boolean).join("\n")}`;
  } finally {
    setBusy(false);
  }
}

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => runAction(btn.dataset.action));
});
$("#test-btn").addEventListener("click", runTests);

await loadPalette();
await refreshList();
