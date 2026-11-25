// Luthier app: the session flow (seed -> Q0 -> triage -> type intake -> checkpoint (a)
// -> contract -> lyric -> readings -> lock -> completion check), the manifest, and storage.

import { loadLexicon } from "./engine/lexicon.js";
import { analyzeLyric, measureCandidate, BANDS } from "./engine/lyric.js";
import { QUESTIONS, scoreTriage, TYPES, typeLabel, typeShort } from "./engine/triage.js";
import * as P from "./prompts.js";
import * as Mel from "./engine/melody.js";
import * as Audio from "./audio.js";
import * as Harm from "./engine/harmony.js";
import * as Floor from "./engine/floor.js";
import * as Docs from "./engine/docs.js";
import * as Pdf from "./pdf.js";
import * as Lily from "./engine/lily.js";
import * as Prod from "./engine/production.js";
import * as MusicXML from "./engine/musicxml.js";

// ---------- tiny DOM helper (all text via textContent) ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (sel) => document.querySelector(sel);

// ---------- capabilities ----------
const cap = { sample: null, db: null, user: null, downloads: null, uid: null };
async function initCaps() {
  if (!window.claude || !window.claude.use) return;
  const [sample, db, user, downloads] = await Promise.all(["sample", "db", "user", "downloads"].map((n) => window.claude.use(n).catch(() => null)));
  Object.assign(cap, { sample, db, user, downloads });
  if (user && db) {
    try { cap.uid = await user.id(); } catch { cap.uid = null; }
  }
  render();
  if (cap.db && cap.uid) loadSongs();
}

// ---------- storage ----------
const LS_KEY = "luthier.songs.v1";
function lsRead() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } }
function lsWrite(all) { try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* storage blocked */ } }

let songs = lsRead();
let saveTimer = null;
function save() {
  const s = cur();
  if (!s) return;
  s.updatedAt = Date.now();
  songs[s.id] = s;
  lsWrite(songs);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!cap.db || !cap.uid) return;
    try { await cap.db.collection("data/users/" + cap.uid).doc(s.id).set({ json: JSON.stringify(s), updatedAt: s.updatedAt }); ui.saved = "Saved to your account"; }
    catch (e) { ui.saved = "Saved on this device only"; }
    renderStatus();
  }, 800);
}
async function loadSongs() {
  try {
    const snap = await cap.db.collection("data/users/" + cap.uid).get();
    snap.docs.forEach((d) => {
      const data = d.data();
      try {
        const s = JSON.parse(data.json);
        if (!songs[s.id] || (songs[s.id].updatedAt || 0) < s.updatedAt) songs[s.id] = s;
      } catch { /* skip bad row */ }
    });
    lsWrite(songs);
    render();
  } catch { /* offline: local copy only */ }
}

// ---------- state ----------
const ui = { docBusy: null, view: "home", songId: null, busy: null, error: null, saved: "", coach: null, showManifest: false, abort: null, stream: "" };
const cur = () => (ui.songId ? songs[ui.songId] : null);

function newSong(mode) {
  const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  songs[id] = {
    id, mode, createdAt: Date.now(), updatedAt: Date.now(),
    step: mode === "lyric" ? "paste" : "seed",
    seed: "", q0: "", triage: {}, type: null, intakeDone: false, pendingQ: null,
    log: [], contract: { bpm: 80, beatsPerBar: 4, barsPerLine: 2, neverSay: "", writer: "" },
    tension: null, drafts: [], lyric: "", locked: false, constraints: [], completion: null, lastRule: "",
  };
  ui.songId = id; ui.view = "song";
  save(); render();
}

function logChoice(s, entry) {
  s.log.push({ ...entry, at: new Date().toISOString() });
}

const CHECKPOINTS = { seed: "Seed", paste: "Your lyric", q0: "Q0", triage: "Triage", confirm: "Type", intake: "Type intake", tension: "(a) Tension, hook, form", contract: "Contract", harmony: "(b) Harmony", lyric: "(c) Lyric skeleton", melody: "(d) Melody", production: "(e) Production", done: "Completion" };
const ORDER = ["seed", "q0", "triage", "confirm", "intake", "tension", "contract", "harmony", "lyric", "melody", "production", "done"];
const ORDER_LYRIC = ["paste", "q0", "confirm", "contract", "harmony", "lyric", "melody", "production", "done"];

// ---------- Claude helpers ----------
function claudeReady() { return Boolean(cap.sample); }
function errCopy(e) {
  const c = e && e.code;
  if (c === "not_granted") return "Claude wasn't allowed for this page, so the writing help is off. You can still answer, write and measure.";
  if (c === "rate_limited") return "Claude is busy right now. Wait a minute and try again.";
  if (c === "aborted") return "Stopped.";
  return "Claude couldn't answer that time. Try again, or keep going by hand.";
}
async function askJSON(prompt, label) {
  ui.busy = label; ui.error = null; render();
  try {
    const out = await cap.sample.json(prompt, { modelTier: "default" });
    return out;
  } catch (e) { ui.error = errCopy(e); throw e; }
  finally { ui.busy = null; render(); }
}
async function askText(prompt, label) {
  ui.busy = label; ui.error = null; ui.stream = ""; ui.abort = new AbortController(); render();
  try {
    const { text } = await cap.sample(prompt, {
      modelTier: "default", signal: ui.abort.signal, cache: false,
      onText: ({ text }) => { ui.stream = text; const el = $("#stream"); if (el) el.textContent = text; },
    });
    return text;
  } catch (e) { ui.error = errCopy(e); if (e && e.text) return e.text; throw e; }
  finally { ui.busy = null; ui.abort = null; ui.stream = ""; render(); }
}
function cleanLyric(t) {
  return t.replace(/^```[a-z]*\n?|```$/gm, "").replace(/[.,;:]+(\s*>?)\s*$/gm, "$1").trim();
}

// Fallback intake when Claude is unavailable: Module 10.1's lyric questions.
const FALLBACK_INTAKE = [
  { id: "Q2", question: "Describe the before in one physical image: something you could touch, smell, or see.", why: "Pole A, the wrong state" },
  { id: "Q3", question: "Now the after. One physical image for who they're becoming.", why: "Pole B, the becoming" },
  { id: "Q4", question: "What breaks it open? The single moment, event, or person.", why: "The bridge's rupture event" },
  { id: "Q7", question: "In the final chorus, everything inverts. Who sings it and what do they now know?", why: "The inversion" },
  { id: "Q8", question: "One word or phrase that has to live in the chorus.", why: "The convergence word" },
];

// ---------- the manifest (Execution Protocol 6a) ----------
function manifest(s, result) {
  const cp = CHECKPOINTS[s.step] || s.step;
  const typeTxt = s.type ? typeShort(s.type) : "type not set";
  const floors = result ? result.summary.floors : null;
  const bud = s.type ? Harm.budgetFor(s.type) : null;
  const du = s.melodyMap ? `DU ${s.melodyMap.songTotal}/${bud.total} · hook ${s.melodyMap.hookPeak}/${bud.ceiling}` : s.harmony ? `DU ${s.harmony.total}/${bud.total} (harmony) · ceiling ${bud.ceiling}` : bud ? `DU 0/${bud.total} · opens at (b)` : "DU: type not set";
  const head = `[${typeTxt} · ${du} · ${cp} · ${s.lastRule || "no rule checked yet"}]`;
  const items = [];
  if (s.q0) items.push(["Q0", s.q0]);
  if (s.tension && s.tension.statement) items.push(["Tension", s.tension.statement]);
  const c = s.contract;
  if (c.title) items.push(["Title", c.title]);
  if (c.voice || c.key) items.push(["Key and voice", [c.key, c.voice].filter(Boolean).join(", ")]);
  if (c.bpm) items.push(["Tempo", `${c.bpm} BPM ${c.feel || ""}`.trim()]);
  if (c.form) items.push(["Form", c.form]);
  if (s.harmony) items.push(["Harmony", Object.entries(s.harmony.skel).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ")]);
  items.push(["Never-say", c.neverSay ? c.neverSay : "not asked yet"]);
  (s.constraints || []).forEach((k) => items.push(["Kept on purpose", k]));
  if (floors !== null) items.push(["Open", floors ? `${floors} floor reading${floors > 1 ? "s" : ""} to decide` : "no floor readings open"]);
  return { head, items };
}

// ---------- render ----------
function render() {
  const root = $("#app");
  root.replaceChildren(ui.view === "home" ? viewHome() : viewSong());
  renderStatus();
}
function renderStatus() {
  const el = $("#status");
  if (!el) return;
  const parts = [];
  parts.push(claudeReady() ? "Claude: on" : "Claude: off (measure-only)");
  parts.push(cap.db && cap.uid ? "Songs saved to your account" : "Songs saved on this device");
  el.textContent = parts.join(" · ");
}

function viewHome() {
  const list = Object.values(songs).sort((a, b) => b.updatedAt - a.updatedAt);
  const seeds = ["I'm grateful and I'm angry", "My father taught me how to work but not how to rest", "The night my daughter asked if God was real", "Something worth keeping", "I kept the house but lost the home"];
  return h("main", { class: "wrap" },
    h("section", { class: "intro" },
      h("p", { class: "eyebrow", text: "Luthier v45 · songwriting engine" }),
      h("h1", { text: "Start with one line." }),
      h("p", { class: "lede", text: "Give the engine a seed: an emotion, an image, a title, or two things true at once that shouldn't be. It asks the questions, drafts with you, and measures every line against what real songs do. You write the song." }),
      h("div", { class: "actions" },
        h("button", { class: "btn primary", onclick: () => newSong("seed") }, "New song from a seed"),
        h("button", { class: "btn", onclick: () => newSong("lyric") }, "Measure a lyric I wrote"),
      ),
      h("div", { class: "seeds" },
        h("span", { class: "label", text: "Example seeds" }),
        h("div", { class: "chips" }, seeds.map((t) => h("button", { class: "chip", onclick: () => { newSong("seed"); const s = cur(); s.seed = t; save(); render(); } }, t))),
      ),
    ),
    h("section", { class: "songs" },
      h("h2", { text: "Your songs" }),
      list.length ? h("ul", { class: "songlist" }, list.map((s) => h("li", {},
        h("button", { class: "songrow", onclick: () => { ui.songId = s.id; ui.view = "song"; render(); window.scrollTo(0, 0); } },
          h("span", { class: "songtitle", text: s.contract.title || s.seed || "Untitled lyric" }),
          h("span", { class: "songmeta", text: [s.type ? typeLabel(s.type) : null, CHECKPOINTS[s.step], new Date(s.updatedAt).toLocaleDateString()].filter(Boolean).join(" · ") }),
        )))) : h("p", { class: "empty", text: "No songs yet. Your songs appear here as you work, so you can pick one up later." }),
    ),
    h("section", { class: "about" },
      h("h2", { text: "What the engine measures" }),
      h("ul", { class: "facts" },
        h("li", {}, h("b", { text: "Mouth test. " }), "Syllables a second at your tempo against 44,041 real sung lines (ceiling 6.4), consonant friction, tongue-twisters at word joins."),
        h("li", {}, h("b", { text: "Line endings. " }), "Real lyric lines end on a weak word only 5% of the time. The last word carries the payload."),
        h("li", {}, h("b", { text: "Pictures. " }), "Every verse line, or the line beside it, holds something you can touch, smell, see or hear."),
        h("li", {}, h("b", { text: "The chorus. " }), "Shorter lines, mirrored pairs, its own words repeated, the title in the hook position, a held last word on an open vowel."),
      ),
      h("p", { class: "fine", text: "Scores are information, not verdicts (Principle 10). The engine measures; the artist interprets." }),
    ),
  );
}

function stepper(s) {
  const order = s.mode === "lyric" ? ORDER_LYRIC : ORDER;
  const i = order.indexOf(s.step);
  return h("ol", { class: "stepper", "aria-label": "Progress" }, order.map((k, j) =>
    h("li", { class: j < i ? "done" : j === i ? "now" : "" , title: CHECKPOINTS[k] }, h("span", { text: CHECKPOINTS[k] }))));
}

function viewSong() {
  const s = cur();
  if (!s) { ui.view = "home"; return viewHome(); }
  const result = s.lyric ? analyzeLyric(s.lyric, lyricOptions(s)) : null;
  const m = manifest(s, result);
  const body = {
    seed: stepSeed, paste: stepPaste, q0: stepQ0, triage: stepTriage, confirm: stepConfirm,
    intake: stepIntake, tension: stepTension, contract: stepContract, harmony: stepHarmony, lyric: stepLyric, melody: stepMelody, production: stepProduction, done: stepDone,
  }[s.step];
  return h("main", { class: "wrap" },
    h("div", { class: "topbar" },
      h("button", { class: "link", onclick: () => { ui.view = "home"; render(); } }, "‹ All songs"),
      h("span", { class: "songname", text: s.contract.title || s.seed || "New song" }),
    ),
    stepper(s),
    h("section", { class: "manifest" + (ui.showManifest ? " open" : "") },
      h("button", { class: "manifest-head", "aria-expanded": String(ui.showManifest), onclick: () => { ui.showManifest = !ui.showManifest; render(); } },
        h("code", { text: m.head }), h("span", { class: "toggle", text: ui.showManifest ? "Hide" : "Manifest" })),
      ui.showManifest ? h("dl", {}, m.items.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])) : null,
    ),
    ui.error ? h("p", { class: "alert", role: "status", text: ui.error }) : null,
    !ui.busy && lastChoice(s),
    ui.busy ? busyCard() : body(s, result),
  );
}

