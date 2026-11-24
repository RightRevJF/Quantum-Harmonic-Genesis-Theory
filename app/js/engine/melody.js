// Module 27: the melody search. Brief -> generate (title-first hook, phrase-form verse)
// -> filter (Table A) -> reject (Table B) -> rank (Table C) -> report.
//
// What this app does NOT have, and says so in every report: the realness measure
// (27.8) needs the 3,310-chorus reference cloud, and the expectation term needs the
// harmony search (27.11). Both are left out of the rank and the weights renormalised.
// The interval model is a hand-set stand-in for the POP909-trained model, tuned to
// the spec's melodic invariants (0.4: steps 0.394-0.578, leaps 0.087-0.195,
// leaps filled by reversal 0.43-0.73).

import { lookup, isVowelPhone } from "./lexicon.js";
import { parseSheet, tokenize } from "./lyric.js";

import { rng, hashStr } from "./melody-rng.js";
import { parseChord } from "./harmony.js";
export { rng, hashStr };
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// ---------- voice rows (Rule 11.2); break = ceiling minus a whole step ----------
const N = (name) => {
  const m = name.match(/^([A-G])(#|b)?(-?\d)$/);
  const pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  return 12 * (Number(m[3]) + 1) + pc;
};
export const VOICES = {
  male: { floor: N("E3"), ceil: N("F#4"), touch: N("G4"), crosses: true },
  female: { floor: N("A3"), ceil: N("B4"), touch: N("C5"), crosses: true },
  "male worship": { floor: N("E3"), ceil: N("G4"), touch: N("A4"), crosses: true },
  "female worship": { floor: N("A3"), ceil: N("C5"), touch: N("D5"), crosses: true },
  "male gospel": { floor: N("E3"), ceil: N("A4"), touch: N("B4"), crosses: true },
  "female gospel": { floor: N("A3"), ceil: N("D5"), touch: N("E5"), crosses: true },
  anthemic: { floor: N("E3"), ceil: N("G4"), touch: N("A4"), crosses: true },
  congregational: { floor: N("C3"), ceil: N("E4"), touch: N("E4"), crosses: false },
  bass: { floor: N("B2"), ceil: N("C4"), touch: N("D4"), crosses: true },
};
Object.values(VOICES).forEach((v) => { v.brk = v.crosses ? v.ceil - 2 : v.ceil + 2; });

export function voiceRow(text = "", type = "") {
  const t = text.toLowerCase();
  const fem = /female|woman|women|girl|soprano|alto|her\b|she\b/.test(t);
  if (/congreg/.test(t)) return "congregational";
  if (/bass|barit/.test(t)) return "bass";
  if (/anthem/.test(t)) return "anthemic";
  if (/gospel/.test(t) || type === "T") return fem ? "female gospel" : "male gospel";
  if (/worship/.test(t) || type === "W") return fem ? "female worship" : "male worship";
  return fem ? "female" : "male";
}

// ---------- Table A (Windows 19.6-19.7 as numbers) ----------
const TB = { "low-mid": [0.2, 0.5], mid: [0.35, 0.65], "mid-high": [0.5, 0.8], high: [0.65, 0.95] };
const row = (vt, vp, vc, ht, hp, hc, deg, maxLeap, hookLeap, place, dens, sync, phrase, mono) =>
  ({ verse: { tess: TB[vt], pass: vp, contour: vc }, hook: { tess: TB[ht], pass: hp, contour: hc }, hookDegrees: deg, maxLeap, hookLeap, placement: place, density: dens, sync, phrase, mono });
export const TABLE_A = {
  G: row("low-mid", "below", ["flat", "wave"], "low-mid", "below", ["flat", "wave"], [1, 5, 8], 4, 0, [1.0, 1.5], [2.0, 7.0], [0.3, 0.6], [4, 8], 3),
  L: row("mid", "below", ["descending", "wave"], "mid", "approach", ["descending", "wave"], [6, 7], 5, 0, [0.0, 1.0], [0.5, 4.0], [0.0, 0.15], [4, 8], 3),
  B: row("mid", "below", ["flat", "wave"], "mid-high", "cross", ["arch", "wave"], [1, 3, 5, 6], 9, 7, [0.0], [1.0, 6.0], [0.2, 0.5], [4, 4], 3),
  A: row("low-mid", "below", ["arch", "wave"], "high", "cross", ["arch"], [1, 5, 8], 12, 7, [0.0], [1.0, 6.0], [0.0, 0.15], [4, 8], 3),
  N: row("mid", "below", ["wave"], "mid-high", "approach", ["arch"], [6, 7], 9, 5, [0.0], [1.0, 5.0], [0.05, 0.3], [4, 8], 3),
  V: row("mid", "below", ["wave"], "mid-high", "approach", ["arch", "wave"], [3, 5], 7, 0, [1.5, 3.0], [1.0, 5.0], [0.05, 0.3], [4, 8], 3),
  W: row("mid", "approach", ["wave"], "high", "cross", ["arch"], [5, 8], 12, 7, [0.0], [1.5, 5.0], [0.1, 0.3], [4, 4], 3),
  "W-enthronement": row("high", "above", ["arch", "flat"], "high", "above", ["arch", "flat"], [1, 5, 8], 12, 0, [0.0], [1.5, 4.0], [0.0, 0.1], [4, 8], 3),
  "W-contemplative": row("low-mid", "below", ["descending", "flat"], "low-mid", "below", ["descending", "flat"], [1, 3], 4, 0, [2.0, 2.5], [0.25, 3.0], [0.0, 0.1], [8, 16], 4),
  T: row("low-mid", "below", ["wave"], "high", "cross", ["arch"], [5, 8], 12, 7, [0.0], [1.0, 7.0], [0.25, 0.55], [4, 8], 3),
  P: row("mid", "approach", ["flat", "wave"], "mid", "approach", ["flat", "wave"], [2, 7], 5, 0, [1.5, 3.0], [1.5, 5.0], [0.1, 0.3], [4, 8], 4),
  PR: row("low-mid", "below", ["descending", "flat"], "high", "cross", ["arch"], [1, 5, 8], 12, 7, [0.0], [1.0, 5.0], [0.05, 0.3], [4, 4], 3),
};
// No Meditative row in Table A: the app reads M against W-contemplative (the nearest row) and says so.
TABLE_A.M = TABLE_A["W-contemplative"];
TABLE_A.LR = TABLE_A.L; TABLE_A.LD = TABLE_A.L;
const POP_BAND = { density: [2.0, 10.0], sync: [0.05, 0.45] };
// Types read against the ballad and hymn bands use the lead-sheet density (0.4, fix 3.7).
const LEAD_SHEET_TYPES = new Set(["L", "LR", "LD", "N", "W", "W-enthronement", "W-contemplative", "M"]);

// ---------- Table B calibrations ----------
export const TABLE_B = {
  pop_major: { beta: [0.556, 1.867], cmp: 0.283, ic: 0.37, bits: [2.34, 3.582], spikes: 8, mh: 0.484 },
  pop_minor: { beta: [0.685, 1.908], cmp: 0.265, ic: 0.354, bits: [2.531, 4.157], spikes: 7, mh: 0.378 },
  hymn: { beta: [0.744, 2.228], cmp: 0.35, ic: 0.313, bits: [2.734, 4.377], spikes: 5, mh: 0.546 },
  folk: { beta: [0.513, 2.411], cmp: 0.338, ic: 0.412, bits: [2.42, 4.131], spikes: 4, mh: 0.321 },
};
function calibration(type, mode) {
  const base = (type || "P").split("/")[0];
  if (base === "W" || base === "M") return "hymn";
  if (["N", "L", "LR", "LD"].includes(base)) return "folk";
  return mode === "minor" ? "pop_minor" : "pop_major";
}

// Table C weights; realness (0.25) and expectation (0.05) are absent here, so the rest are renormalised.
export const WEIGHTS = { spectral: 0.15, cmp: 0.15, horizon: 0.10, fit: 0.15, ic: 0.15 };

// ---------- keys and chords ----------
const PC = { c: 0, "c#": 1, db: 1, d: 2, "d#": 3, eb: 3, e: 4, f: 5, "f#": 6, gb: 6, g: 7, "g#": 8, ab: 8, a: 9, "a#": 10, bb: 10, b: 11 };
export function parseKey(text = "") {
  const t = text.trim().toLowerCase().replace("♭", "b").replace("♯", "#");
  const m = t.match(/^([a-g])([#b])?\s*(m(?:in(?:or)?)?|maj(?:or)?)?/);
  if (!m) return { tonic: 7, mode: "major", name: "G major" };
  const tonic = PC[m[1] + (m[2] || "")];
  const mode = m[3] && m[3].startsWith("m") && !m[3].startsWith("maj") ? "minor" : "major";
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return { tonic, mode, name: `${names[tonic]} ${mode}` };
}
const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

// Chord tones (pitch classes relative to the tonic) of a Roman numeral in the key.
export function chordTones(roman, mode) {
  const c = parseChord(roman, mode) || parseChord(mode === "minor" ? "i" : "I", mode);
  return { root: c.root, tones: c.tones };
}

// Table F stand-in: common loops (POP909 and McGill pooled in the spec; hand-listed here).
export const LOOPS = {
  major: [
    { verse: ["I", "V", "vi", "IV"], hook: ["IV", "I", "V", "vi"] },
    { verse: ["vi", "IV", "I", "V"], hook: ["I", "V", "vi", "IV"] },
    { verse: ["I", "IV", "vi", "V"], hook: ["IV", "V", "I", "vi"] },
    { verse: ["I", "vi", "IV", "V"], hook: ["I", "V", "IV", "IV"] },
    { verse: ["I", "I", "IV", "I"], hook: ["IV", "I", "V", "I"] },
    { verse: ["vi", "V", "IV", "V"], hook: ["I", "V", "vi", "IV"] },
    { verse: ["I", "iii", "IV", "V"], hook: ["IV", "I", "ii", "V"] },
    { verse: ["I", "bVII", "IV", "I"], hook: ["IV", "I", "bVII", "I"] },
  ],
  minor: [
    { verse: ["i", "VI", "III", "VII"], hook: ["VI", "VII", "i", "i"] },
    { verse: ["i", "iv", "VI", "V"], hook: ["VI", "III", "VII", "i"] },
    { verse: ["i", "VII", "VI", "VII"], hook: ["i", "VI", "III", "VII"] },
    { verse: ["i", "i", "iv", "i"], hook: ["VI", "VII", "i", "V"] },
    { verse: ["i", "VI", "iv", "V"], hook: ["III", "VII", "VI", "V"] },
    { verse: ["i", "III", "VII", "iv"], hook: ["VI", "VII", "i", "i"] },
    { verse: ["i", "v", "VI", "iv"], hook: ["i", "VI", "III", "VII"] },
    { verse: ["i", "VII", "VI", "V"], hook: ["iv", "VI", "V", "i"] },
  ],
};

// ---------- syllables with stress (Principle 25) ----------
const FUNCTION = new Set("a an the and but or of to in on at by for with from as is am are was were be been it its i me my we us our you your he him his she her they them their this that than then so if not no do does did has have had will would can could shall should may might must".split(" "));
function syllabify(line) {
  const out = [];
  tokenize(line).forEach((w) => {
    const L = lookup(w);
    const vowels = L.phones.filter(isVowelPhone);
    const n = Math.max(1, vowels.length);
    for (let i = 0; i < n; i++) {
      const v = vowels[i] || "AH0";
      let stress = Number(v.slice(-1)) || 0;
      if (n === 1) stress = FUNCTION.has(w) ? 0 : 1;
      out.push({ word: w, part: i, of: n, text: n === 1 ? w : `${w}${i < n - 1 ? "-" : ""}`, stress, reduced: /^(AH|IH)0$/.test(v), vowel: v.replace(/\d/, "") });
    }
  });
  // fix multi-syllable display: show the word on its first syllable, "-" continuation after
  out.forEach((s) => { if (s.of > 1) s.text = s.part === 0 ? s.word : "–"; });
  return out;
}

// ---------- rhythm from the words ----------
// Returns [{syl, onset (eighths from line start), dur (eighths)}] in a slot of `slot` eighths.
function lineRhythm(syls, slot, r, opts = {}) {
  const breath = 2;
  const avail = slot - breath;
  const tryOnce = () => {
    let pos = syls.length + 2 <= avail ? pick(r, [0, 0, 1, 2]) : 0;
    const notes = [];
    for (let i = 0; i < syls.length; i++) {
      const s = syls[i];
      if (s.stress > 0 && pos % 2 === 1 && notes.length && r() < 0.8 && (avail - pos) > (syls.length - i)) {
        notes[notes.length - 1].dur += 1; pos += 1; // pull the stressed syllable onto the beat
      }
      let dur = 1;
      if (s.stress > 0 && r() < 0.35) dur = 2;
      if (i === opts.money) dur = pick(r, [3, 4]);
      notes.push({ syl: s, onset: pos, dur });
      pos += dur;
    }
    // squeeze if too long
    let over = pos - avail;
    for (let i = notes.length - 1; i >= 0 && over > 0; i--) {
      if (notes[i].dur > 1) { const cut = Math.min(over, notes[i].dur - 1); notes[i].dur -= cut; over -= cut; for (let j = i + 1; j < notes.length; j++) notes[j].onset -= cut; }
    }
    if (over > 0) return null;
    // the last syllable takes the rest of the line before the breath
    const last = notes[notes.length - 1];
    last.dur = Math.max(last.dur, avail - last.onset);
    return notes;
  };
  for (let k = 0; k < 12; k++) {
    const n = tryOnce();
    if (!n) continue;
    if (opts.placement && opts.money !== undefined && opts.money >= 0) {
      const m = n[opts.money];
      const beatInBar = ((m.onset % (opts.beatsPerBar * 2)) / 2);
      if (!opts.placement.includes(beatInBar) && k < 11) continue;
    }
    return n;
  }
  return null;
}

// ---------- pitch generation ----------
function scalePitches(key, lo, hi) {
  const sc = SCALE[key.mode];
  const out = [];
  for (let p = lo; p <= hi; p++) if (sc.includes(((p - key.tonic) % 12 + 12) % 12)) out.push(p);
  return out;
}
export function degreeOf(p, key) {
  const rel = ((p - key.tonic) % 12 + 12) % 12;
  const i = SCALE[key.mode].indexOf(rel);
  return i >= 0 ? i + 1 : null;
}
const BASE_W = (iv) => {
  const a = Math.abs(iv);
  if (a === 0) return 0.14;
  if (a <= 2) return 0.30;
  if (a <= 4) return 0.12;
  if (a === 5) return 0.06;
  if (a === 7) return 0.04;
  if (a <= 9) return 0.02;
  return 0.01;
};

function choosePitch(r, ctx) {
  const { prev, prev2, cands, chord, strong, center, sd, maxLeap, endLine, key, bias } = ctx;
  ctx.run = ctx.run || 1;
  const ws = cands.map((p) => {
    const iv = prev === null ? 0 : p - prev;
    if (prev !== null && Math.abs(iv) > maxLeap) return 0;
    let w = prev === null ? 1 : BASE_W(iv);
    const pc = ((p - key.tonic) % 12 + 12) % 12;
    const ct = chord.tones.includes(pc);
    if (strong) w *= ct ? 3 : 0.5;
    w *= Math.exp(-((p - center) ** 2) / (2 * sd * sd));
    if (prev2 !== null && prev !== null && Math.abs(prev - prev2) >= 5 && Math.sign(iv) === -Math.sign(prev - prev2)) w *= 3; // gap-fill
    if (prev2 !== null && prev === prev2 && iv === 0) w *= ctx.runLimit && ctx.run >= ctx.runLimit ? 0 : 0.05;
    if (endLine && [1, 3, 5].includes(degreeOf(p, key))) w *= 2;
    if (bias && prev !== null) w *= iv < 0 ? 1 + bias : iv > 0 ? 1 / (1 + bias) : 1;
    return w;
  });
  const sum = ws.reduce((a, b) => a + b, 0);
  if (!sum) return null;
  let x = r() * sum;
  for (let i = 0; i < cands.length; i++) { x -= ws[i]; if (x <= 0) return { p: cands[i], bits: -Math.log2(ws[i] / sum) }; }
  return { p: cands[cands.length - 1], bits: -Math.log2(ws[ws.length - 1] / sum) };
}

function chordAt(section, eighth, key) {
  const bar = Math.floor(eighth / section.barLen);
  const roman = section.loop[bar % section.loop.length];
  return { roman, ...chordTones(roman, key.mode) };
}

// Reference expectation model for the surprisal contour: a fixed first-order interval
// distribution (semitones) shaped like sung pop lines, with Narmour's gap-fill. The spec's
// model is variable-order and corpus-trained; this stand-in is fixed so every candidate is
// read by the same listener, not by the generator that wrote it.
const REF = { 0: 0.20, 1: 0.06, 2: 0.14, 3: 0.06, 4: 0.04, 5: 0.04, 6: 0.005, 7: 0.015, 8: 0.006, 9: 0.006, 10: 0.003, 11: 0.002, 12: 0.004 };
export function refBits(prevIv, iv) {
  const a = Math.abs(iv);
  let p = (REF[a] ?? 0.001) * (a === 0 ? 1 : 1);
  if (Math.abs(prevIv) >= 5 && Math.sign(iv) === -Math.sign(prevIv) && a <= 4) p *= 1.8;
  return -Math.log2(Math.min(0.5, p));
}

// ---------- build one candidate ----------
function buildSection(sec, plan, r, brief, ref) {
  const { key, voice, row } = brief;
  const range = voice.ceil - voice.floor;
  const role = sec.kind === "chorus" ? "hook" : "verse";
  const band = sec.kind === "bridge" ? [Math.min(0.9, row.hook.tess[0] + 0.1), Math.min(0.95, row.hook.tess[1] + 0.1)] : row[role].tess;
  const center = voice.floor + range * (band[0] + band[1]) / 2;
  const sd = range * 0.35;
  const offsets = { a: 0, b: 2 + Math.floor(r() * 3), c: Math.floor(r() * 4) - 2 };
  const pass = sec.kind === "bridge" ? "approach" : row[role].pass;
  let top = sec.kind === "chorus" && plan.last ? voice.touch : voice.ceil;
  if (pass === "below") top = Math.min(top, voice.brk - 3);
  if (pass === "approach") top = Math.min(top, voice.brk);
  const cands = scalePitches(key, voice.floor, top);
  const barLen = brief.beatsPerBar * 2;
  const slot = brief.barsPerLine * barLen;
  const section = { name: sec.name, kind: sec.kind, barLen, loop: loopFor(plan.loop, sec.kind), lines: [], notes: [] };
  let t = 0;
  let prev = null, prev2 = null, run = 1;
  const form = plan.form;
  const titleNorm = brief.titleNorm;
  sec.lines.forEach((ln, li) => {
    const syls = syllabify(ln.text);
    if (!syls.length) return;
    // a line gets more bars when its syllables would crowd the type's density ceiling (design consequence, reported)
    const needBars = Math.ceil(syls.length / (brief.density[1] * 0.9));
    let lslot = Math.max(slot, needBars * barLen);
    if (syls.length + 2 > lslot) lslot += barLen;
    if (lslot > slot) section.grown = Math.max(section.grown || 0, lslot / barLen);
    // title-first: find the title in this line
    let peak = -1, money = -1;
    const words = syls.map((s) => s.word).join(" ");
    const isTitle = role === "hook" && titleNorm && ` ${words} `.includes(` ${titleNorm} `);
    if (isTitle) {
      const tw = titleNorm.split(" ");
      const start = words.split(" ").findIndex((_, i, arr) => arr.slice(i, i + tw.length).join(" ") === titleNorm);
      let wi = -1; const idx = [];
      syls.forEach((s, i) => { if (s.part === 0) wi++; if (wi >= start && wi < start + tw.length) idx.push(i); });
      peak = idx.find((i) => syls[i].stress > 0 && !syls[i].reduced) ?? idx[0];
      const stressed = idx.filter((i) => syls[i].stress > 0);
      money = stressed.length ? stressed[stressed.length - 1] : idx[idx.length - 1];
    }
    const rh = lineRhythm(syls, lslot, r, { money: isTitle ? money : -1, placement: isTitle ? row.placement : null, beatsPerBar: brief.beatsPerBar });
    if (!rh) { section.unbuildable = true; return; }
    const letter = form[li % form.length];
    const refLine = ref && ref.lines[li] ? ref.lines[li] : section.lines.find((x) => x.letter === letter.replace("'", ""));
    const lineNotes = [];
    rh.forEach((n, i) => {
      const onset = t + n.onset;
      const chord = chordAt(section, onset, key);
      const strong = onset % 2 === 0;
      let res;
      if (refLine && refLine.notes[i] && !(isTitle && (i === peak || i === money))) {
        // varied return: keep the reference contour, refit to the chord on strong beats
        const target = refLine.notes[i].p + (prev !== null && refLine.notes[i - 1] ? 0 : 0);
        const near = cands.filter((p) => Math.abs(p - target) <= 2 && (prev === null || Math.abs(p - prev) <= row.maxLeap) && !(run >= row.mono && p === prev));
        const pc = (p) => ((p - key.tonic) % 12 + 12) % 12;
        const fit = strong ? near.filter((p) => chord.tones.includes(pc(p))) : near;
        const pool = fit.length ? fit : near.length ? near : cands;
        const pp = pool.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
        res = { p: pp, bits: 1.0 + (pp === target ? 0 : 1) };
      } else if (isTitle && i === peak) {
        // the high note on the peak syllable, top of the hook tessitura, on a hook degree
        const topT = voice.floor + range * row.hook.tess[1];
        const want = row.hookDegrees.map((d) => (d === 8 ? 1 : d));
        let opts = cands.filter((p) => want.includes(degreeOf(p, key)) && p <= topT + 2 && p >= topT - 5);
        if (row.hook.pass === "cross") { const above = cands.filter((p) => want.includes(degreeOf(p, key)) && p > voice.brk); if (above.length) opts = above; }
        const leapy = plan.leapRule;
        const pool = opts.filter((p) => prev === null || (Math.abs(p - prev) <= row.maxLeap && (!leapy || p - prev >= Math.max(5, row.hookLeap))));
        const pp = pool.length ? pick(r, pool) : opts.length ? pick(r, opts) : choosePitch(r, { prev, prev2, cands, chord, strong, center: topT, sd, maxLeap: row.maxLeap, key }).p;
        res = { p: pp, bits: 4.5 };
      } else if (isTitle && i === money) {
        // the money syllable: a stable degree at or below the current pitch, held
        const stable = cands.filter((p) => [1, 3, 5].includes(degreeOf(p, key)) && (prev === null || (p <= prev && prev - p <= row.maxLeap)));
        const pp = stable.length ? stable.reduce((a, b) => (Math.abs(b - (prev ?? center)) < Math.abs(a - (prev ?? center)) ? b : a)) : prev ?? center;
        res = { p: pp, bits: 1.5 };
      } else {
        const bias = isTitle && peak >= 0 && i > peak ? 0.8 : 0;
        res = choosePitch(r, { prev, prev2, cands, chord, strong, center: center + (offsets[letter[0]] || 0), sd, maxLeap: row.maxLeap, endLine: i === rh.length - 1, key, bias, run, runLimit: row.mono });
      }
      if (!res) { section.unbuildable = true; return; }
      const ivNow = prev === null ? 0 : res.p - prev;
      const ivPrev = prev === null || prev2 === null ? 0 : prev - prev2;
      const note = { p: res.p, bits: prev === null ? 3 : refBits(ivPrev, ivNow), onset, dur: n.dur, syl: n.syl.text, stress: n.syl.stress, reduced: n.syl.reduced, chord: chord.roman, line: li, peak: isTitle && i === peak, money: isTitle && i === money };
      lineNotes.push(note);
      run = prev === res.p ? run + 1 : 1;
      prev2 = prev; prev = res.p;
    });
    section.lines.push({ letter: letter.replace("'", ""), notes: lineNotes, text: ln.text, start: t, slot: lslot });
    section.notes.push(...lineNotes);
    t += lslot;
  });
  section.length = t;
  section.bars = Math.ceil(t / barLen);
  return section;
}

const FORMS = [["a", "a'", "b", "c"], ["a", "b", "a'", "c"], ["a", "a'", "b", "a'"], ["a", "b", "a", "b'"], ["a", "a'", "b", "b'"]];

// The section's loop: the chosen harmony's, or the nearest kind's.
export function loopFor(loops, kind) {
  return loops[kind] || (kind === "chorus" ? loops.hook : null) || (kind === "prechorus" || kind === "bridge" ? loops.verse : null) || loops.verse || loops.chorus;
}

export function makeBrief(song, lyricText) {
  const c = song.contract || {};
  const key = parseKey(c.key);
  const vname = voiceRow(c.voice, (song.type || "").split("/")[0]);
  const base = (song.type || "P").split("/")[0];
  const row = TABLE_A[base] || TABLE_A.P;
  const sections = parseSheet(lyricText);
  return {
    type: song.type || "P", base, key, voiceName: vname, voice: VOICES[vname], row,
    bpm: c.bpm || 80, beatsPerBar: c.beatsPerBar || 4, barsPerLine: c.barsPerLine || 2,
    title: c.title || "", titleNorm: tokenize(c.title || "").join(" "), sections,
    density: LEAD_SHEET_TYPES.has(base) ? row.density : POP_BAND.density,
    sync: LEAD_SHEET_TYPES.has(base) ? row.sync : POP_BAND.sync,
    calibration: calibration(song.type, key.mode),
    tableARowNote: base === "M" ? "Table A has no Meditative row; read against W-contemplative." : "",
    harmony: song.harmony && song.harmony.skel ? song.harmony.skel : null,
  };
}

export function buildCandidate(brief, seed, idx) {
  const r = rng(seed + idx * 7919);
  const loops = LOOPS[brief.key.mode];
  const L = loops[idx % 8];
  // The writer's chosen harmony is used unchanged; without one the candidates spread across eight loop pairs.
  const loop = brief.harmony ? { ...brief.harmony } : { verse: L.verse, chorus: L.hook };
  const plan = { loop, loopIndex: brief.harmony ? null : idx % 8, form: pick(r, FORMS), leapRule: r() < 0.5 };
  const built = new Map();
  const out = [];
  const lastChorus = brief.sections.map((s) => s.kind).lastIndexOf("chorus");
  brief.sections.forEach((s, si) => {
    const keyName = s.kind + ":" + s.lines.map((l) => l.text).join("|");
    if (built.has(keyName)) { out.push({ ...built.get(keyName), name: s.name, repeat: true }); return; }
    const sameKind = out.find((x) => x.kind === s.kind && !x.repeat);
    const sec = buildSection(s, { ...plan, last: si === lastChorus }, r, brief, sameKind && s.kind === "verse" ? sameKind : null);
    built.set(keyName, sec);
    out.push(sec);
  });
  return { id: idx, seed, plan, sections: out };
}

// ---------- measures ----------
export function betaPitch(seq) {
  const n = seq.length;
  if (n < 16) return null;
  const m = seq.reduce((a, b) => a + b, 0) / n;
  const x = seq.map((v) => v - m);
  const xs = [], ys = [];
  for (let k = 1; k <= Math.floor(n / 2); k++) {
    let re = 0, im = 0;
    for (let t = 0; t < n; t++) { const a = (2 * Math.PI * k * t) / n; re += x[t] * Math.cos(a); im -= x[t] * Math.sin(a); }
    const pw = (re * re + im * im) / n;
    if (pw > 0) { xs.push(Math.log(k / n)); ys.push(Math.log(pw)); }
  }
  if (xs.length < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((v, i) => { num += (v - mx) * (ys[i] - my); den += (v - mx) ** 2; });
  return -(num / den);
}
// Module 1 boundary score from beta_pitch: full credit inside 0.75-1.35, falling to 0 at 0.25 and 2.1 (this app's mapping).
export function sSpectral(beta) {
  if (beta === null) return 0.5;
  if (beta >= 0.75 && beta <= 1.35) return 1 - Math.abs(beta - 1.05) / 0.3 * 0.2;
  if (beta < 0.75) return Math.max(0, 0.8 * (beta - 0.25) / 0.5);
  return Math.max(0, 0.8 * (2.1 - beta) / 0.75);
}

function isChordTone(n, key) {
  const pc = ((n.p - key.tonic) % 12 + 12) % 12;
  return chordTones(n.chord, key.mode).tones.includes(pc);
}

// Module 7 CMP = 0.30 A_approach + 0.25 A_asym + 0.25 G_gravity + 0.20 B_line
export function cmp(notes, lines, key) {
  const strongIdx = notes.map((n, i) => (n.onset % 2 === 0 ? i : -1)).filter((i) => i >= 0);
  const structural = strongIdx.filter((i) => isChordTone(notes[i], key));
  const approached = structural.filter((i) => i > 0 && Math.abs(notes[i].p - notes[i - 1].p) <= 2);
  const A_approach = structural.length ? approached.length / structural.length : 0;
  let up = 0, down = 0, upSize = 0, downSize = 0;
  for (let i = 1; i < notes.length; i++) { const d = notes[i].p - notes[i - 1].p; if (d > 0) { up++; upSize += d; } else if (d < 0) { down++; downSize -= d; } }
  const A_asym = up + down ? Math.abs(up - down) / (up + down) : 0;
  const G_gravity = strongIdx.length ? structural.length / strongIdx.length : 0;
  const apexes = lines.map((l) => Math.max(...l.notes.map((n) => n.p))).filter(Number.isFinite);
  let steps = 0;
  for (let i = 1; i < apexes.length; i++) { const d = apexes[i - 1] - apexes[i]; if (d >= 0 && d <= 2) steps++; }
  const B_line = apexes.length > 1 ? steps / (apexes.length - 1) : 0;
  const score = 0.30 * A_approach + 0.25 * Math.min(1, A_asym) + 0.25 * G_gravity + 0.20 * B_line;
  return { score, A_approach, A_asym, G_gravity, B_line };
}

// Module 4 (v10): four-note motifs of contour and rhythm; exact or varied return.
function motifs(notes) {
  const out = [];
  for (let i = 0; i + 3 < notes.length; i++) {
    const c = [], d = [];
    for (let j = 0; j < 3; j++) c.push(Math.sign(notes[i + j + 1].p - notes[i + j].p));
    for (let j = 0; j < 4; j++) d.push(notes[i + j].dur);
    out.push({ i, c, d });
  }
  return out;
}
const eqAllButOne = (a, b) => a.filter((x, i) => x !== b[i]).length <= 1;
const returns = (m, n) => {
  const cE = m.c.join() === n.c.join(), dE = m.d.join() === n.d.join();
  return (cE && dE) || (cE && eqAllButOne(m.d, n.d)) || (dE && eqAllButOne(m.c, n.c));
};
export function horizon(hook, others) {
  const hm = motifs(hook);
  const covered = new Set();
  hm.forEach((m, k) => { if (hm.slice(0, Math.max(0, k - 3)).some((e) => returns(m, e))) for (let j = 0; j < 4; j++) covered.add(m.i + j); });
  const within = hook.length ? covered.size / hook.length : 0;
  let cross = 0, total = 0;
  others.forEach((sec) => {
    const om = motifs(sec);
    const cov = new Set();
    om.forEach((m) => { if (hm.some((e) => returns(m, e))) for (let j = 0; j < 4; j++) cov.add(m.i + j); });
    cross += cov.size; total += sec.length;
  });
  const crossR = total ? cross / total : within;
  return (within + crossR) / 2;
}

// 27.3: floor <= 2.5 bits full; one apex spike 2 bits over the floor full; stray spikes counted.
export function icScore(notes) {
  const bits = notes.map((n) => n.bits);
  const mean = bits.reduce((a, b) => a + b, 0) / bits.length;
  const sorted = [...bits].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.25)];
  const top = sorted[sorted.length - 1];
  const floorS = floor <= 2.5 ? 1 : Math.max(0, 1 - (floor - 2.5) / 2);
  const spikeS = Math.min(1, Math.max(0, (top - floor) / 2));
  const strays = bits.filter((b) => b >= floor + 2).length - 1;
  const strayS = Math.max(0, 1 - Math.max(0, strays - 2) / 6);
  return { score: 0.4 * floorS + 0.3 * spikeS + 0.3 * strayS, mean, strays: Math.max(0, strays) };
}

export function contourOf(ps) {
  if (ps.length < 4) return "flat";
  const k = Math.floor(ps.length / 3);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const a = avg(ps.slice(0, k)), b = avg(ps.slice(k, ps.length - k)), c = avg(ps.slice(ps.length - k));
  const range = Math.max(...ps) - Math.min(...ps);
  if (range <= 4 && Math.abs(a - c) < 1.5) return "flat";
  if (b - Math.max(a, c) >= 1.5) return "arch";
  if (a - c >= 2 && a >= b - 0.5) return "descending";
  if (c - a >= 2 && c >= b - 0.5) return "ascending";
  return "wave";
}

function median(a) { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// Table A for one section; returns the first death or null
function tableA(sec, role, brief) {
  const { voice, row } = brief;
  const ps = sec.notes.map((n) => n.p);
  if (ps.length < 4) return { rule: `${role}:length`, value: ps.length, bound: "≥ 4 notes" };
  const range = voice.ceil - voice.floor;
  const tess = (median(ps) - voice.floor) / range;
  const band = row[role].tess;
  if (tess < band[0] - 0.08 || tess > band[1] + 0.08) return { rule: `${role}:tessitura`, value: tess.toFixed(2), bound: `${band[0]}–${band[1]} ±0.08` };
  const peak = Math.max(...ps);
  const pass = peak > voice.brk ? "cross" : peak >= voice.brk - 2 ? "approach" : "below";
  const want = row[role].pass;
  const okPass = want === "above" ? median(ps) >= voice.brk - 2 : want === "cross" ? pass === "cross" : want === "approach" ? pass !== "cross" : pass !== "cross";
  if (!okPass) return { rule: `${role}:passaggio`, value: pass, bound: want };
  let maxLeap = 0;
  for (let i = 1; i < ps.length; i++) maxLeap = Math.max(maxLeap, Math.abs(ps[i] - ps[i - 1]));
  if (maxLeap > row.maxLeap) return { rule: `${role}:leap`, value: maxLeap, bound: `≤ ${row.maxLeap}` };
  const span = peak - Math.min(...ps);
  if (span > 14) return { rule: `${role}:range`, value: span, bound: "≤ 14" };
  const dens = ps.length / Math.max(1, sec.bars);
  if (dens < brief.density[0] || dens > brief.density[1]) return { rule: `${role}:density`, value: dens.toFixed(2), bound: `${brief.density[0]}–${brief.density[1]}` };
  const held = sec.notes.filter((n, i) => n.onset % 2 === 1 && n.dur >= 2 && !(i > 0 && sec.notes[i - 1].line !== n.line) && i !== 0).length;
  const sync = held / ps.length;
  if (sync < brief.sync[0] - 0.1 || sync > brief.sync[1] + 0.1) return { rule: `${role}:syncopation`, value: sync.toFixed(2), bound: `${brief.sync[0]}–${brief.sync[1]} ±0.10` };
  for (const l of sec.lines) {
    let run = 1;
    for (let i = 1; i < l.notes.length; i++) { run = l.notes[i].p === l.notes[i - 1].p ? run + 1 : 1; if (run > row.mono) return { rule: `${role}:monotony`, value: run, bound: `≤ ${row.mono} on one pitch` }; }
    if (l.notes.length >= 7 && new Set(l.notes.map((n) => n.p)).size < 3) return { rule: `${role}:monotony`, value: "2 pitches", bound: "≥ 3 distinct in a 7+ note phrase" };
  }
  if (role === "hook" && row.hookLeap) {
    const pk = sec.notes.findIndex((n) => n.peak);
    const i = pk > 0 ? pk : ps.indexOf(peak);
    const lp = i > 0 ? sec.notes[i].p - sec.notes[i - 1].p : 0;
    let big = 0; for (let j = 1; j < ps.length; j++) big = Math.max(big, ps[j] - ps[j - 1]);
    if (Math.max(lp, big) < row.hookLeap) return { rule: "hook:leap required", value: Math.max(lp, big), bound: `≥ ${row.hookLeap}` };
  }
  return null;
}

function fitScore(verse, hook, brief) {
  const { row, key } = brief;
  let s = 0, n = 0;
  const vc = contourOf(verse.notes.map((x) => x.p)), hc = contourOf(hook.notes.map((x) => x.p));
  s += row.verse.contour.includes(vc) ? 1 : 0; n++;
  s += row.hook.contour.includes(hc) ? 1 : 0; n++;
  const peak = hook.notes.find((x) => x.peak) || hook.notes.reduce((a, b) => (b.p > a.p ? b : a));
  const want = row.hookDegrees.map((d) => (d === 8 ? 1 : d));
  s += want.includes(degreeOf(peak.p, key)) ? 1 : 0; n++;
  const money = hook.notes.find((x) => x.money);
  if (money) {
    const beat = (money.onset % (brief.beatsPerBar * 2)) / 2;
    s += row.placement.includes(beat) ? 1 : 0; n++;
    s += [1, 3, 5].includes(degreeOf(money.p, key)) ? 1 : 0; n++;
  }
  return { score: s / n, verseContour: vc, hookContour: hc };
}

export function evaluate(cand, brief) {
  const cal = TABLE_B[brief.calibration];
  const secs = cand.sections.filter((s) => !s.repeat);
  if (secs.some((s) => s.unbuildable)) return { death: { rule: "unbuildable", stage: "generate", value: "a line could not be set", bound: "" } };
  const verse = secs.find((s) => s.kind === "verse") || secs[0];
  const hook = secs.find((s) => s.kind === "chorus") || secs.find((s) => s !== verse) || verse;
  for (const [sec, role] of [[verse, "verse"], [hook, "hook"]]) {
    const d = tableA(sec, role, brief);
    if (d) return { death: { ...d, stage: "constraint" } };
  }
  // spectral: first verse plus the first eight bars of the chorus
  const eight = brief.beatsPerBar * 2 * 8;
  const seq = [...verse.notes, ...hook.notes.filter((n) => n.onset < eight)].map((n) => n.p);
  const beta = betaPitch(seq);
  const c = cmp([...verse.notes, ...hook.notes], [...verse.lines, ...hook.lines], brief.key);
  const ic = icScore([...verse.notes, ...hook.notes]);
  const mh = horizon(hook.notes, secs.filter((s) => s !== hook).map((s) => s.notes));
  const m = { beta, S: sSpectral(beta), cmp: c.score, cmpParts: c, ic: ic.score, bits: ic.mean, spikes: ic.strays, mh };
  const die = (rule, value, bound) => ({ death: { rule, value, bound, stage: "rejection" }, m });
  if (beta !== null && (beta < cal.beta[0] || beta > cal.beta[1])) return die("spectral", beta.toFixed(2), `${cal.beta[0]}–${cal.beta[1]}`);
  if (m.cmp < cal.cmp) return die("CMP", m.cmp.toFixed(2), `≥ ${cal.cmp}`);
  if (m.ic < cal.ic) return die("IC_score", m.ic.toFixed(2), `≥ ${cal.ic}`);
  if (m.bits < cal.bits[0] || m.bits > cal.bits[1]) return die("mean_bits", m.bits.toFixed(2), `${cal.bits[0]}–${cal.bits[1]}`);
  if (m.spikes > cal.spikes) return die("stray_spikes", m.spikes, `≤ ${cal.spikes}`);
  if (m.mh < cal.mh) return die("M_horizon", m.mh.toFixed(2), `≥ ${cal.mh}`);
  const f = fitScore(verse, hook, brief);
  m.fit = f.score; m.verseContour = f.verseContour; m.hookContour = f.hookContour;
  const wsum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  m.composite = (WEIGHTS.spectral * m.S + WEIGHTS.cmp * Math.min(1, m.cmp / 0.6) + WEIGHTS.horizon * m.mh + WEIGHTS.fit * m.fit + WEIGHTS.ic * m.ic) / wsum;
  const all = [...verse.notes, ...hook.notes].map((n) => n.p);
  m.verseLift = median(hook.notes.map((n) => n.p)) - median(verse.notes.map((n) => n.p));
  m.range = Math.max(...all) - Math.min(...all);
  m.longestRun = Math.max(...secs.map((s) => { let best = 1, run = 1; for (let i = 1; i < s.notes.length; i++) { run = s.notes[i].p === s.notes[i - 1].p ? run + 1 : 1; best = Math.max(best, run); } return best; }));
  return { m };
}

// ---------- the search ----------
export async function search(brief, { n = 3000, seed = 1, onProgress, chunk = 150 } = {}) {
  const survivors = [];
  const deaths = new Map();
  const near = [];
  let built = 0, unbuildable = 0;
  for (let i = 0; i < n; i++) {
    const cand = buildCandidate(brief, seed, i);
    const res = evaluate(cand, brief);
    if (res.death) {
      if (res.death.rule === "unbuildable") unbuildable++; else built++;
      const k = res.death.rule;
      deaths.set(k, (deaths.get(k) || 0) + 1);
      if (res.death.stage === "rejection" && near.length < 5) near.push({ id: i, ...res.death });
    } else {
      built++;
      survivors.push({ id: i, cand, m: res.m });
    }
    if (onProgress && i % chunk === chunk - 1) { onProgress(i + 1, n, survivors.length); await new Promise((r) => setTimeout(r, 0)); }
  }
  survivors.sort((a, b) => b.m.composite - a.m.composite || a.id - b.id);
  const fingerprint = hashStr(survivors.slice(0, 50).map((s) => `${s.id}:${s.m.composite.toFixed(6)}`).join(",")).toString(16).padStart(8, "0");
  const rules = [...deaths.entries()].sort((a, b) => b[1] - a[1]);
  return {
    generated: n, built, unbuildable, survivors: survivors.length,
    rateBuilt: built ? survivors.length / built : 0, rateAll: survivors.length / n,
    deaths: rules, nearMisses: near, fingerprint,
    top: survivors.slice(0, 3).map((s, rank) => ({ rank: rank + 1, id: s.id, m: s.m, plan: s.cand.plan, sections: s.cand.sections })),
    seed, calibration: brief.calibration,
  };
}

// Rebuild a stored pick from its seed and id (the search is repeatable).
export function rebuild(brief, seed, id) { return buildCandidate(brief, seed, id); }
