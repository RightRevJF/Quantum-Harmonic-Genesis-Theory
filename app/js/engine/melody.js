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
  const m = t.match(/^([a-g])([#b])?\s*(maj(?:or)?|min(?:or)?|m)?\b/);
  if (!m) return { tonic: 7, mode: "major", name: "G major" };
  const tonic = PC[m[1] + (m[2] || "")];
  const mode = m[3] && (m[3] === "m" || m[3].startsWith("min")) ? "minor" : "major";
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
  // a comma (or dash) inside the line is a place the singer may breathe (Window 79's lead sheets cut phrases there)
  const segs = line.split(/[,;:—–]|\s-\s/);
  segs.forEach((seg, si) => {
    const before = out.length;
    tokenize(seg).forEach((w) => {
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
    if (si < segs.length - 1 && out.length > before) out[out.length - 1].comma = true;
  });
  // fix multi-syllable display: show the word on its first syllable, "-" continuation after
  out.forEach((s) => { if (s.of > 1) s.text = s.part === 0 ? s.word : "–"; });
  return out;
}

// ---------- rhythm from the words ----------
// Window 25: where real sung syllables land, by stress (shares of each class; the sixteenth
// share is folded out because this grid is eighths): stressed 31% strong beat, 21% other beat,
// 32% offbeat; unstressed 12%, 22%, 45%. Stressed syllables are barely longer than unstressed
// (0.49 against 0.44 beats): real singing is eighths nearly throughout, and length belongs to the
// title's held syllable. Table GK (fixes 885-887): a line's last note is a quarter at the median
// and the rest after it 1.25 / 2 / 4 beats (quartiles); the least breath is 1.5 beats.
const PLACE = { 1: { strong: 0.31 / 0.84, beat: 0.21 / 0.84, off: 0.32 / 0.84 }, 0: { strong: 0.09 / 0.76, beat: 0.22 / 0.76, off: 0.45 / 0.76 } };
const DUR_W = { 0: { 1: 0.8, 2: 0.2 }, 1: { 1: 0.62, 2: 0.33, 3: 0.05 } };
const LAST_W = { 1: 0.15, 2: 0.45, 3: 0.2, 4: 0.12, 6: 0.08 };
const REST_W = { 3: 0.18, 4: 0.3, 5: 0.12, 6: 0.12, 7: 0.06, 8: 0.14, 10: 0.05, 12: 0.03 };
// 27.20's rhythm vocabulary: each a legal reading of the words
export const STYLES = ["walk", "longshort", "anticipation", "late", "heldmiddle"];

function posClass(pos, barLen, bpb) {
  const p = pos % barLen;
  if (p === 0 || (bpb === 4 && p === barLen / 2)) return "strong";
  return p % 2 === 0 ? "beat" : "off";
}

function lineRhythm(syls, slot, r, opts = {}) {
  const bpb = opts.beatsPerBar || 4;
  const barLen = bpb * 2;
  const n = syls.length;
  const minBreath = slot - n >= 5 ? 3 : 2;
  const avail = slot - minBreath;
  if (n === 0 || n > avail) return null;
  const style = opts.style || "walk";
  const counts = { strong: 0, beat: 0, off: 0 };
  for (let q = 0; q < barLen; q++) counts[posClass(q, barLen, bpb)]++;
  const placeW = (i, pos) => {
    const st = syls[i].stress > 0 ? 1 : 0;
    const cls = posClass(pos, barLen, bpb);
    let w = PLACE[st][cls] / counts[cls];
    if (style === "anticipation" && st && cls === "off" && posClass(pos + 1, barLen, bpb) === "strong") w *= 3; // a stress pulled an eighth early (10.19)
    if (i === opts.money && opts.placement) w *= opts.placement.includes((pos % barLen) / 2) ? 6 : 0.15;
    return w;
  };
  const middle = Math.floor(n / 2);
  const durW = (i) => {
    if (i === opts.money) return { 3: 0.5, 4: 0.5 };
    if (i === n - 1) return LAST_W;
    const st = syls[i].stress > 0 ? 1 : 0;
    let w = { ...DUR_W[st] };
    if (style === "longshort" && st) w = { 1: 0.35, 2: 0.6, 3: 0.05 };
    if (style === "heldmiddle" && i === middle && st) w = { 2: 0.3, 3: 0.4, 4: 0.3 };
    return w;
  };
  const gapW = (i) => (syls[i].comma && i < n - 1 ? { 0: 0.35, 1: 0.35, 2: 0.3 } : { 0: 1 });
  const restW = (rest) => {
    if (rest < minBreath) return 0;
    const keys = Object.keys(REST_W).map(Number);
    const k = keys.reduce((a, b) => (Math.abs(b - rest) < Math.abs(a - rest) ? b : a));
    return REST_W[k] / (1 + Math.abs(k - rest));
  };
  const maxStart = Math.min(6, avail - n);
  const startW = (s0) => (style === "late" ? [0.1, 0.15, 0.25, 0.25, 0.15, 0.1, 0.05] : [0.3, 0.25, 0.2, 0.1, 0.08, 0.05, 0.02])[s0] || 0.01;
  // backward sums: B[i][pos] = total weight of placing syllables i.. from pos to the end of the slot
  const B = Array.from({ length: n + 1 }, () => new Float64Array(slot + 1));
  for (let pos = 0; pos <= slot; pos++) B[n][pos] = restW(slot - pos);
  for (let i = n - 1; i >= 0; i--) {
    for (let pos = 0; pos < slot; pos++) {
      let tot = 0;
      const pw = placeW(i, pos);
      for (const [d, wd] of Object.entries(durW(i))) for (const [g, wg] of Object.entries(gapW(i))) {
        const nx = pos + Number(d) + Number(g);
        if (nx > slot) continue;
        tot += pw * wd * wg * B[i + 1][nx];
      }
      B[i][pos] = tot;
    }
  }
  const draw = (items) => { const sum = items.reduce((a, x) => a + x[1], 0); if (!sum) return null; let x = r() * sum; for (const it of items) { x -= it[1]; if (x <= 0) return it[0]; } return items[items.length - 1][0]; };
  const s0 = draw(Array.from({ length: maxStart + 1 }, (_, k) => [k, startW(k) * B[0][k]]));
  if (s0 === null) return null;
  const notes = [];
  let pos = s0;
  for (let i = 0; i < n; i++) {
    const opts2 = [];
    const pw = placeW(i, pos);
    for (const [d, wd] of Object.entries(durW(i))) for (const [g, wg] of Object.entries(gapW(i))) {
      const nx = pos + Number(d) + Number(g);
      if (nx > slot) continue;
      const w = pw * wd * wg * B[i + 1][nx];
      if (w > 0) opts2.push([[Number(d), Number(g)], w]);
    }
    const pick2 = draw(opts2);
    if (!pick2) return null;
    notes.push({ syl: syls[i], onset: pos, dur: pick2[0] });
    pos += pick2[0] + pick2[1];
  }
  notes.style = style;
  return notes;
}

// 27.20 amended (v63): a repeated cell fitted to a new line BY STRESS. The cell's stressed
// onsets take the new line's stressed syllables in order; weak syllables share the onsets
// between; a weak run before the first stress is the pickup and after the last the tail.
// Refused when the stress counts differ by more than one or the weak syllables cannot fit.
function fitCell(cell, syls, slot, beatsPerBar) {
  const anchors = cell.filter((c) => c.syl.stress > 0).map((c) => c.onset);
  const sIdx = syls.map((x, i) => (x.stress > 0 ? i : -1)).filter((i) => i >= 0);
  if (!anchors.length || !sIdx.length || Math.abs(anchors.length - sIdx.length) > 1) return null;
  let A = anchors.slice(0, sIdx.length);
  if (sIdx.length > anchors.length) {
    // one more stress: split the longest gap on a beat
    let best = -1, gap = 0;
    for (let k = 0; k + 1 < A.length; k++) if (A[k + 1] - A[k] > gap) { gap = A[k + 1] - A[k]; best = k; }
    if (best < 0 || gap < 4) return null;
    let mid = A[best] + Math.floor(gap / 2); if (mid % 2) mid--;
    A.splice(best + 1, 0, mid);
  }
  // room for the pickup: the cell moves later by whole beats if the weak run needs it
  const pick = sIdx[0];
  if (A[0] < pick) { const sh = Math.ceil((pick - A[0]) / 2) * 2; A = A.map((x) => x + sh); }
  // room between stresses: a span too short for its weak syllables pushes the rest of the cell on
  for (let k = 0; k + 1 < sIdx.length; k++) {
    const weak = sIdx[k + 1] - sIdx[k] - 1;
    const need = weak + 1 - (A[k + 1] - A[k]);
    if (need > 0) for (let j = k + 1; j < A.length; j++) A[j] += need;
  }
  const onsets = new Array(syls.length).fill(null);
  sIdx.forEach((si, k) => { onsets[si] = A[k]; });
  for (let i = pick - 1, t = A[0] - 1; i >= 0; i--, t--) onsets[i] = t;
  for (let k = 0; k + 1 < sIdx.length; k++) {
    const a = sIdx[k], z = sIdx[k + 1], weak = z - a - 1;
    const span = A[k + 1] - A[k];
    for (let j = 1; j <= weak; j++) onsets[a + j] = A[k] + Math.max(j, Math.round((span * j) / (weak + 1)));
  }
  const last = sIdx[sIdx.length - 1];
  for (let i = last + 1, t = A[A.length - 1] + 1; i < syls.length; i++, t++) onsets[i] = t;
  // the line must leave a breath before the slot ends: slide the whole cell earlier if it can
  const endMax = slot - 3;
  let over = onsets[onsets.length - 1] + 1 - endMax;
  if (over > 0) { const room = onsets[0]; if (room >= over) { for (let i = 0; i < onsets.length; i++) onsets[i] -= over; } else return null; }
  for (let i = 1; i < onsets.length; i++) if (onsets[i] <= onsets[i - 1]) return null;
  if (onsets[0] < 0) return null;
  const lastLen = cell[cell.length - 1].dur;
  return syls.map((syl, i) => ({ syl, onset: onsets[i], dur: i < syls.length - 1 ? Math.min(4, onsets[i + 1] - onsets[i]) : Math.max(1, Math.min(lastLen, endMax + 1 - onsets[i])) }));
}

function onsetSimilarity(a, b) {
  const A = new Set(a.map((x) => x.onset)), Bs = new Set(b.map((x) => x.onset));
  const inter = [...A].filter((x) => Bs.has(x)).length;
  return (2 * inter) / (A.size + Bs.size || 1);
}

// 27.20: section forms, drawn from the corpus family's priors (pop: free ABCD 27%, then ABAC,
// AAAA, AABC, AAAB, ABAB; the folk and hymn corpora lean to AAAA).
const FORM_PRIORS = {
  pop: [["ABCD", 0.27], ["ABAC", 0.105], ["AAAA", 0.1], ["AABC", 0.096], ["AAAB", 0.088], ["ABAB", 0.084]],
  folk: [["AAAA", 0.3], ["ABAB", 0.15], ["AABC", 0.15], ["ABAC", 0.15], ["AAAB", 0.1], ["ABCD", 0.15]],
};
export function drawForm(r, family) {
  const pri = FORM_PRIORS[family] || FORM_PRIORS.pop;
  const sum = pri.reduce((a, x) => a + x[1], 0);
  let x = r() * sum;
  for (const [f, w] of pri) { x -= w; if (x <= 0) return f; }
  return pri[0][0];
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
    if (endLine && !ctx.endWant && [1, 3, 5].includes(degreeOf(p, key))) w *= 2;
    // 27.20: the answered pair - the line before the midpoint ends open, the closing line on the tonic
    if (ctx.endWant === "open") w *= [2, 5, 7].includes(degreeOf(p, key)) ? 5 : 0.25;
    if (ctx.endWant === "tonic") w *= degreeOf(p, key) === 1 && (ctx.ceiling === undefined || p <= ctx.ceiling) ? 10 : 0.05;
    // a repeated cell keeps its opening direction (Schoenberg's basic idea heard again)
    if (ctx.dirWant !== undefined && ctx.dirWant !== 0 && prev !== null) w *= Math.sign(iv) === ctx.dirWant ? 4 : 0.25;
    // Window 25: up early, then down through the line
    if (ctx.frac !== undefined && prev !== null && iv !== 0) w *= ctx.frac <= 0.2 ? (iv > 0 ? 1.8 : 0.6) : ctx.frac >= 0.35 ? (iv < 0 ? 1.4 : 0.75) : 1;
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
function buildSection(sec, plan, r, brief, ref, refMode = null) {
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
  const form = plan.forms[sec.kind] || plan.forms.verse;
  const titleNorm = brief.titleNorm;
  const nLines = sec.lines.length;
  const closing = sec.kind === "chorus"; // a closing role: the chorus's last line comes home
  let titleTop = null;
  sec.lines.forEach((ln, li) => {
    const syls = syllabify(ln.text);
    if (!syls.length) return;
    // a line gets more bars when its syllables would crowd the type's density ceiling (design consequence, reported)
    const needBars = Math.ceil(syls.length / (brief.density[1] * 0.9));
    let lslot = Math.max(slot, needBars * barLen);
    if (syls.length + 3 > lslot) lslot += barLen;
    if (lslot > slot) section.grown = Math.max(section.grown || 0, lslot / barLen);
    // title-first: find the title in this line
    let peak = -1, money = -1;
    const words = syls.map((x) => x.word).join(" ");
    const isTitle = role === "hook" && titleNorm && ` ${words} `.includes(` ${titleNorm} `);
    if (isTitle) {
      const tw = titleNorm.split(" ");
      const start = words.split(" ").findIndex((_, i, arr) => arr.slice(i, i + tw.length).join(" ") === titleNorm);
      let wi = -1; const idx = [];
      syls.forEach((x, i) => { if (x.part === 0) wi++; if (wi >= start && wi < start + tw.length) idx.push(i); });
      peak = idx.find((i) => syls[i].stress > 0 && !syls[i].reduced) ?? idx[0];
      const stressed = idx.filter((i) => syls[i].stress > 0);
      money = stressed.length ? stressed[stressed.length - 1] : idx[idx.length - 1];
    }
    // the plan: this line's letter; the same words again are an exact repeat (only the title's words recur exactly)
    const refLine = ref && ref.lines[li] ? ref.lines[li] : null;
    if (refMode === "return" && refLine && refLine.words === words) {
      // the returning section's unchanged line: its notes exactly, turns and all
      const copied = refLine.notes.map((n) => ({ ...n, onset: n.onset - refLine.start + t, line: li }));
      section.lines.push({ ...refLine, notes: copied, start: t, slot: refLine.slot, how: "repeat", fixed: true });
      section.notes.push(...copied);
      if (copied.length) { prev = copied[copied.length - 1].p; prev2 = copied.length > 1 ? copied[copied.length - 2].p : prev; }
      if (refLine.notes.some((n) => n.peak)) titleTop = Math.max(titleTop ?? 0, ...refLine.notes.filter((n) => n.peak).map((n) => n.p));
      t += refLine.slot;
      return;
    }
    const same = section.lines.find((x) => x.words === words);
    const letter = same ? same.letter : refMode === "return" && refLine ? refLine.letter : form[li % form.length];
    const source = same || (refMode === "return" && refLine) || section.lines.find((x) => x.letter === letter) || refLine || null;
    const follow = refMode === "return" && refLine && !same ? refLine : null;
    let rh = null, how = "new";
    if (same) { rh = same.rhythm.map((x, i) => ({ ...x, syl: syls[i] })); how = "repeat"; }
    else if (source && (!isTitle || follow)) { rh = fitCell(source.rhythm, syls, lslot, brief.beatsPerBar); how = rh ? (follow ? "follows" : "fitted") : "refused"; }
    if (!rh) {
      // a new letter's rhythm from the vocabulary; a placement that clusters with a built cell gives way
      const built = section.lines.map((x) => x.rhythm);
      let tries = 0;
      do {
        const style = isTitle ? "walk" : STYLES[Math.floor(r() * STYLES.length)];
        rh = lineRhythm(syls, lslot, r, { money: isTitle ? money : -1, placement: isTitle ? row.placement : null, beatsPerBar: brief.beatsPerBar, style });
        tries++;
      } while (rh && tries < 4 && !source && built.some((b) => onsetSimilarity(b, rh) >= 0.8));
    }
    if (!rh) { section.unbuildable = true; return; }
    // the answered pair (27.20 §2): the line before the midpoint ends open; a closing role's last line on the tonic
    const endWant = li === Math.ceil(nLines / 2) - 1 && nLines >= 4 ? "open" : closing && li === nLines - 1 ? "tonic" : null;
    const dirs = source && how !== "repeat" ? source.dirs : null;
    const lineNotes = [];
    rh.forEach((n, i) => {
      const onset = t + n.onset;
      const chord = chordAt(section, onset, key);
      const strong = onset % 2 === 0;
      const frac = rh.length > 1 ? i / (rh.length - 1) : 0;
      // Window 25: the line peaks early (17% of the way in) and descends; the last word held low
      const contour = frac < 0.2 ? 3 : 3 - 4.5 * ((frac - 0.2) / 0.8);
      let res;
      if (how === "repeat") {
        res = { p: same.notes[i] ? same.notes[i].p : prev, bits: 1 };
      } else if (follow && follow.notes.length) {
        // the same melody under new words: each note near the first time's, refit to the chord on strong beats
        const fn = follow.notes.filter((x) => !x.melisma);
        const target = fn[Math.min(fn.length - 1, Math.round((i * (fn.length - 1)) / Math.max(1, rh.length - 1)))].p;
        const pc = (p) => ((p - key.tonic) % 12 + 12) % 12;
        const near = cands.filter((p) => Math.abs(p - target) <= 2 && (prev === null || Math.abs(p - prev) <= row.maxLeap) && !(run >= row.mono && p === prev));
        const fit = strong ? near.filter((p) => chord.tones.includes(pc(p))) : near;
        const pool = fit.length ? fit : near.length ? near : cands.filter((p) => prev === null || Math.abs(p - prev) <= row.maxLeap);
        const pp = (pool.length ? pool : cands).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
        res = { p: pp, bits: 1 + (pp === target ? 0 : 1) };
      } else if (isTitle && i === peak) {
        // the high note on the peak syllable, top of the hook tessitura, on a hook degree
        const topT = voice.floor + range * row.hook.tess[1];
        const want = row.hookDegrees.map((d) => (d === 8 ? 1 : d));
        let optsP = cands.filter((p) => want.includes(degreeOf(p, key)) && p <= topT + 2 && p >= topT - 5);
        if (row.hook.pass === "cross") { const above = cands.filter((p) => want.includes(degreeOf(p, key)) && p > voice.brk); if (above.length) optsP = above; }
        const leapy = plan.leapRule;
        const pool = optsP.filter((p) => prev === null || (Math.abs(p - prev) <= row.maxLeap && (!leapy || p - prev >= Math.max(5, row.hookLeap))));
        const pp = pool.length ? pick(r, pool) : optsP.length ? pick(r, optsP) : choosePitch(r, { prev, prev2, cands, chord, strong, center: topT, sd, maxLeap: row.maxLeap, key }).p;
        res = { p: pp, bits: 4.5 };
        titleTop = Math.max(titleTop ?? 0, pp);
      } else if (isTitle && i === money) {
        // the money syllable: a stable degree at or below the current pitch, held
        const stable = cands.filter((p) => [1, 3, 5].includes(degreeOf(p, key)) && (prev === null || (p <= prev && prev - p <= row.maxLeap)));
        const pp = stable.length ? stable.reduce((a, b) => (Math.abs(b - (prev ?? center)) < Math.abs(a - (prev ?? center)) ? b : a)) : prev ?? center;
        res = { p: pp, bits: 1.5 };
      } else {
        const bias = isTitle && peak >= 0 && i > peak ? 0.8 : 0;
        const last = i === rh.length - 1;
        res = choosePitch(r, { prev, prev2, cands, chord, strong, center: center + (offsets[letter.toLowerCase()] || 0) + contour, sd, maxLeap: row.maxLeap, endLine: last, key, bias, run, runLimit: row.mono,
          endWant: last && !(isTitle && i === money) ? endWant : null, ceiling: titleTop ?? undefined, dirWant: dirs && (i === 1 || i === 2) ? dirs[i - 1] : undefined, frac });
      }
      if (!res) { section.unbuildable = true; return; }
      const ivNow = prev === null ? 0 : res.p - prev;
      const ivPrev = prev === null || prev2 === null ? 0 : prev - prev2;
      const note = { p: res.p, bits: prev === null ? 3 : refBits(ivPrev, ivNow), onset, dur: n.dur, syl: n.syl.text, word: n.syl.word, part: n.syl.part, of: n.syl.of, stress: n.syl.stress, reduced: n.syl.reduced, chord: chord.roman, line: li, peak: isTitle && i === peak, money: isTitle && i === money };
      lineNotes.push(note);
      run = prev === res.p ? run + 1 : 1;
      prev2 = prev; prev = res.p;
    });
    const dirsOut = lineNotes.length > 2 ? [Math.sign(lineNotes[1].p - lineNotes[0].p), Math.sign(lineNotes[2].p - lineNotes[1].p)] : [0, 0];
    section.lines.push({ letter, how, words, rhythm: rh.map((x) => ({ syl: x.syl, onset: x.onset, dur: x.dur })), dirs: dirsOut, notes: lineNotes, text: ln.text, start: t, slot: lslot });
    section.notes.push(...lineNotes);
    t += lslot;
  });
  section.form = section.lines.map((l) => l.letter).join("");
  if (sec.kind === "chorus") addMelisma(section, r, key, cands);
  section.length = t;
  section.bars = Math.ceil(t / barLen);
  return section;
}

// 27.12 / Table G: after the hook is written one note per syllable, held lyric-bearing notes
// receive a two-note turn at the corpus rates (0.17 at line ends, 0.12 inside a line), a step
// down three times in four. The second note carries no syllable and is slurred in every document.
// The title's held note and the chorus's last word keep their one note (Rule C2's held word).
export function addMelisma(section, r, key, cands) {
  const lastLine = section.lines.length - 1;
  section.lines.forEach((l, li) => {
    if (l.fixed) return; // a copied line keeps its own turns
    const out = [];
    l.notes.forEach((n, i) => {
      const lineEnd = i === l.notes.length - 1;
      // a note a quarter or longer can carry the turn; the rates are set so the hook's share of
      // syllables with two notes lands near Table G's 0.12 overall and 0.17 at line ends
      const eligible = n.dur >= 2 && !n.money && !(li === lastLine && lineEnd) && !n.melisma;
      const rate = lineEnd ? 0.34 : 0.3;
      if (eligible && r() < rate) {
        const idx = cands.indexOf(n.p);
        const down = r() < 0.75;
        const p2 = idx < 0 ? n.p : down ? cands[Math.max(0, idx - 1)] : cands[Math.min(cands.length - 1, idx + 1)];
        if (p2 !== n.p) {
          const second = n.dur >= 4 ? 2 : 1; if (n.dur - second < 1) { out.push(n); return; }
          out.push({ ...n, dur: n.dur - second, slurStart: true });
          out.push({ ...n, p: p2, onset: n.onset + n.dur - second, dur: second, melisma: true, slurEnd: true, stress: 0, peak: false, money: false });
          return;
        }
      }
      out.push(n);
    });
    l.notes = out;
  });
  section.notes = section.lines.flatMap((l) => l.notes);
}

const FORMS = [["a", "a'", "b", "c"], ["a", "b", "a'", "c"], ["a", "a'", "b", "a'"], ["a", "b", "a", "b'"], ["a", "a'", "b", "b'"]];

// The section's loop: the chosen harmony's, or the nearest kind's.
export function loopFor(loops, kind) {
  return loops[kind] || (kind === "chorus" ? loops.hook : null) || (kind === "prechorus" || kind === "bridge" ? loops.verse : null) || loops.verse || loops.chorus;
}

export function makeBrief(song, lyricText) {
  const c = song.contract || {};
  const key = parseKey(c.key);
  // the contract's voice row; an older free-text voice is read with the key note beside it ("clear female voice")
  const vname = VOICES[c.voice] ? c.voice : voiceRow(`${c.voice || ""} ${c.voiceChar || ""} ${c.key || ""}`, (song.type || "").split("/")[0]);
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
  const family = brief.calibration === "folk" || brief.calibration === "hymn" ? "folk" : "pop";
  const forms = { verse: drawForm(r, family), prechorus: drawForm(r, family), chorus: drawForm(r, family), bridge: "ABCD" };
  const plan = { loop, loopIndex: brief.harmony ? null : idx % 8, forms, form: forms.chorus.split(""), leapRule: r() < 0.5 };
  const built = new Map();
  const out = [];
  const lastChorus = brief.sections.map((s) => s.kind).lastIndexOf("chorus");
  brief.sections.forEach((s, si) => {
    const keyName = s.kind + ":" + s.lines.map((l) => l.text).join("|");
    if (built.has(keyName)) { out.push({ ...built.get(keyName), name: s.name, repeat: true }); return; }
    // a section that returns: verses keep the stanza principle (the first verse's cells under new
    // pitches); a chorus, pre-chorus or bridge that returns with some words changed keeps its melody
    // (Rule C4: the same melody each time, the final chorus the inversion)
    const sameKind = out.find((x) => x.kind === s.kind && !x.repeat && !x.unbuildable);
    const sec = buildSection(s, { ...plan, last: si === lastChorus }, r, brief, sameKind || null, sameKind ? (s.kind === "verse" ? "stanza" : "return") : null);
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