// "You chose": the last answer, shown on the next screen so a tap is never in doubt.
function lastChoice(s) {
  if (!["triage", "confirm", "intake", "tension", "contract", "harmony", "lyric", "production"].includes(s.step)) return null;
  const e = [...(s.log || [])].reverse().find((x) => x.answer && !["Search", "Document", "Ask"].includes(x.id));
  if (!e) return null;
  const ans = String(e.answer).length > 160 ? String(e.answer).slice(0, 157) + "…" : String(e.answer);
  return h("p", { class: "lastchoice" }, h("span", { class: "label", text: "You chose" }), h("span", { text: ans }));
}

function busyCard() {
  return h("section", { class: "card busy" },
    h("p", { class: "eyebrow", text: ui.busy }),
    h("p", { class: "thinking", text: "Thinking… this can take up to a minute." }),
    h("pre", { id: "stream", class: "stream", text: ui.stream }),
    ui.abort ? h("button", { class: "btn", onclick: () => ui.abort && ui.abort.abort() }, "Stop") : null,
  );
}

function card(eyebrow, title, help, ...kids) {
  return h("section", { class: "card" },
    eyebrow ? h("p", { class: "eyebrow", text: eyebrow }) : null,
    h("h2", { class: "q", text: title }),
    help ? h("p", { class: "help", text: help }) : null,
    ...kids);
}

function textAnswer(id, placeholder, value, onSubmit, label = "Continue", rows = 3) {
  const ta = h("textarea", { id, rows: String(rows), placeholder });
  ta.value = value || "";
  return h("form", { class: "answer", onsubmit: (e) => { e.preventDefault(); const v = ta.value.trim(); if (v) onSubmit(v); else ta.focus(); } },
    ta, h("button", { class: "btn primary", type: "submit" }, label));
}

// Show the tap: the chosen option lights up with a check, the others dim, then the step moves on.
function pickFlash(btn, then) {
  const list = btn.closest(".options");
  if (list) list.querySelectorAll(".option").forEach((o) => { o.classList.add(o === btn ? "chosen" : "dim"); o.disabled = true; });
  const mark = document.createElement("span"); mark.className = "chosenmark"; mark.textContent = "✓ Selected"; btn.append(mark);
  setTimeout(then, 450);
}
function optionList(options, recommended, onPick) {
  return h("div", { class: "options" }, options.map((o, i) =>
    h("button", { class: "option" + (i === recommended ? " rec" : ""), onclick: (e) => pickFlash(e.currentTarget, () => onPick(i)) },
      h("span", { class: "letter", text: String.fromCharCode(65 + i) }),
      h("span", { class: "otext", text: o }),
      i === recommended ? h("span", { class: "recmark", text: "Recommended" }) : null)));
}

// --- steps ---
function stepSeed(s) {
  return card("Step 1 · The seed", "Give the engine one line.", "An emotion, an image, a situation, a title, or a lyric tension: two things true at the same time that shouldn't be.",
    textAnswer("seed", "I kept the house but lost the home", s.seed, (v) => {
      s.seed = v; logChoice(s, { id: "Seed", question: "Give your seed", answer: v }); s.step = "q0"; save(); render();
    }, "Continue", 2));
}

function stepPaste(s) {
  return card("Lyric-first path · Module 29", "Paste your lyric.", "Mark sections with headers like [Verse 1], [Chorus], [Bridge]. Without headers, lines that repeat are read as the chorus. End a build line with > to say it is meant to pull forward.",
    textAnswer("paste", "[Verse 1]\n…\n\n[Chorus]\n…", s.lyric, async (v) => {
      s.lyric = v; s.drafts.push({ text: v, at: Date.now(), by: "writer" });
      logChoice(s, { id: "Lyric", question: "The writer's lyric", answer: "(pasted lyric)" });
      s.step = "q0"; save(); render();
    }, "Continue", 12));
}

function stepQ0(s) {
  return card("Q0 · The Sovereignty Question", "What do you think this song is about?", "No constraints. One sentence or ten. Whatever comes first. Your exact words are kept as the anchor for the whole session.",
    textAnswer("q0", "It's about…", s.q0, async (v) => {
      s.q0 = v; logChoice(s, { id: "Q0", question: "What do you think this song is about?", answer: v });
      if (s.mode === "lyric") { s.step = "confirm"; save(); render(); await suggestFromLyric(s); }
      else { s.step = "triage"; save(); render(); }
    }));
}

async function suggestFromLyric(s) {
  if (!claudeReady()) return;
  try {
    const r = await askJSON(P.suggestTypePrompt(s.lyric), "Reading your lyric");
    s.suggestion = r;
    if (r.title && !s.contract.title) s.contract.title = r.title;
    save(); render();
  } catch { /* the writer can pick by hand */ }
}

function stepTriage(s) {
  const q = QUESTIONS.find((x) => s.triage[x.id] === undefined);
  const t = scoreTriage(s.triage);
  if (!q || (t.clear && Object.keys(s.triage).length >= 4)) {
    // routing settled
    s.step = "confirm"; save();
    return stepConfirm(s);
  }
  const n = QUESTIONS.indexOf(q) + 1;
  return card(`Triage · ${q.id} of Q9 · ${q.label}`, q.question, q.help,
    optionList(q.options.map((o) => o.text), null, (i) => {
      s.triage[q.id] = i;
      logChoice(s, { id: q.id, question: q.question, options: q.options.map((o) => o.text), answer: q.options[i].text });
      save(); render();
    }),
    n > 1 ? h("button", { class: "link", onclick: () => { const prev = QUESTIONS[n - 2]; delete s.triage[prev.id]; s.log = s.log.filter((e) => e.id !== prev.id); save(); render(); } }, "‹ Back a question") : null,
  );
}

function stepConfirm(s) {
  let picks = [];
  let rec = 0;
  let help = "";
  if (s.mode === "lyric") {
    const sug = s.suggestion;
    if (sug && TYPES[(sug.type || "").split("/")[0]]) {
      picks = [sug.type, ...(sug.alternatives || []).filter((x) => TYPES[(x || "").split("/")[0]])].slice(0, 3);
      help = sug.evidence || "";
    }
  } else {
    const t = scoreTriage(s.triage);
    const top = t.ranked.slice(0, 3).map((r) => r.type);
    picks = t.hybrid ? [t.hybrid, ...top].slice(0, 3) : top;
    help = t.hybrid ? `Two types pull with about equal force. The primary type comes first and decides which intake runs.` : `Based on what you've told me. Q0 is the tiebreaker: does this type serve what you said the song is about?`;
  }
  while (picks.length < 3) { const extra = ["P", "N", "V", "LR", "A", "W"].find((x) => !picks.includes(x)); picks.push(extra); }
  const others = Object.keys(TYPES).filter((k) => !picks.includes(k));
  const sel = h("select", { id: "othertype", "aria-label": "Another type" },
    h("option", { value: "", text: "Another type…" }), others.map((k) => h("option", { value: k, text: `${TYPES[k].name}: ${TYPES[k].job}` })));
  const choose = (code, how) => {
    s.type = code; s.lastRule = "Module 0 routing";
    logChoice(s, { id: "Type", question: "Based on what you've told me, which type is this song?", options: picks.map(typeLabel), recommended: typeLabel(picks[rec]), answer: `${typeLabel(code)}${how ? " (" + how + ")" : ""}` });
    s.step = s.mode === "lyric" ? "contract" : "intake"; save(); render();
    if (s.step === "intake") nextIntake(s);
  };
  return card("Routing", `This sounds like a ${typeLabel(picks[0])}. Does that feel right?`, help,
    optionList(picks.map((p) => `${typeLabel(p)}: ${p.includes("/") ? "a hybrid" : TYPES[p].job}`), rec, (i) => choose(picks[i])),
    h("div", { class: "row" }, sel, h("button", { class: "btn", onclick: () => { if (sel.value) choose(sel.value, "writer's choice"); } }, "Use this type")),
  );
}

async function nextIntake(s) {
  if (!claudeReady()) {
    const asked = new Set(s.log.map((e) => e.id));
    const q = FALLBACK_INTAKE.find((x) => !asked.has(x.id));
    s.pendingQ = q ? { ...q, options: [], recommended: null } : null;
    if (!q) { s.intakeDone = true; s.step = "tension"; }
    save(); render(); return;
  }
  try {
    const r = await askJSON(P.intakePrompt(s), `${typeLabel(s.type)} intake`);
    if (!r || r.done) { s.intakeDone = true; s.pendingQ = null; s.step = "tension"; save(); render(); return checkpointA(s); }
    s.pendingQ = { id: r.id || "", question: r.question, why: r.why || "", options: (r.options || []).slice(0, 3), recommended: Number.isInteger(r.recommended) ? r.recommended : null };
    save(); render();
  } catch { /* error shown; retry button on the card */ }
}

function stepIntake(s) {
  const q = s.pendingQ;
  if (!q) {
    return card("Type intake", "Ready for the next question.", "",
      h("button", { class: "btn primary", onclick: () => nextIntake(s) }, "Ask the next question"),
      h("button", { class: "link", onclick: () => { s.intakeDone = true; s.step = "tension"; save(); render(); checkpointA(s); } }, "Skip to the hook ›"));
  }
  const answer = (text, i) => {
    logChoice(s, { id: q.id, question: q.question, options: q.options, recommended: q.recommended !== null ? q.options[q.recommended] : null, answer: text });
    s.pendingQ = null; save(); nextIntake(s);
  };
  return card(`${typeLabel(s.type)} intake${q.id ? " · " + q.id : ""}`, q.question, q.why,
    q.options.length ? optionList(q.options, q.recommended, (i) => answer(q.options[i], i)) : null,
    h("p", { class: "label", text: q.options.length ? "Or in your own words" : "Your answer" }),
    textAnswer("intake-" + (q.id || "x"), "Type your answer", "", (v) => answer(v), "Answer"),
  );
}

async function checkpointA(s) {
  if (!claudeReady()) return;
  try {
    const r = await askJSON(P.checkpointAPrompt(s), "Checkpoint (a): tension, hook, form");
    s.tension = { statement: r.tension, hooks: r.hooks || [], recommended: r.recommended ?? 0, form: r.form, formWhy: r.formWhy };
    s.defaults = { voiceChar: r.voice, voice: Mel.VOICES[r.voiceRow] ? r.voiceRow : Mel.voiceRow(`${r.voice || ""} ${r.key || ""}`, (s.type || "").split("/")[0]), bpm: r.bpm, feel: r.feel, key: r.key, objects: (r.objects || []).join(", "), neverSay: r.neverSay || "" };
    s.lastRule = "Principle 3, hook 4-9 syllables";
    save(); render();
  } catch { /* retry on the card */ }
}

function stepTension(s) {
  const t = s.tension;
  if (!t) {
    return card("Checkpoint (a)", "Name the tension and choose the hook.", claudeReady() ? "The engine proposes a tension, three hooks and a form from your answers." : "Write the tension (two true things that refuse to resolve) and the title.",
      claudeReady() ? h("button", { class: "btn primary", onclick: () => checkpointA(s) }, "Propose the tension and hooks") : null,
      !claudeReady() ? manualTension(s) : null);
  }
  const hookTexts = t.hooks.map((x) => `${x.title}  (${measureCandidate(x.title, "chorus").syllables} syllables) · ${x.why}`);
  return card("Checkpoint (a) · Tension, hook, form", "Which hook should carry the song?", `Tension: ${t.statement}`,
    optionList(hookTexts, t.recommended, (i) => pickHook(s, t.hooks[i].title, true)),
    h("p", { class: "label", text: "Or your own title" }),
    textAnswer("ownhook", "Your title", "", (v) => pickHook(s, v, false), "Use my title", 1),
    h("p", { class: "fine", text: `Proposed form: ${t.form || "—"}. ${t.formWhy || ""}` }),
  );
}

function manualTension(s) {
  const a = h("textarea", { id: "mt-tension", rows: "2", placeholder: "The two true things" });
  const b = h("input", { id: "mt-title", placeholder: "Title (4 to 9 syllables)" });
  return h("form", { class: "answer", onsubmit: (e) => { e.preventDefault(); if (!b.value.trim()) return b.focus(); s.tension = { statement: a.value.trim(), hooks: [], form: "" }; pickHook(s, b.value.trim(), false); } },
    a, b, h("button", { class: "btn primary", type: "submit" }, "Continue"));
}

function pickHook(s, title, fromList) {
  const t = s.tension || {};
  s.contract.title = title;
  if (t.form && !s.contract.form) s.contract.form = t.form;
  const d = s.defaults || {};
  for (const k of ["voice", "voiceChar", "bpm", "feel", "key", "objects", "neverSay"]) if (d[k] && !s.contract[k]) s.contract[k] = d[k];
  logChoice(s, { id: "Hook", question: "Which hook should carry the song?", options: (t.hooks || []).map((x) => x.title), recommended: t.hooks && t.hooks[t.recommended] ? t.hooks[t.recommended].title : null, answer: title + (fromList ? "" : " (writer's own)") });
  s.step = "contract"; save(); render();
}

function stepContract(s) {
  const c = s.contract;
  const f = (id, label, value, attrs = {}, hint) => {
    const input = h(attrs.rows ? "textarea" : "input", { id: "c-" + id, name: id, ...attrs });
    input.value = value ?? "";
    return h("label", { class: "field", for: "c-" + id }, h("span", { text: label }), input, hint ? h("small", { text: hint }) : null);
  };
  const form = h("form", { class: "contract", onsubmit: (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const get = (k) => String(fd.get(k) || "").trim();
    const next = { ...c, title: get("title"), neverSay: get("neverSay"), objects: get("objects"), writerPhrases: get("writerPhrases"), voice: get("voice"), voiceChar: get("voiceChar"), feel: get("feel"), key: get("key"), form: get("form"), writer: get("writer"),
      bpm: Number(get("bpm")) || 80, beatsPerBar: Number(get("beatsPerBar")) || 4, barsPerLine: Number(get("barsPerLine")) || 2 };
    const missing = [];
    if (!next.title) missing.push("title");
    if (!next.neverSay) missing.push("never-say list (write 'none' to waive it)");
    if (missing.length) { ui.error = `Still needed: ${missing.join(", ")}.`; render(); return; }
    ui.error = null;
    s.contract = next;
    logChoice(s, { id: "Contract", question: "Required inputs (Protocol 0b)", answer: `title: ${next.title}; never-say: ${next.neverSay}; voice: ${next.voice}; tempo: ${next.bpm} ${next.feel}; key: ${next.key}; form: ${next.form}` });
    s.step = "harmony"; save(); render(); window.scrollTo(0, 0);
  } },
    f("title", "Title", c.title, { required: true }),
    f("neverSay", "Never-say list", c.neverSay, {}, "Words or phrases this song must never use, separated by commas (drafted from your answer to what the song must not say). Write 'none' to waive it."),
    f("objects", "Objects of the story", c.objects, {}, "The things in the song. They count as pictures and are never flagged as rare."),
    f("writerPhrases", "Your phrases", c.writerPhrases, {}, "Wording you want kept exactly. Lines carrying it are exempt from the word rules."),
    h("div", { class: "grid2" },
      voiceSelect(c),
      f("voiceChar", "Voice character", c.voiceChar || (Mel.VOICES[c.voice] ? "" : c.voice), { placeholder: "e.g. clear, weathered" }),
      f("key", "Key", c.key, { placeholder: "e.g. G major" }),
      f("bpm", "Tempo (BPM)", c.bpm, { type: "number", min: "40", max: "220", inputmode: "numeric" }),
      f("feel", "Feel", c.feel, { placeholder: "slow burn, driving…" }),
      f("beatsPerBar", "Beats a bar", c.beatsPerBar, { type: "number", min: "2", max: "12", inputmode: "numeric" }),
      f("barsPerLine", "Bars a line", c.barsPerLine, { type: "number", min: "1", max: "8", step: "0.5", inputmode: "decimal" }, "Used for the singing-speed reading"),
    ),
    f("form", "Form", c.form, { placeholder: "V-PC-C-V-PC-C-B-C" }),
    f("writer", "Your name for the credit line", c.writer, { placeholder: "Words and music: …" }),
    h("button", { class: "btn primary", type: "submit" }, s.lyric ? "Save and measure" : claudeReady() ? "Save and draft the lyric" : "Save and write the lyric"),
  );
  return card("The contract · Protocol 0b", "Check the required inputs.", "The writing room doesn't open while one is empty. Your never-say list is a hard rule: any line using it is flagged.", form);
}

const NOTE = (m) => `${["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][m % 12]}${Math.floor(m / 12) - 1}`;
const VOICE_LABEL = { male: "Male (pop)", female: "Female (pop)", "male worship": "Male worship leader", "female worship": "Female worship leader", "male gospel": "Male gospel lead", "female gospel": "Female gospel lead", anthemic: "Rock anthem (male)", congregational: "Congregation", bass: "Bass / baritone" };
function voiceSelect(c) {
  const cur = Mel.VOICES[c.voice] ? c.voice : Mel.voiceRow(`${c.voice || ""} ${c.voiceChar || ""} ${c.key || ""}`);
  const sel = h("select", { id: "c-voice", name: "voice" }, Object.entries(Mel.VOICES).map(([k, v]) => { const o = h("option", { value: k, text: `${VOICE_LABEL[k] || k}: ${NOTE(v.floor)}–${NOTE(v.ceil)}` }); if (k === cur) o.selected = true; return o; }));
  return h("label", { class: "field", for: "c-voice" }, h("span", { text: "Voice (range)" }), sel, h("small", { text: "The melody is written for this range (Module 11.2)." }));
}

function lyricOptions(s) {
  const c = s.contract;
  const split = (x) => (x && x.toLowerCase() !== "none" ? x.split(",").map((y) => y.trim()).filter(Boolean) : []);
  return { title: c.title || "", bpm: c.bpm || 80, beatsPerBar: c.beatsPerBar || 4, barsPerLine: c.barsPerLine || 2, neverSay: split(c.neverSay), objects: split(c.objects), writerPhrases: split(c.writerPhrases), hymn: s.type === "W" };
}

async function draft(s) {
  try {
    const text = await askText(P.draftPrompt(s), "Checkpoint (c): drafting the lyric");
    if (text) { s.lyric = cleanLyric(text); s.drafts.push({ text: s.lyric, at: Date.now(), by: "engine draft" }); s.lastRule = "Module 10 lyric rules"; save(); render(); }
  } catch { /* shown */ }
}

function readingsText(result) {
  return result.findings.map((f) => `- [${f.level}] ${f.rule}${f.where && f.where.section ? ` (${f.where.section}${f.where.line ? " line " + f.where.line : ""})` : ""}: ${f.message}`).join("\n") || "No readings.";
}

async function coach(s, f, result) {
  const sec = result.sections.find((x) => x.name === f.where.section && !x.ref);
  const line = sec && sec.lines[f.where.line - 1];
  if (!line) return;
  const idx = f.where.line - 1;
  const neighbors = sec.lines.slice(Math.max(0, idx - 2), idx + 3).map((l) => (l === line ? "> " : "  ") + l.text).join("\n");
  const problems = result.findings.filter((x) => x.where && x.where.section === f.where.section && x.where.line === f.where.line).map((x) => x.message).join(" ");
  try {
    const r = await askJSON(P.coachPrompt(s, line.text, `${sec.name} (${sec.kind})`, problems, neighbors), `Coaching one line`);
    const alts = (r.alternatives || []).slice(0, 3).map((t) => ({ text: t.replace(/[.,;:]+$/, ""), m: measureCandidate(t, sec.kind, lyricOptions(s)) }));
    ui.coach = { section: sec.name, line: f.where.line, original: line.text, kind: sec.kind, alts };
    render();
  } catch { /* shown */ }
}

function replaceLine(s, original, replacement) {
  const lines = s.lyric.split("\n");
  let n = 0;
  const out = lines.map((l) => (l.replace(/\s*>\s*$/, "").trim() === original.trim() ? (n++, l.replace(original.trim(), replacement)) : l));
  if (!n) return false;
  s.lyric = out.join("\n");
  s.drafts.push({ text: s.lyric, at: Date.now(), by: "line coach" });
  logChoice(s, { id: "Coach", question: `Replace: ${original}`, answer: replacement });
  return true;
}

const LEVEL_NAME = { floor: "Floor", flag: "Flag", info: "Note" };

// ---------- the lyric workshop ----------
// Plain-words help for every reading: why it matters, and what kind of fix it takes.
const RULE_HELP = [
  ["Weak line ending", "line", "The last word of a line is where a listener feels it land. A small word there (the, it, and, of) leaves the line hanging. Real lyrics end that way only 5% of the time."],
  ["Rule V1", "line", "Verses work through pictures: something the listener can see, touch, smell or hear. A line with no picture, and none beside it, tells instead of shows."],
  ["Mouth test: density", "line", "Too many syllables for the time the line has: past what a singer can articulate."],
  ["Mouth test: friction", "line", "Lots of syllables and hard consonants close together. It will feel crowded in the mouth at this tempo."],
  ["Mouth test: consonant cluster", "line", "Where one word ends on consonants and the next starts with them, the tongue has to work. Four in a row is noticeable but common; five is a tongue-twister. Often fine to keep."],
  ["Rare word", "line", "A word most people rarely hear. Listeners get one pass, so a rare word can stop them. Keep it if it is the point."],
  ["Never-say", "line", "This word or phrase is on your own never-say list."],
  ["Rule V2: verse line length", "section", "Verse lines usually run 6 to 9 syllables. This is information about pace, not a rule to obey."],
  ["Rule V2: verse entropy", "section", "When every pair of verse lines has exactly the same count, the verse can sound like a chant. Speech varies a little; letting one line run a syllable longer keeps it conversational. Optional."],
  ["Rule C1: chorus lines shorter", "section", "Choruses usually have shorter, punchier lines than verses (about 7 against 8 syllables). Short lines are easier for a room to sing and make the chorus lift. Longer chorus lines can work, but they feel wordier."],
  ["Rule C1: mirror", "section", "Paired chorus lines that match in length sing on the same melody shape, which makes the chorus easier to learn."],
  ["Rule C2", "section", "The last word of the chorus is the held note. It sings best on an open vowel (oh, ah) or an L or R sound, and on one syllable if possible."],
  ["Held-note vowel", "section", "Notes that are held sound best on open vowels. Close vowels (ee, oo) are harder to sustain and project."],
  ["Rhyme floor", "section", "Nearly half of real line endings rhyme with a line nearby. A block with no rhyme at all, full or loose, can feel unanchored."],
  ["Bridge length", "section", "The bridge is the most exposed moment: four lines at most, plain and heavy."],
  ["Final chorus singable", "section", "The final chorus is sung on the same melody, so each line needs about the same number of syllables as the first chorus."],
  ["Rule C3", "section", "The listener should always know whose interior they are in. A switch between I and he/she between verse and chorus can blur that."],
  ["Title in the hook position", "song", "The title works hardest as the first or last line of the chorus."],
  ["Title count", "song", "Real songs say the title 2 to 9 times; hits about 6."],
  ["Hook length", "song", "The hook line is easiest to remember at 4 to 9 syllables."],
  ["Chorus entropy", "song", "Choruses repeat their own words more than verses do; that repetition is what people remember."],
  ["The ladder line", "song", "Hit lyrics now and then put a thing and a feeling in the same line (the door and the longing). Optional."],
  ["Address", "song", "How much the song says 'you'. Information only."],
  ["Chorus block size", "section", "Real chorus blocks run 4 to 8 lines. Information only."],
];
function helpFor(f) { return RULE_HELP.find(([k]) => f.rule.startsWith(k)) || [f.rule, f.where && f.where.line ? "line" : "section", ""]; }
const findingKey = (f) => `${f.rule}|${f.where ? `${f.where.section || ""}|${f.where.line || ""}|${f.where.text || ""}` : ""}`;

function numberedLyric(text) { return text.split("\n").map((l, i) => `L${i + 1}: ${l}`).join("\n"); }

async function propose(s, instruction, label) {
  const result = analyzeLyric(s.lyric, lyricOptions(s));
  try {
    const r = await askJSON(P.changesPrompt(s, numberedLyric(s.lyric), readingsText(result), instruction), label || "Working out changes");
    const lines = s.lyric.split("\n");
    const kindAt = (n) => { for (let i = n - 1; i >= 0; i--) { const m = lines[i].trim().match(/^\[(.+)\]$/); if (m) return /chorus/i.test(m[1]) ? "chorus" : /verse/i.test(m[1]) ? "verse" : "other"; } return "verse"; };
    const changes = (r.changes || []).filter((c) => Number.isInteger(c.line) && c.line >= 1 && c.line <= lines.length && lines[c.line - 1].trim() && !/^\[.*\]$/.test(lines[c.line - 1].trim()) && c.new && c.new.trim() !== lines[c.line - 1].trim())
      .map((c) => { const nw = c.new.replace(/[.,;:]+$/, "").trim(); return { line: c.line, old: lines[c.line - 1], new: nw, why: c.why || "", accept: true, m: measureCandidate(nw, kindAt(c.line), lyricOptions(s)) }; });
    ui.proposal = { instruction, summary: r.summary || "", changes };
    render();
    setTimeout(() => { const el = $("#proposal"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  } catch { /* shown */ }
}

function applyProposal(s) {
  const pr = ui.proposal;
  if (!pr) return;
  const lines = s.lyric.split("\n");
  let applied = 0;
  pr.changes.filter((c) => c.accept).forEach((c) => {
    if (lines[c.line - 1] === c.old) { lines[c.line - 1] = c.new + (/\s>\s*$/.test(c.old) ? " >" : ""); applied++; }
  });
  if (applied) {
    s.lyric = lines.join("\n");
    s.drafts.push({ text: s.lyric, at: Date.now(), by: "workshop", note: pr.instruction });
    logChoice(s, { id: "Revise", question: `Workshop: ${pr.instruction}`, answer: `${applied} of ${pr.changes.length} changes applied: ${pr.changes.filter((c) => c.accept).map((c) => `"${c.old.trim()}" -> "${c.new}"`).join("; ")}` });
  }
  ui.proposal = null;
  save(); render();
}

async function askEngine(s, question, key) {
  const result = analyzeLyric(s.lyric, lyricOptions(s));
  try {
    const r = await askJSON(P.askPrompt(s, s.lyric, readingsText(result), question), "Thinking about your question");
    ui.answers = ui.answers || {};
    ui.answers[key || "ask"] = { q: question, a: r.answer || "" };
    logChoice(s, { id: "Ask", question, answer: r.answer || "" });
    save(); render();
  } catch { /* shown */ }
}

const QUICK = [
  ["Fix the floors and flags", "Fix what the readings mark as floors and flags, starting with the floors. Change as little as possible."],
  ["Vary the second chorus", "Vary the second chorus lightly so it returns changed: change one or two lines, keep the title line and the last line exactly as they are."],
  ["Vary the second pre-chorus", "Vary the second pre-chorus lightly: change one or two lines so it moves the story on, keeping its shape and rhyme."],
  ["Tighten the chorus lines", "Make the chorus lines shorter and punchier (about 7 syllables), keeping the title line and the last line."],
  ["Ease the mouth-test notes", "Rewrite only the lines the mouth test marks (consonant clusters, crowded lines) so they sing more easily, keeping their meaning."],
  ["More pictures in the verses", "Make the verse lines more concrete: things you can see, touch or hear, in the song's own world."],
];

function stepLyric(s, result) {
  const ta = h("textarea", { id: "lyric", class: "lyricbox", rows: "18", spellcheck: "true", placeholder: "[Verse 1]\n…\n\n[Chorus]\n…" });
  ta.value = s.lyric || "";
  let t = null;
  ta.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { s.lyric = ta.value; save(); renderReadings(s); }, 500);
  });
  const noteBox = h("textarea", { id: "revnote", rows: "2", placeholder: "Your own note, e.g. \"make the bridge less certain\"" });
  const askBox = h("input", { id: "askbox", placeholder: "e.g. Is it a problem that my chorus lines are long?" });
  const ans = ui.answers && ui.answers.ask;
  const editor = h("section", { class: "card" },
    h("p", { class: "eyebrow", text: `Checkpoint (c) · Lyric skeleton · ${s.drafts.length} draft${s.drafts.length === 1 ? "" : "s"} kept` }),
    h("h2", { class: "q", text: s.lyric ? "Edit freely. The readings update as you type." : claudeReady() ? "Draft the lyric, or write it yourself." : "Write the lyric. The readings update as you type." }),
    ta,
    h("div", { class: "row wrap" },
      claudeReady() && !s.lyric ? h("button", { class: "btn primary", onclick: () => draft(s) }, "Draft it from my answers") : null,
      s.drafts.length > 1 ? h("button", { class: "btn", onclick: () => { s.drafts.pop(); s.lyric = s.drafts[s.drafts.length - 1].text; save(); render(); } }, "Undo last change") : null,
    ),
  );
  const workshop = claudeReady() && s.lyric ? h("section", { class: "card" },
    h("p", { class: "eyebrow", text: "Ask Claude for changes" }),
    h("p", { class: "help", text: "Claude proposes changes line by line, each with its reason and its new readings. You choose which to keep. Nothing in your lyric changes until you tap Apply." }),
    h("div", { class: "chips" }, QUICK.map(([label, instr]) => h("button", { class: "chip", onclick: () => propose(s, instr, label) }, label))),
    h("div", { class: "revise" }, noteBox, h("button", { class: "btn", onclick: () => { const v = noteBox.value.trim(); if (v) propose(s, v, "Working on your note"); else noteBox.focus(); } }, "Propose changes for my note")),
    h("p", { class: "eyebrow", text: "Ask the engine a question" }),
    h("p", { class: "help", text: "Answers in plain words. Your lyric is not touched." }),
    h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); const q = askBox.value.trim(); if (q) askEngine(s, q, "ask"); } }, askBox, h("button", { class: "btn", type: "submit" }, "Ask")),
    ans ? h("div", { class: "answerbox" }, h("p", { class: "label", text: ans.q }), h("p", { text: ans.a })) : null,
  ) : null;
  return h("div", { class: "stack" }, editor, proposalCard(s), workshop, h("div", { id: "readings" }, readingsView(s, result)));
}

function proposalCard(s) {
  const pr = ui.proposal;
  if (!pr) return null;
  const n = pr.changes.filter((c) => c.accept).length;
  return h("section", { class: "card proposal", id: "proposal" },
    h("p", { class: "eyebrow", text: "Proposed changes · review each one" }),
    h("p", { class: "help", text: pr.summary || "" }),
    pr.changes.length ? h("ol", { class: "changes" }, pr.changes.map((c, i) => {
      const box = h("input", { type: "checkbox", id: "chg-" + i }); box.checked = c.accept;
      box.addEventListener("change", () => { c.accept = box.checked; render(); });
      return h("li", { class: "change" + (c.accept ? "" : " off") },
        h("label", { class: "check", for: "chg-" + i }, box, h("span", { text: c.accept ? "Keep this change" : "Skip this change" })),
        h("p", { class: "old", text: c.old.trim() }),
        h("p", { class: "new", text: c.new }),
        h("p", { class: "fine", text: `${c.why ? c.why + " · " : ""}${c.m.syllables} syllables · ${c.m.notes.length ? c.m.notes.join(", ") : "clears the line rules"}` }));
    })) : h("p", { text: "No changes proposed." }),
    h("div", { class: "row wrap" },
      pr.changes.length ? h("button", { class: "btn primary", disabled: n ? null : true, onclick: () => applyProposal(s) }, `Apply ${n} change${n === 1 ? "" : "s"}`) : null,
      h("button", { class: "btn ghost", onclick: () => { ui.proposal = null; render(); } }, "Discard")),
  );
}

function renderReadings(s) {
  const el = $("#readings");
  if (!el) return;
  const result = s.lyric ? analyzeLyric(s.lyric, lyricOptions(s)) : null;
  el.replaceChildren(readingsView(s, result));
  const m = manifest(s, result);
  const head = document.querySelector(".manifest-head code");
  if (head) head.textContent = m.head;
}

function findingItem(s, f, result, opts = {}) {
  const lvl = f.level;
  const [, scope, why] = helpFor(f);
  const key = findingKey(f);
  const isKept = (s.constraints || []).some((k) => k.startsWith(f.rule) && (f.where && f.where.text ? k.includes(f.where.text) : f.where && f.where.section ? k.includes(`in ${f.where.section}`) : true));
  const canClaude = claudeReady();
  const hasLine = f.where && f.where.line;
  const ans = ui.answers && ui.answers[key];
  const where = f.where && f.where.section ? `${f.where.section}${f.where.line ? ", line " + f.where.line : ""}${f.where.text ? ": " + f.where.text : ""}` : "The whole song";
  return h("li", { class: "finding " + lvl + (isKept ? " kept" : "") + (opts.next ? " next" : "") },
    h("p", { class: "fhead" }, h("span", { class: "lvl", text: opts.next ? "Next best fix" : LEVEL_NAME[lvl] }), h("span", { text: f.rule.replace(/\s*\(.*\)$/, "") })),
    h("p", { class: "fwhere", text: where }),
    h("p", { class: "fmsg", text: f.message }),
    why ? h("p", { class: "fwhy", text: why }) : null,
    f.fix ? h("p", { class: "ffix", text: `Try: ${f.fix}` }) : null,
    ans ? h("div", { class: "answerbox" }, h("p", { text: ans.a })) : null,
    h("div", { class: "row wrap" },
      canClaude && hasLine ? h("button", { class: "btn small primary", onclick: () => coach(s, f, result) }, "3 ways to fix this line") : null,
      canClaude && !hasLine && scope !== "song" ? h("button", { class: "btn small primary", onclick: () => propose(s, `Fix only this reading, changing as few lines as possible: ${f.rule} in ${f.where && f.where.section ? f.where.section : "the song"}. ${f.message} ${f.fix || ""}`, "Suggesting a fix") }, "Suggest a fix") : null,
      canClaude && scope === "song" ? h("button", { class: "btn small primary", onclick: () => propose(s, `Address this reading, changing as few lines as possible: ${f.rule}. ${f.message} ${f.fix || ""}`, "Suggesting a fix") }, "Suggest a fix") : null,
      canClaude ? h("button", { class: "btn small", onclick: () => askEngine(s, `In plain words: what does this reading mean for my song, and is it a real problem here? "${f.rule}: ${f.message}"${f.where && f.where.text ? ` (the line: "${f.where.text}")` : ""}`, key) }, "Is this a problem?") : null,
      (lvl === "floor" || lvl === "flag") && !isKept ? h("button", { class: "btn small ghost", onclick: () => {
        s.constraints.push(`${f.rule}: kept on purpose${f.where && f.where.text ? `: "${f.where.text}"` : f.where && f.where.section ? ` in ${f.where.section}` : ""}`);
        logChoice(s, { id: "Keep", question: `Keep as written (${f.rule})`, answer: f.where && f.where.text ? f.where.text : f.where && f.where.section ? f.where.section : "the song" });
        save(); render();
      } }, "Keep it as written") : null,
      lvl === "info" ? h("button", { class: "btn small ghost", onclick: () => { s.hidden = [...(s.hidden || []), key]; save(); render(); } }, "Hide") : null,
      isKept ? h("span", { class: "keptmark", text: "Kept as written" }) : null,
    ));
}

function readingsView(s, result) {
  if (!result || !result.sections.length) return h("p", { class: "empty", text: "The readings appear here once there are lines to measure." });
  s.lastRule = "the floor (mouth test, endings, pictures, chorus)";
  const { summary, metrics } = result;
  const hidden = new Set(s.hidden || []);
  const chips = h("div", { class: "summary" },
    h("span", { class: "pill floor" + (summary.floors ? "" : " zero"), text: `${summary.floors} floor` }),
    h("span", { class: "pill flag" + (summary.flags ? "" : " zero"), text: `${summary.flags} flag${summary.flags === 1 ? "" : "s"}` }),
    h("span", { class: "pill info", text: `${summary.infos} note${summary.infos === 1 ? "" : "s"}` }));
  const legend = h("p", { class: "fine", text: "Floor: must be fixed or kept on purpose before you lock. Flag: worth a look. Note: information only, often fine to keep." });

  const lineView = h("div", { class: "lines" }, result.sections.filter((x) => !x.ref).map((sec) =>
    h("div", { class: "sec" },
      h("p", { class: "secname", text: `${sec.name}${sec.rhyme ? " · rhyme " + sec.rhyme.scheme : ""}` }),
      sec.lines.map((l, i) => {
        const pct = Math.min(100, (l.sps / BANDS.sps.p99) * 100);
        const hits = result.findings.filter((f) => f.where && f.where.section === sec.name && f.where.line === i + 1 && !hidden.has(findingKey(f)));
        const worst = hits.find((f) => f.level === "floor") ? "floor" : hits.find((f) => f.level === "flag") ? "flag" : hits.length ? "info" : "ok";
        return h("div", { class: "ln " + worst },
          h("span", { class: "syl", title: "syllables", text: String(l.syllables) }),
          h("span", { class: "ltext", text: l.text }),
          h("span", { class: "meter", title: `${l.sps.toFixed(2)} syllables a second; ticks at the real median, 95th percentile and the 6.4 ceiling` },
            h("span", { class: "fill", style: `width:${pct.toFixed(0)}%` }),
            h("span", { class: "tick", style: `left:${(BANDS.sps.median / BANDS.sps.p99 * 100).toFixed(0)}%` }),
            h("span", { class: "tick", style: `left:${(BANDS.sps.p95 / BANDS.sps.p99 * 100).toFixed(0)}%` })),
        );
      }))));

  const isKeptF = (f) => (s.constraints || []).some((k) => k.startsWith(f.rule));
  const ordered = ["floor", "flag", "info"].flatMap((lvl) => result.findings.filter((f) => f.level === lvl));
  const visible = ordered.filter((f) => !hidden.has(findingKey(f)));
  const next = visible.find((f) => (f.level === "floor" || f.level === "flag") && !isKeptF(f));
  const rest = visible.filter((f) => f !== next);
  const important = rest.filter((f) => f.level !== "info"), notes = rest.filter((f) => f.level === "info");
  const findings = h("div", { class: "stack" },
    important.length ? h("ol", { class: "findings" }, important.map((f) => findingItem(s, f, result))) : null,
    notes.length ? h("details", { class: "notesgroup", open: ui.notesOpen ? true : null, ontoggle: (e) => { ui.notesOpen = e.target.open; } },
      h("summary", { text: `Notes: information only (${notes.length})` }),
      h("ol", { class: "findings" }, notes.map((f) => findingItem(s, f, result)))) : null);

  const coachCard = ui.coach ? h("section", { class: "card coach" },
    h("p", { class: "eyebrow", text: `3 ways to fix · ${ui.coach.section}, line ${ui.coach.line}` }),
    h("p", { class: "orig", text: ui.coach.original }),
    h("p", { class: "help", text: "Tap one to put it in your lyric. Each shows its own readings." }),
    h("div", { class: "options" }, ui.coach.alts.map((a, i) => h("button", { class: "option", onclick: (e) => { pickFlash(e.currentTarget, () => { if (replaceLine(s, ui.coach.original, a.text)) { ui.coach = null; save(); render(); } }); } },
      h("span", { class: "letter", text: String.fromCharCode(65 + i) }),
      h("span", { class: "otext" }, a.text, h("small", { class: "candnote", text: ` ${a.m.syllables} syllables · ${a.m.notes.length ? a.m.notes.join(", ") : "clears the line rules"}` }))))),
    h("button", { class: "link", onclick: () => { ui.coach = null; render(); } }, "Keep my line")) : null;

  const openFloors = result.findings.filter((f) => f.level === "floor" && !(s.constraints || []).some((k) => f.where && f.where.text && k.includes(f.where.text) && k.startsWith(f.rule)));
  const lockBtn = h("button", { class: "btn primary", disabled: openFloors.length ? true : null, onclick: () => {
    s.locked = true; s.lockedAt = Date.now();
    logChoice(s, { id: "Lock", question: "Lock the lyric", answer: "Locked" });
    s.step = "melody"; save(); render(); window.scrollTo(0, 0);
  } }, "Lock the lyric");

  return h("div", { class: "stack" },
    coachCard,
    next ? h("section", { class: "card" }, h("ol", { class: "findings" }, findingItem(s, next, result, { next: true }))) : null,
    h("section", { class: "card" },
      h("p", { class: "eyebrow", text: "The readings · information, not verdicts" }),
      chips, legend,
      h("dl", { class: "metrics" },
        metric("Verse line", metrics.verseLen ? `${metrics.verseLen} syl` : "—", "real 8.2, hits 8.7"),
        metric("Chorus line", metrics.chorusLen ? `${metrics.chorusLen} syl` : "—", "real 7.0"),
        metric("Title sung", `${metrics.titleCount}×`, "real 2–9, hits ~6"),
        metric("Hook", metrics.hookSyllables ? `${metrics.hookSyllables} syl` : "—", "4–9"),
        metric("Speed", `${metrics.spsMedian}/s`, `median line at ${s.contract.bpm} BPM`),
        metric("Ladder lines", `${Math.round(metrics.ladderShare * 100)}%`, "hits ~10%"),
      ),
      lineView,
    ),
    h("section", { class: "card" }, h("p", { class: "eyebrow", text: "Everything else to look at" }),
      rest.length ? findings : h("p", { text: next ? "Nothing else." : "Nothing to report. Every line clears the floor." }),
      hidden.size ? h("button", { class: "link", onclick: () => { s.hidden = []; save(); render(); } }, `Show ${hidden.size} hidden note${hidden.size === 1 ? "" : "s"}`) : null),
    h("section", { class: "card lock" },
      h("h2", { class: "q", text: "Lock the lyric" }),
      h("p", { class: "help", text: openFloors.length ? `${openFloors.length} floor reading${openFloors.length > 1 ? "s are" : " is"} still open. Fix ${openFloors.length > 1 ? "them" : "it"}, or keep a line as written; the choice goes into the record.` : "The floor is clear. Locking keeps this draft as the song's lyric and opens the melody search." }),
      lockBtn),
  );
}

function metric(k, v, note) { return h("div", { class: "metric" }, h("dt", { text: k }), h("dd", {}, h("b", { text: v }), h("small", { text: note }))); }

async function completion(s) {
  if (!claudeReady()) return;
  try {
    const r = await askJSON(P.completionPrompt(s, s.lyric), "Completion check against Q0");
    s.completion = r; save(); render();
  } catch { /* shown */ }
}

function songRecord(s) {
  const result = analyzeLyric(s.lyric, lyricOptions(s));
  const c = s.contract;
  const out = [];
  out.push(`# ${c.title || "Untitled"}`);
  if (c.writer) out.push(`Words and music: ${c.writer}`);
  out.push("");
  out.push(`Type: ${typeLabel(s.type)} · Tempo: ${c.bpm} BPM ${c.feel || ""} · Key: ${c.key || "not set"} · Voice: ${c.voice || "not set"} · Form: ${c.form || "not set"}`);
  out.push("");
  out.push("## Lyric");
  out.push("");
  out.push(s.lyric.replace(/\s*>\s*$/gm, ""));
  out.push("");
  out.push("## The anchor");
  out.push(`Q0: ${s.q0}`);
  if (s.tension && s.tension.statement) out.push(`Tension: ${s.tension.statement}`);
  if (s.completion) out.push(`Completion check: ${s.completion.delivers}. ${s.completion.reading}`);
  out.push("");
  out.push("## Readings (Luthier v45, information not verdicts)");
  out.push(readingsText(result));
  out.push("");
  out.push("## Intake log");
  s.log.forEach((e) => out.push(`- ${e.id}: ${e.question}${e.options && e.options.length ? ` [options: ${e.options.join(" | ")}]` : ""}${e.recommended ? ` [recommended: ${e.recommended}]` : ""} -> ${e.answer}`));
  if (s.melody) {
    out.push(""); out.push("## Melody (Module 27)");
    out.push(`Candidate ${s.melody.id}, rank ${s.melody.rank} of the search with seed ${s.melody.seed} (fingerprint ${s.melody.fingerprint}). Key ${s.melody.key}, voice ${s.melody.voice}, form ${s.melody.form}.`);
    out.push(`Chords: ${Object.entries(s.melody.loops).map(([k, v]) => `${k} ${v.join("-")}`).join("; ")}.`);
    if (s.melodyMap) out.push(`Departure map: ${s.melodyMap.songTotal} of ${s.melodyMap.budget.total} DU in the song; the hook's busiest phrase ${s.melodyMap.hookPeak} of ${s.melodyMap.budget.ceiling}; the verse's ${s.melodyMap.versePeak}.`);
    const mm = s.melody.m; out.push(`Readings: composite ${mm.composite.toFixed(3)}; beta ${mm.beta === null ? "n/a" : mm.beta.toFixed(2)}; CMP ${mm.cmp.toFixed(2)}; memory ${mm.mh.toFixed(2)}; surprisal ${mm.ic.toFixed(2)} (${mm.bits.toFixed(2)} bits); fit ${mm.fit.toFixed(2)}.`);
  }
  const fl = s.melody ? songFloor(s) : null;
  if (fl && !fl.stale) {
    out.push(""); out.push(`## The floor on the finished song (Table G): ${fl.finished ? "clear" : "under the floor"}`);
    fl.checks.forEach((c) => out.push(`- [${c.level}] ${c.group}, ${c.name}: ${c.value} (${c.band})${c.where ? " at " + c.where : ""}`));
  }
  if (s.constraints.length) { out.push(""); out.push("## Kept on purpose"); s.constraints.forEach((k) => out.push(`- ${k}`)); }
  return out.join("\n");
}

function stepDone(s) {
  const rec = songRecord(s);
  const c = s.completion;
  const copyBtn = h("button", { class: "btn", onclick: async (e) => {
    try { await navigator.clipboard.writeText(rec); e.target.textContent = "Copied"; }
    catch { const pre = $("#record"); const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); e.target.textContent = "Selected: copy it"; }
  } }, "Copy the song record");
  const saveBtn = cap.downloads ? h("button", { class: "btn primary", onclick: async () => {
    try { await cap.downloads.save({ filename: `${(s.contract.title || "song").replace(/[^\w\s-]/g, "").trim() || "song"} - song record.md`, data: rec }); }
    catch (e) { ui.error = e && e.code === "declined" ? null : "The file wasn't saved."; render(); }
  } }, "Save the song record") : null;
  return h("div", { class: "stack" },
    card("Completion · Q0", "Does the song deliver what you said it was about?", `You said: "${s.q0}"`,
      c ? h("div", { class: "verdict " + (c.delivers || "") },
        h("p", { class: "eyebrow", text: c.delivers === "yes" ? "Delivers" : c.delivers === "partly" ? "Partly delivers" : "Something was lost" }),
        h("p", { text: c.reading || "" }), c.lost ? h("p", { class: "ffix", text: c.lost }) : null)
        : claudeReady() ? h("button", { class: "btn", onclick: () => completion(s) }, "Run the completion check") : h("p", { class: "help", text: "Read the lyric against your words above. If something was lost, unlock and keep writing." }),
      s.melody ? h("div", { class: "row wrap" },
        h("button", { class: "btn", onclick: () => { const rec = songRecordFor(s); if (rec) Audio.playArrangement(rec, Docs.arrangement(rec)); } }, "▶ Hear the song"),
        h("button", { class: "btn ghost", onclick: () => Audio.stop() }, "■ Stop"),
        h("button", { class: "btn ghost", onclick: () => { ui.prodPlan = null; s.step = "production"; save(); render(); } }, s.production ? "Change the production notes" : "Write the production notes"),
        cap.downloads ? h("button", { class: "btn", onclick: async () => {
          const rec = songRecordFor(s); if (!rec) return;
          const data = Audio.midiFromRecord(rec, Docs.arrangement(rec));
          try { await cap.downloads.save({ filename: `${(s.contract.title || "song").replace(/[^\w\s-]/g, "").trim() || "song"}.mid`, data }); } catch { /* declined */ }
        } }, "Save MIDI") : null) : h("button", { class: "btn primary", onclick: () => { s.step = "melody"; save(); render(); } }, "Find a melody"),
      h("div", { class: "row wrap" }, saveBtn, copyBtn,
        h("button", { class: "btn ghost", onclick: () => { s.locked = false; s.step = "lyric"; logChoice(s, { id: "Unlock", question: "Unlock the lyric", answer: "Unlocked" }); save(); render(); } }, "Unlock and keep writing")),
    ),
    floorCard(s),
    docsCard(s),
    h("section", { class: "card" },
      h("p", { class: "eyebrow", text: "Next in the engine" }),
      h("p", { text: "Next: the demo (the band playing these parts as audio), melisma on held syllables, and the song cycle." }),
      s.melody ? h("button", { class: "link", onclick: () => { s.step = "melody"; save(); render(); } }, "‹ Back to the melody search") : null,
    ),
    h("section", { class: "card" }, h("p", { class: "eyebrow", text: "Song record" }), h("pre", { id: "record", class: "record", text: rec })),
  );
}

// ---------- checkpoint (b): the harmonic skeleton and departure map ----------
function harmonyKinds(s) {
  const secs = s.lyric ? Mel.makeBrief(s, s.lyric).sections : null;
  return Harm.formKinds(s.contract.form, secs);
}
const KIND_LABEL = { verse: "Verse", prechorus: "Pre-chorus", chorus: "Chorus", bridge: "Bridge" };

function chordChips(loop, key, type, mode) {
  return h("div", { class: "chords" }, loop.map((sym) => {
    const cost = Harm.chordCost(sym, type, mode);
    return h("span", { class: "chordchip" + (cost ? " du" + Math.min(3, cost) : ""), title: cost ? `${cost} DU` : "diatonic" },
      h("b", { text: Harm.chordName(sym, key) }), h("small", { text: sym + (cost ? ` · ${cost} DU` : "") }));
  }));
}

function playLoops(skel, key, bpm, beatsPerBar) {
  const order = ["verse", "prechorus", "chorus"].filter((k) => skel[k]);
  const chords = [];
  let t = 0;
  const barLen = beatsPerBar * 2;
  order.forEach((k) => skel[k].forEach((sym) => { const c = Harm.parseChord(sym, key.mode); chords.push({ t, dur: barLen, roman: sym, root: c.root, tones: c.tones }); t += barLen; }));
  Audio.play({ notes: [], chords, length: t }, { bpm, beatsPerBar, key });
}

function skeletonCard(s, c, i, rec, key, kinds, budget) {
  const L = c.ledger;
  const exp = c.expectation;
  const facts = [
    c.facts.loopChanges ? "The chorus changes the loop (83–95% of real songs)" : "The chorus keeps the verse loop (5–17% of real songs)",
    c.facts.chorusOffTonic ? "The chorus starts off the tonic (57–59%)" : "The chorus starts on the tonic (41–43%)",
    c.facts.bridgeDeparts ? "The bridge departs from both" : null,
  ].filter(Boolean);
  return h("section", { class: "card cand" + (i === rec ? " recd" : "") },
    h("div", { class: "candhead" }, h("span", { class: "rank", text: String.fromCharCode(65 + i) }), h("span", { class: "eyebrow", text: `${L.total} of ${budget.total} DU · busiest phrase ${L.peak.du} of ${budget.ceiling}${i === rec ? " · Recommended" : ""}` })),
    kinds.filter((k) => c.skel[k]).map((k) => h("div", { class: "secrow" }, h("p", { class: "label", text: `${KIND_LABEL[k]} · ${L.sections[k].du} DU` }), chordChips(c.skel[k], key, s.type, key.mode))),
    c.spends.length ? h("p", { class: "fine", text: "Departures: " + c.spends.map((x) => `${x.note} in the ${KIND_LABEL[x.where].toLowerCase()}`).join("; ") }) : h("p", { class: "fine", text: "No harmonic departures: the carrier stays plain and leaves the budget to the melody and the words." }),
    h("p", { class: "fine", text: `Chorus on its second pass: ${exp.rows.map((r) => `${r.chord} ${r.quad}`).join(", ")} (expectation ${exp.score.toFixed(2)})` }),
    h("ul", { class: "mini" }, facts.map((f) => h("li", { text: f }))),
    h("div", { class: "row wrap" },
      h("button", { class: "btn small", onclick: () => playLoops(c.skel, key, s.contract.bpm || 80, s.contract.beatsPerBar || 4) }, "▶ Hear verse to chorus"),
      h("button", { class: "btn small ghost", onclick: () => Audio.stop() }, "■ Stop"),
      h("button", { class: "btn small primary", onclick: () => chooseHarmony(s, c.skel, "search", c, budget, i, rec) }, `Choose ${String.fromCharCode(65 + i)}`)),
  );
}

function chooseHarmony(s, skel, source, cand, budget, i, rec) {
  const key = Mel.parseKey(s.contract.key);
  const L = Harm.harmonicLedger(skel, s.type, key.mode);
  s.harmony = { skel, source, total: L.total, peak: L.peak.du, budget: { total: budget.total, ceiling: budget.ceiling }, key: key.name };
  logChoice(s, { id: "Harmony", question: "Which harmonic skeleton? (checkpoint b)", options: ui.harm ? ui.harm.top.map((c) => Object.entries(c.skel).map(([k, v]) => `${k}: ${v.join(" ")}`).join("; ")) : [], recommended: ui.harm && ui.harm.top[rec || 0] ? "A" : null,
    answer: `${source === "writer" ? "Writer's own chords" : "Option " + String.fromCharCode(65 + (i || 0))}: ${Object.entries(skel).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ")} (${L.total}/${budget.total} DU, busiest phrase ${L.peak.du}/${budget.ceiling})` });
  s.lastRule = "Window 19.9 budget, 19.10 discount, Window 28";
  ui.search = null; // a new harmony means a new melody search
  Audio.stop();
  s.step = s.lyric && s.locked ? "melody" : "lyric";
  save(); render(); window.scrollTo(0, 0);
  if (s.step === "lyric" && !s.lyric && claudeReady()) draft(s);
}

function stepHarmony(s) {
  const key = Mel.parseKey(s.contract.key);
  const kinds = harmonyKinds(s);
  const budget = Harm.budgetFor(s.type);
  const intro = card("Checkpoint (b) · Harmonic skeleton and departure map", "Choose the chords the song stands on.",
    `The carrier first: plain enough that the room locks in, so the departures register. One borrowed chord costs 1 departure unit (DU); a secondary dominant or deceptive cadence 2; a modulation 3. A ${budget.name} has ${budget.total} DU for the whole song and ${budget.ceiling} at any one moment, shared with the melody and rhythm.`,
    h("dl", { class: "facts2" },
      [["Key", key.name], ["Sections", kinds.map((k) => KIND_LABEL[k]).join(", ")], ["Budget", `${budget.total} DU, ${budget.ceiling} per moment${budget.note ? " (" + budget.note + ")" : ""}`]].map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
    h("button", { class: "btn primary", onclick: () => {
      const seed = (Mel.hashStr(s.id) + 7 + (s.harmRuns || 0)) >>> 0;
      s.harmRuns = (s.harmRuns || 0) + 1;
      ui.harm = Harm.searchSkeletons(s.type, key.mode, kinds, { n: 600, seed });
      save(); render();
    } }, ui.harm ? "Propose three more" : "Propose the harmony"),
    s.harmony ? h("p", { class: "fine", text: `Chosen: ${Object.entries(s.harmony.skel).map(([k, v]) => `${KIND_LABEL[k] || k} ${v.join(" ")}`).join(" · ")} (${s.harmony.total}/${s.harmony.budget.total} DU)` }) : null,
  );
  const opts = ui.harm ? ui.harm.top.map((c, i) => skeletonCard(s, c, i, 0, key, kinds, budget)) : [];
  // the writer's own chords, measured
  const inputs = {};
  const own = h("form", { class: "contract", onsubmit: (e) => {
    e.preventDefault();
    const skel = {}; const bad = [];
    kinds.forEach((k) => { const p = Harm.parseLoop(inputs[k].value, key.mode); if (p.syms.length) skel[k] = p.syms; bad.push(...p.bad); });
    if (bad.length) { ui.error = `These chords weren't recognised: ${bad.join(", ")}. Use Roman numerals like I V vi IV, bVII, V/V, I7.`; render(); return; }
    if (!Object.keys(skel).length) return;
    ui.error = null;
    chooseHarmony(s, skel, "writer", null, budget);
  } },
    kinds.map((k) => { const inp = h("input", { id: "own-" + k, placeholder: key.mode === "minor" ? "i VI III VII" : "I V vi IV" }); inp.value = s.harmony && s.harmony.skel[k] ? s.harmony.skel[k].join(" ") : ""; inputs[k] = inp; return h("label", { class: "field", for: "own-" + k }, h("span", { text: KIND_LABEL[k] }), inp); }),
    h("button", { class: "btn", type: "submit" }, "Use my chords"),
  );
  const ownCard = h("section", { class: "card" }, h("p", { class: "eyebrow", text: "Or your own chords" }), h("p", { class: "help", text: "Roman numerals, one chord a bar: I V vi IV, bVII, iv, V/V, I7. Your chords are used unchanged and measured the same way." }), own);
  return h("div", { class: "stack" }, intro, ...opts, ownCard,
    h("button", { class: "link", onclick: () => { s.step = s.lyric && s.locked ? "melody" : "lyric"; save(); render(); } }, s.harmony ? "Keep the chosen harmony ›" : "Skip for now (the melody search will draw common loops) ›"));
}

// The departure map of a melody candidate on its chords.
function mapFor(s, cand, brief) {
  return Harm.departureMap(cand.sections, { type: s.type, key: brief.key, beatsPerBar: brief.beatsPerBar, voiceBreak: brief.voice.brk });
}
function mapView(map) {
  const b = map.budget;
  const verdict = map.over.length ? `${map.over.length} phrase${map.over.length > 1 ? "s go" : " goes"} past the ceiling of ${b.ceiling}: past the 1/f boundary there.`
    : map.hookPeak >= b.ceiling - 1 ? `The hook reaches ${map.hookPeak} of ${b.ceiling}: the payload is deployed where it belongs.`
    : `The hook spends ${map.hookPeak} of ${b.ceiling}. A song that never nears its ceiling hasn't deployed its payload.`;
  return h("div", { class: "dumap" },
    h("p", { class: "label", text: `Departure map · ${map.songTotal} of ${b.total} DU in the song · hook ${map.hookPeak}/${b.ceiling} · verse ${map.versePeak}/${b.ceiling}` }),
    h("div", { class: "dubars" }, map.rows.map((r) => h("span", { class: "dub" + (r.over ? " over" : r.kind === "chorus" ? " hook" : ""), style: `height:${8 + r.total * 10}px`, title: `${r.section} line ${r.line}: harmony ${r.harm}, melody ${r.mel}, rhythm ${r.rhy}${r.why.length ? " (" + r.why.join(", ") + ")" : ""}` }))),
    h("p", { class: "fine", text: verdict }));
}

// ---------- the floor on the finished song (Table G) ----------
function pickedCandidate(s) {
  if (!s.melody || !s.lyric) return null;
  const brief = Mel.makeBrief(s, s.lyric);
  const cand = Mel.rebuild(brief, s.melody.seed, s.melody.id);
  const ps = cand.sections.flatMap((x) => x.notes.map((n) => n.p));
  const stored = s.melody.notes.map((n) => n[2]);
  const same = ps.length === stored.length && ps.every((p, i) => p === stored[i]);
  return { cand, brief, same };
}
function songFloor(s) {
  const pc = pickedCandidate(s);
  if (!pc || !pc.same) return pc ? { stale: true } : null;
  return Floor.floorReport(pc.cand, pc.brief, analyzeLyric(s.lyric, lyricOptions(s)));
}
const FLOOR_LEVEL = { floor: "Under the floor", flag: "Flag", info: "Report", pass: "Clear" };
function floorView(f) {
  const groups = [...new Set(f.checks.map((c) => c.group))];
  return h("div", { class: "floorview" }, groups.map((g) => h("div", { class: "fgroup" },
    h("p", { class: "label", text: g }),
    h("ul", { class: "fchecks" }, f.checks.filter((c) => c.group === g).map((c) => h("li", { class: "fcheck " + c.level },
      h("span", { class: "fstate", text: FLOOR_LEVEL[c.level] }),
      h("span", { class: "fname" }, h("b", { text: c.name }), h("span", { text: `: ${c.value}` })),
      h("small", { text: c.band + (c.where ? ` · ${c.where}` : "") + (c.note ? ` · ${c.note}` : "") }),
      c.fix && (c.level === "floor" || c.level === "flag") ? h("small", { class: "ffix", text: c.fix }) : null))))));
}
function floorCard(s) {
  const f = songFloor(s);
  if (!f) return null;
  if (f.stale) return h("section", { class: "card" }, h("p", { class: "eyebrow", text: "The floor on the finished song" }), h("p", { class: "alert", text: "The lyric or the chords changed after the melody was chosen, so the melody no longer fits them. Run the melody search again." }), h("button", { class: "btn", onclick: () => { s.step = "melody"; save(); render(); } }, "Back to the melody search"));
  return h("section", { class: "card" },
    h("p", { class: "eyebrow", text: "The floor on the finished song · Table G" }),
    h("h2", { class: "q", text: f.finished ? "The song clears the floor." : "The song is under the floor." }),
    h("p", { class: "help", text: f.finished ? "Your words sit on the melody the way real songs do, and the singer can breathe. Everything else below is information against real-song bands." : "A song under the alignment or breath floor isn't finished. The fix is usually small: move a syllable, add a rest. Search again or pick another melody." }),
    floorView(f));
}

// ---------- the documents (Module 11.9) ----------
function songRecordFor(s) {
  const pc = pickedCandidate(s);
  if (!pc || !pc.same) return null;
  return Docs.buildRecord(pc.cand, pc.brief, s);
}
const fileBase = (s) => (s.contract.title || "song").replace(/[^\w\s-]/g, "").trim() || "song";
async function saveDoc(s, label, make, filename) {
  ui.docBusy = `Making the ${label}…`; ui.error = null; render();
  try {
    const rec = songRecordFor(s);
    const data = await make(rec, (msg) => { const el = $("#docstatus"); if (el) el.textContent = msg; });
    if (!cap.downloads) throw Object.assign(new Error("no downloads"), { code: "unavailable" });
    await cap.downloads.save({ filename, data: new Uint8Array(data) });
    logChoice(s, { id: "Document", question: "Saved a document", answer: filename });
    ui.docBusy = null; save(); render();
  } catch (e) {
    ui.docBusy = null;
    ui.error = e && e.code === "unavailable" ? "Saving files isn't available in this view. Open the page in claude.ai to save PDFs." : e && e.code === "declined" ? null : `The ${label} couldn't be made: ${e && e.message ? e.message : "unknown error"}.`;
    render();
  }
}
function docsCard(s) {
  if (!s.melody) return null;
  const rec = songRecordFor(s);
  if (!rec) return null;
  const preview = h("div", { class: "abcpreview", "aria-label": "Lead sheet preview" });
  setTimeout(() => Pdf.previewLeadSheet(preview, rec), 0);
  const base = fileBase(s);
  const btn = (label, make, file, primary) => h("button", { class: "btn" + (primary ? " primary" : ""), disabled: ui.docBusy ? true : null, onclick: () => saveDoc(s, label, make, file) }, `Save ${label}`);
  return h("section", { class: "card" },
    h("p", { class: "eyebrow", text: "The documents · one record, five files" }),
    h("h2", { class: "q", text: "Take the song to the band." }),
    h("p", { class: "help", text: `Every document is written from the same record: ${rec.totalBars} bars, a 4-bar intro, ${rec.ks.name} ${rec.key.mode}, ${rec.bpm} BPM. The band parts are a starting arrangement from the chords and the sections (quiet verse, fuller chorus, a thin bridge) until the production notes are written.` }),
    preview,
    ui.docBusy ? h("p", { id: "docstatus", class: "fine", text: ui.docBusy }) : null,
    h("div", { class: "row wrap" },
      btn("full score and parts", (r, prog) => Pdf.scoreAndPartsPdf(r, { onProgress: prog }), `${base} - full score and parts.pdf`, true),
      btn("lead sheet", (r, prog) => Pdf.leadSheetPdf(r, { onProgress: prog }), `${base} - lead sheet.pdf`),
      btn("Nashville chart", (r) => Pdf.chartPdf(r), `${base} - Nashville chart.pdf`),
      btn("songbook", (r) => Pdf.songbookPdf(r, s), `${base} - songbook.pdf`)),
    h("p", { class: "label", text: "To hear it properly (MusicXML and MIDI)" }),
    h("p", { class: "fine", text: "Open the MusicXML file in MuseScore (free, musescore.org), Sibelius, Finale, Dorico or Logic: every instrument with its own sound, the lyric, chords and dynamics, all editable. The MIDI file opens in GarageBand, Logic or any DAW, one track per instrument with the right sound." }),
    h("div", { class: "row wrap" },
      btn("MusicXML file", (r) => new TextEncoder().encode(MusicXML.musicXml(r)).buffer, `${base}.musicxml`, true),
      btn("MIDI file", (r) => Audio.midiFromRecord(r, Docs.arrangement(r)), `${base}.mid`)),
    h("p", { class: "label", text: "Print quality (LilyPond)" }),
    h("p", { class: "fine", text: "One LilyPond file holds the lead sheet, the full score and every part, engraved to the spec's notation rules (Module 11). Open it with LilyPond 2.24 or later (free, lilypond.org), or hand it to the engine's pipeline, and it writes each PDF plus a MIDI file." }),
    h("div", { class: "row wrap" }, btn("LilyPond file", (r) => new TextEncoder().encode(Lily.allLy(r)).buffer, `${base} - lead sheet, score and parts.ly`)),
  );
}

// ---------- checkpoint (e): production notes ----------
function prodPlan(s) {
  if (!ui.prodPlan) ui.prodPlan = s.production && s.production.plan ? JSON.parse(JSON.stringify(s.production.plan)) : Prod.defaultPlan(s.type, Mel.makeBrief(s, s.lyric).voiceName);
  return ui.prodPlan;
}
function recordWithPlan(s, plan) {
  const pc = pickedCandidate(s);
  if (!pc || !pc.same) return null;
  return Docs.buildRecord(pc.cand, pc.brief, { ...s, production: { ...(s.production || {}), plan } });
}
const LEVEL_CYCLE = ["off", "sparse", "on", "full"];
const DRUM_CYCLE = ["off", "intro", "brush", "light", "pre", "full", "quiet", "max", "fade"];
const LEVEL_SHOW = { off: "—", sparse: "sparse", on: "on", full: "full", intro: "intro", brush: "brush", light: "light", pre: "build", quiet: "half-time", max: "max", fade: "fade", silent: "—" };

async function draftTarget(s, rec, arr) {
  if (!claudeReady()) return;
  try {
    const r = await askJSON(`You are a record producer writing the emotional target and references for a song's producer one-sheet. Write for musicians, plainly, with no technical engine terms.

Song: "${rec.title}". What the writer says it is about (their words): ${s.q0 || "(not given)"}. Tension: ${(s.tension && s.tension.statement) || ""}. Key ${rec.ks.name} ${rec.key.mode}, ${rec.bpm} BPM, ${rec.feel || ""}. Instruments: ${arr.layers.map((l) => l.name).join(", ")} (${arr.palette.context}).

Return JSON only: {"target": "two sentences: what the listener should feel, and how the record gets them there", "references": [{"song": "Artist - Song", "take": "one line on what to take from it"}, {...}, {...}]}
Only name real, well-known recordings you are confident exist.`, "Drafting the emotional target");
    ui.prodTarget = r.target || "";
    ui.prodRefs = (r.references || []).slice(0, 3).map((x) => `${x.song}: ${x.take}`);
    render();
  } catch { /* shown */ }
}

function stepProduction(s) {
  const plan = prodPlan(s);
  const rec = recordWithPlan(s, plan);
  if (!rec) return card("Checkpoint (e)", "Choose a melody first.", "", h("button", { class: "btn", onclick: () => { s.step = "melody"; save(); render(); } }, "Back to the melody search"));
  const arr = Docs.arrangement(rec);
  const arc = Prod.energyArc(rec, arr);
  const reg = Prod.registerAudit(rec, arr);
  const suggestions = Prod.suggestPalettes(s.type);
  const others = Object.keys(Prod.PALETTES).filter((k) => !suggestions.includes(k));
  const setPalette = (id) => { ui.prodPlan = Prod.planFor(id); ui.prodPlan.silence = plan.silence; ui.prodPlan.tag = plan.tag; render(); };
  const usedRoles = Prod.ROLES.filter((r) => arr.roles.includes(r));
  const table = h("div", { class: "maptable" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", { text: "" }), arr.layers.map((l) => h("th", { text: l.name })))),
    h("tbody", {}, usedRoles.map((role) => h("tr", {},
      h("th", { text: `${Prod.ROLE_NAME[role]} · ${plan.dynamics[role]}` }),
      arr.layers.map((l) => {
        const lev = (plan.levels[l.id] || {})[role] || "off";
        return h("td", {}, h("button", { class: "lev lev-" + lev, title: "Tap to change", onclick: () => {
          const cyc = l.kind === "drums" ? DRUM_CYCLE : LEVEL_CYCLE;
          plan.levels[l.id][role] = cyc[(cyc.indexOf(lev) + 1) % cyc.length]; render();
        } }, LEVEL_SHOW[lev] || lev));
      }))))));
  const dynRow = h("div", { class: "row wrap" }, usedRoles.map((role) => {
    const sel = h("select", { id: "dyn-" + role, "aria-label": `${Prod.ROLE_NAME[role]} level` }, ["p", "mp", "mf", "f", "ff"].map((d) => { const o = h("option", { value: d, text: `${Prod.ROLE_NAME[role]}: ${d}` }); if (plan.dynamics[role] === d) o.selected = true; return o; }));
    sel.addEventListener("change", () => { plan.dynamics[role] = sel.value; render(); });
    return sel;
  }));
  const silenceBox = h("input", { type: "checkbox", id: "silence" }); silenceBox.checked = plan.silence !== false;
  silenceBox.addEventListener("change", () => { plan.silence = silenceBox.checked; render(); });
  const tagBox = h("input", { type: "checkbox", id: "tagbox" }); tagBox.checked = plan.tag !== false;
  tagBox.addEventListener("change", () => { plan.tag = tagBox.checked; render(); });
  const target = h("textarea", { id: "target", rows: "3", placeholder: "What the listener should feel, and how the record gets them there" });
  target.value = ui.prodTarget ?? (s.production && s.production.target) ?? Prod.oneSheet(rec, s, arr).target;
  const refs = [0, 1, 2].map((i) => { const x = h("input", { id: "ref" + i, placeholder: `Reference ${i + 1}: Artist - Song: what to take from it` }); x.value = (ui.prodRefs || (s.production && s.production.references) || [])[i] || ""; return x; });
  const maxE = Math.max(...arc.rows.map((r) => r.energy), 0.01);
  return h("div", { class: "stack" },
    card("Checkpoint (e) · Production notes", "Dress the song for the room.", "Pick a palette, then shape who plays where. The lead instrument answers the voice in its rests; nothing covers the held title note. The band stops for a beat before the final chorus so its return lands.",
      optionList(suggestions.map((id) => `${Prod.PALETTES[id].name}: ${Prod.PALETTES[id].layers.map((l) => l.name).join(", ")}`), 0, (i) => setPalette(suggestions[i])),
      h("div", { class: "row" }, (() => { const sel = h("select", { id: "otherpal", "aria-label": "Another palette" }, h("option", { value: "", text: "Another palette…" }), others.map((k) => h("option", { value: k, text: Prod.PALETTES[k].name }))); sel.addEventListener("change", () => sel.value && setPalette(sel.value)); return sel; })()),
      h("p", { class: "fine", text: `Now: ${arr.palette.name} (${arr.palette.context}).` })),
    h("section", { class: "card" },
      h("p", { class: "eyebrow", text: "Who plays where · tap a cell to change it" }), table,
      h("p", { class: "label", text: "Level by section" }), dynRow,
      h("label", { class: "check", for: "silence" }, silenceBox, h("span", { text: arr.approachBar >= 0 ? `The designed silence: the band stops at the half bar of bar ${arr.approachBar + 1}, before the final chorus` : "The designed silence before the final chorus (needs two choruses)" })),
      h("label", { class: "check", for: "tagbox" }, tagBox, h("span", { text: "A 4-bar tag at the end, home on the tonic" })),
      h("div", { class: "row wrap" },
        h("button", { class: "btn small", onclick: () => Audio.playArrangement(rec, arr) }, "▶ Hear the arrangement"),
        h("button", { class: "btn small", onclick: () => { const fc = rec.sections.find((x, i) => arr.roles[i] === "final") || rec.sections.find((x) => x.kind === "chorus"); const from = Math.max(0, (fc.startBar - 3) * rec.barLen); Audio.playArrangement(rec, arr, { from, to: from + 6 * rec.barLen }); } }, "▶ Into the final chorus"),
        h("button", { class: "btn small ghost", onclick: () => Audio.stop() }, "■ Stop"))),
    h("section", { class: "card" },
      h("p", { class: "eyebrow", text: "The energy arc · Module 9.12" }),
      h("div", { class: "arc" }, arc.rows.map((r) => h("div", { class: "arcrow" }, h("span", { class: "arcname", text: r.name }), h("span", { class: "arcbar" }, h("span", { class: "arcfill", style: `width:${Math.round((r.energy / maxE) * 100)}%` })), h("span", { class: "arcdyn", text: r.dyn })))),
      h("p", { class: "fine", text: arc.lift !== null ? `Verse to chorus, notes a bar ×${arc.lift}: ${arc.liftBand}.` : "" }),
      arc.flags.length ? h("ul", { class: "mini" }, arc.flags.map((f) => h("li", { class: "warn", text: f }))) : h("p", { class: "fine", text: "No inversions: each chorus is above its verse, the bridge is below the final chorus, the final chorus is the top." }),
      h("p", { class: "eyebrow", text: "Register · Module 9.13" }),
      h("ul", { class: "mini" }, reg.filter((r) => r.share || r.crowdedKeyBars.length).map((r) => h("li", { text: `${r.name}: ${Math.round(r.share * 100)}% of the band's notes inside the voice's range${r.worst.bar ? ` (worst bar ${r.worst.bar}: ${r.worst.tracks.join(", ") || "none"})` : ""}${r.crowdedKeyBars.length ? `; crowded under the held notes in bar ${r.crowdedKeyBars.join(", ")}` : ""}` }))),
    ),
    h("section", { class: "card" },
      h("p", { class: "eyebrow", text: "The producer one-sheet" }),
      h("label", { class: "field", for: "target" }, h("span", { text: "Emotional target" }), target),
      h("p", { class: "label", text: "Three references" }), ...refs,
      h("p", { class: "fine", text: "References are suggestions to check by listening; the app cannot search the web to verify them." }),
      claudeReady() ? h("button", { class: "btn small", onclick: () => draftTarget(s, rec, arr) }, "Draft the target and references with Claude") : null,
      h("button", { class: "btn primary", onclick: () => {
        s.production = { plan: JSON.parse(JSON.stringify(plan)), target: target.value.trim(), references: refs.map((x) => x.value.trim()).filter(Boolean) };
        logChoice(s, { id: "Production", question: "Production notes (checkpoint e)", answer: `${Prod.PALETTES[plan.palette].name}; silence ${plan.silence ? "yes" : "no"}; tag ${plan.tag ? "yes" : "no"}; arc flags: ${arc.flags.length ? arc.flags.join(" ") : "none"}` });
        s.lastRule = "Module 9.12, 9.13";
        ui.prodPlan = null; ui.prodTarget = undefined; ui.prodRefs = undefined;
        Audio.stop(); s.step = "done"; save(); render(); window.scrollTo(0, 0); if (!s.completion) completion(s);
      } }, "Save the production notes")),
  );
}

// ---------- checkpoint (d): the melody search ----------
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  kids.flat().forEach((k) => k && el.append(k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const noteName = (m) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;

// A piano roll of one section: notes as bars on pitch rows, syllables under, chord names over.
function pianoRoll(sec, brief) {
  const ps = sec.notes.map((n) => n.p);
  if (!ps.length) return null;
  const lo = Math.min(...ps, brief.voice.brk) - 1, hi = Math.max(...ps, brief.voice.brk) + 1;
  const W = 14, H = 7, top = 18, rows = hi - lo + 1;
  const width = Math.max(200, sec.length * W + 4), height = top + rows * H + 30;
  const kids = [];
  const barLen = brief.beatsPerBar * 2;
  for (let b = 0; b * barLen < sec.length; b++) {
    kids.push(svg("line", { x1: b * barLen * W, x2: b * barLen * W, y1: top - 4, y2: top + rows * H, class: "bar" }));
    kids.push(svg("text", { x: b * barLen * W + 3, y: 11, class: "chordname" }, sec.loop[b % sec.loop.length]));
  }
  const brkY = top + (hi - brief.voice.brk) * H;
  kids.push(svg("line", { x1: 0, x2: width, y1: brkY, y2: brkY, class: "brk" }));
  sec.notes.forEach((n) => {
    const x = n.onset * W, y = top + (hi - n.p) * H;
    kids.push(svg("rect", { x: x + 1, y: y - H / 2 + 1, width: Math.max(4, n.dur * W - 2), height: H - 1, rx: 2, class: "nt" + (n.peak ? " peak" : "") + (n.money ? " money" : "") }, svg("title", {}, `${n.syl} · ${noteName(n.p)} · ${n.chord}`)));
    if (n.syl !== "–") kids.push(svg("text", { x: x + 1, y: top + rows * H + 14 + (n.onset % 2 ? 10 : 0), class: "syltext" }, n.syl));
  });
  return h("div", { class: "rollwrap" }, svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, class: "roll", role: "img", "aria-label": `${sec.name} melody` }, kids));
}

function melodyBrief(s) {
  const brief = Mel.makeBrief(s, s.lyric);
  return brief;
}

async function runSearch(s) {
  const brief = melodyBrief(s);
  const runs = (s.melodyRuns || 0) + 1;
  const seed = (Mel.hashStr(s.id) + 20261113 + runs) >>> 0;
  ui.search = { running: true, done: 0, n: 3000, survivors: 0 };
  ui.error = null;
  render();
  const res = await Mel.search(brief, { n: 3000, seed, onProgress: (d, n, sv) => {
    ui.search = { running: true, done: d, n, survivors: sv };
    const bar = $("#searchbar"); if (bar) bar.style.width = `${(d / n) * 100}%`;
    const lab = $("#searchlabel"); if (lab) lab.textContent = `${d.toLocaleString()} of ${n.toLocaleString()} built · ${sv} survivors`;
  } });
  s.melodyRuns = runs;
  s.lastRule = "Module 27: Tables A, B, C";
  ui.search = { running: false, result: res, brief };
  s.melodyReport = { seed, generated: res.generated, built: res.built, survivors: res.survivors, rateBuilt: res.rateBuilt, rateAll: res.rateAll, fingerprint: res.fingerprint, deaths: res.deaths.slice(0, 10), calibration: res.calibration, at: Date.now() };
  logChoice(s, { id: "Search", question: "Melody search (Module 27)", answer: `seed ${seed}; ${res.generated} generated; ${res.survivors} survivors (${(res.rateBuilt * 100).toFixed(1)}% of built); fingerprint ${res.fingerprint}` });
  save(); render();
}

function chooseMelody(s, cand, brief, reason) {
  const tl = Audio.timeline(cand, brief);
  s.melody = {
    seed: ui.search.result.seed, id: cand.id, rank: cand.rank, fingerprint: ui.search.result.fingerprint,
    m: { composite: cand.m.composite, beta: cand.m.beta, cmp: cand.m.cmp, mh: cand.m.mh, ic: cand.m.ic, fit: cand.m.fit, bits: cand.m.bits },
    loops: cand.plan.loop, form: cand.plan.form.join(" "), key: brief.key.name, voice: brief.voiceName,
    notes: tl.notes.map((n) => [n.t, n.dur, n.p, n.syl]), chords: tl.chords.map((c) => [c.t, c.dur, c.roman]), length: tl.length,
  };
  const mp = mapFor(s, cand, brief);
  s.melodyMap = { songTotal: mp.songTotal, hookPeak: mp.hookPeak, versePeak: mp.versePeak, over: mp.over.length, budget: { total: mp.budget.total, ceiling: mp.budget.ceiling } };
  logChoice(s, { id: "Melody", question: "Which melody?", options: ui.search.result.top.map((c) => `#${c.rank} (candidate ${c.id})`), recommended: "#1", answer: `#${cand.rank} (candidate ${cand.id})${reason ? " because: " + reason : ""}` });
  Audio.stop();
  ui.error = null; ui.prodPlan = null;
  s.step = "production"; save(); render(); window.scrollTo(0, 0);
}

function stepMelody(s) {
  const brief = melodyBrief(s);
  const S = ui.search;
  const facts = [
    ["Type row", `${typeLabel(s.type)}${brief.tableARowNote ? " (" + brief.tableARowNote + ")" : ""}`],
    ["Key", brief.key.name], ["Voice", `${brief.voiceName}: ${noteName(brief.voice.floor)}–${noteName(brief.voice.ceil)}, break near ${noteName(brief.voice.brk)}`],
    ["Tempo", `${brief.bpm} BPM, ${brief.beatsPerBar}/4, ${brief.barsPerLine} bars a line`], ["Calibration", brief.calibration.replace("_", " ")],
  ];
  const briefCard = card("Checkpoint (d) · The melody search", "The engine writes 3,000 melodies from your words and keeps the best three.",
    "The hook is written from the title's stress: stressed syllables on the beat, the high note on the first strong syllable, the last strong syllable held on a stable note. Every candidate is filtered against your type's limits, rejected below what 95% of real choruses achieve, then ranked. The order is fixed before you hear anything.",
    h("dl", { class: "facts2" }, facts.map(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
    S && S.running ? h("div", { class: "progress" }, h("div", { class: "track" }, h("div", { id: "searchbar", class: "fill", style: `width:${(S.done / S.n) * 100}%` })), h("p", { id: "searchlabel", class: "fine", text: `${S.done} of ${S.n} built` }))
      : h("button", { class: "btn primary", onclick: () => runSearch(s) }, S && S.result ? "Run it again with a new seed" : s.melody ? "Search again" : "Run the search"),
    brief.harmony ? h("p", { class: "fine", text: `On your chosen harmony: ${Object.entries(brief.harmony).map(([k, v]) => `${k} ${v.join(" ")}`).join(" · ")}.` })
      : h("p", { class: "fine" }, "No harmony chosen yet, so the chords come from eight common loops spread across the candidates. ", h("button", { class: "link", onclick: () => { s.step = "harmony"; save(); render(); } }, "Choose the harmony first ›")),
    h("p", { class: "fine", text: "Two parts of the spec's ranking are not here yet: realness (it needs the reference set of real choruses) and the harmonic-expectation term. The rest of the weights are kept in proportion." }),
  );
  if (!S || !S.result) return h("div", { class: "stack" }, briefCard, s.melody ? h("section", { class: "card" }, h("p", { class: "eyebrow", text: "Chosen melody" }), h("p", { text: `Candidate ${s.melody.id} (rank ${s.melody.rank}) from seed ${s.melody.seed}, fingerprint ${s.melody.fingerprint}.` }), h("button", { class: "btn", onclick: () => { s.step = "done"; save(); render(); } }, "Keep it and continue")) : null);

  const r = S.result;
  const report = h("section", { class: "card" },
    h("p", { class: "eyebrow", text: `The report · fingerprint ${r.fingerprint}` }),
    h("dl", { class: "metrics" },
      metric("Generated", r.generated.toLocaleString(), `seed ${r.seed}`),
      metric("Survivors", r.survivors.toLocaleString(), `${(r.rateBuilt * 100).toFixed(1)}% of ${r.built.toLocaleString()} built`),
      metric("Unbuildable", String(r.unbuildable), `${(r.rateAll * 100).toFixed(1)}% over every attempt`),
    ),
    r.rateBuilt > 0.2 ? h("p", { class: "fine", text: "Above the spec's 20% warning band: the filters are passing many. Read the three by ear." }) : r.rateBuilt < 0.01 ? h("p", { class: "alert", text: "Under 1% survived. The commonest death below says what to change: the key, the voice, or the bars a line." }) : null,
    h("p", { class: "label", text: "Deaths by rule" }),
    h("ol", { class: "deaths" }, r.deaths.slice(0, 10).map(([rule, k]) => h("li", {}, h("span", { text: rule }), h("span", { class: "num", text: k.toLocaleString() })))),
  );
  if (!r.top.length) return h("div", { class: "stack" }, briefCard, report);

  const cards = r.top.map((c) => {
    const tl = Audio.timeline(c, S.brief);
    const hook = c.sections.find((x) => x.kind === "chorus" && !x.repeat) || c.sections[0];
    const verse = c.sections.find((x) => x.kind === "verse" && !x.repeat);
    let hookStart = 0; { let t = 0; const barLen = S.brief.beatsPerBar * 2; for (const sec of c.sections) { if (sec === hook) { hookStart = t; break; } t += Math.ceil(sec.length / barLen) * barLen; } }
    const reason = h("input", { id: "why-" + c.id, placeholder: "Why this one? (asked when you pass over #1)" });
    const m = c.m;
    return h("section", { class: "card cand" },
      h("div", { class: "candhead" }, h("span", { class: "rank", text: `#${c.rank}` }), h("span", { class: "eyebrow", text: `Candidate ${c.id} · composite ${m.composite.toFixed(3)}` })),
      h("div", { class: "row wrap" },
        h("button", { class: "btn small", onclick: () => Audio.play(tl, S.brief, { from: hookStart, to: hookStart + hook.length + 2 }) }, "▶ Hear the chorus"),
        h("button", { class: "btn small", onclick: () => Audio.play(tl, S.brief) }, "▶ Whole song"),
        h("button", { class: "btn small ghost", onclick: () => Audio.stop() }, "■ Stop")),
      h("p", { class: "label", text: `${hook.name} · peak and held title note marked` }),
      pianoRoll(hook, S.brief),
      verse ? h("details", {}, h("summary", { text: `${verse.name}` }), pianoRoll(verse, S.brief)) : null,
      h("dl", { class: "metrics" },
        metric("β pitch", m.beta === null ? "—" : m.beta.toFixed(2), "boundary 0.75–1.35"),
        metric("CMP", m.cmp.toFixed(2), "real median 0.40"),
        metric("Memory", m.mh.toFixed(2), "real median 0.79"),
        metric("Surprisal", `${m.ic.toFixed(2)}`, `${m.bits.toFixed(2)} bits mean`),
        metric("Type fit", m.fit.toFixed(2), `verse ${m.verseContour}, chorus ${m.hookContour}`),
        metric("Lift", `${m.verseLift > 0 ? "+" : ""}${m.verseLift} st`, `chorus over verse; range ${m.range}`),
      ),
      (() => { const f = Floor.floorReport(c, S.brief, analyzeLyric(s.lyric, lyricOptions(s))); const bad = f.checks.filter((x) => x.level === "floor").map((x) => x.name.toLowerCase());
        return h("p", { class: "floorchip " + (f.finished ? "ok" : "bad"), text: f.finished ? `Finished-song floor: clear (${f.flags} flag${f.flags === 1 ? "" : "s"})` : `Under the floor: ${bad.join("; ")}` }); })(),
      mapView(mapFor(s, c, S.brief)),
      h("p", { class: "fine", text: `Chords: ${Object.entries(c.plan.loop).map(([k, v]) => `${k} ${v.join("–")}`).join(" · ")} · form ${c.plan.form.join(" ")} · longest run on one note ${m.longestRun}` }),
      c.rank > 1 ? reason : null,
      h("button", { class: "btn primary", onclick: () => {
        const why = c.rank > 1 ? reason.value.trim() : "";
        if (c.rank > 1 && !why) { reason.focus(); ui.error = "Say in a sentence why you're choosing this one over #1. It goes into the record."; render(); return; }
        chooseMelody(s, c, S.brief, why);
      } }, `Choose #${c.rank}`),
    );
  });
  return h("div", { class: "stack" }, briefCard, report, ...cards);
}

function melodyTimeline(s) {
  if (!s.melody) return null;
  return { notes: s.melody.notes.map(([t, dur, p, syl]) => ({ t, dur, p, syl })), chords: s.melody.chords.map(([t, dur, roman]) => ({ t, dur, roman, ...Mel.chordTones(roman, Mel.parseKey(s.contract.key).mode) })), length: s.melody.length };
}

// ---------- boot ----------
async function boot() {
  render();
  try { await Promise.all([loadLexicon(), P.loadSpec()]); }
  catch (e) { $("#app").prepend(h("p", { class: "alert", text: "The word data didn't load. Reload the page to try again." })); }
  render();
  initCaps();
}
boot();
