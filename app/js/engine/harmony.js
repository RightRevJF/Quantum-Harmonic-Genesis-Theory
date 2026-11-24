// Checkpoint (b): the harmonic skeleton and the departure map.
//
// The Departure Unit (Window 19.9): one borrowed chord = 1 DU; deceptive cadence,
// secondary dominant, parallel-minor lift = 2; tritone substitution, chromatic
// mediant, modulation to a non-parallel key = 3. Budgets and per-moment ceilings by
// type (19.9 §3), the schema discount (19.10), the chorus changing the loop
// (Window 28), and the harmonic-expectation score (Window 46, Cheung et al. 2019).

import { rng } from "./melody-rng.js";

// ---------- chords ----------
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const NUM = { I: 0, II: 1, III: 2, IV: 3, V: 4, VI: 5, VII: 6 };
const RX = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°|o|dim|\+)?(maj7|7)?(?:\/(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i))?$/;

export function parseChord(sym, mode = "major") {
  const s = String(sym).trim().replace("♭", "b").replace("♯", "#");
  const m = s.match(RX);
  if (!m) return null;
  const [, acc, num, dim, sev, tacc, tnum] = m;
  const minor = num === num.toLowerCase();
  const deg = NUM[num.toUpperCase()];
  const scale = mode === "minor" ? MINOR : MAJOR;
  let root;
  let secondary = null;
  if (tnum) {
    // applied chord: V/x, vii°/x - built on the target's own scale step
    const tdeg = NUM[tnum.toUpperCase()];
    const troot = (scale[tdeg] + (tacc === "b" ? -1 : tacc === "#" ? 1 : 0) + 12) % 12;
    root = (troot + MAJOR[deg]) % 12;
    secondary = tnum;
  } else if (acc) {
    root = (MAJOR[deg] + (acc === "b" ? -1 : 1) + 12) % 12;
  } else {
    root = scale[deg];
  }
  const isDim = Boolean(dim && dim !== "+");
  const third = (root + (minor || isDim ? 3 : 4)) % 12;
  const fifth = (root + (isDim ? 6 : dim === "+" ? 8 : 7)) % 12;
  const tones = [root, third, fifth];
  if (sev === "7") tones.push((root + (isDim ? 9 : minor ? 10 : 10)) % 12);
  if (sev === "maj7") tones.push((root + 11) % 12);
  return { sym: s, root, tones, minor, dim: isDim, seventh: sev || "", secondary, accidental: acc || "" };
}

const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const FLAT_KEYS = { major: [5, 10, 3, 8, 1, 6], minor: [2, 7, 0, 5, 10, 3] };
export function chordName(sym, key) {
  const c = parseChord(sym, key.mode);
  if (!c) return sym;
  const names = FLAT_KEYS[key.mode].includes(key.tonic) || c.accidental === "b" ? FLAT : SHARP;
  const root = names[(key.tonic + c.root) % 12];
  const q = c.dim ? "°" : c.minor ? "m" : "";
  return `${root}${q}${c.seventh === "maj7" ? "maj7" : c.seventh}`;
}

// ---------- DU cost of a chord (Window 19.9's harmonic column) ----------
// Diatonic in the modal home = 0. Borrowed from the parallel mode = 1.
// Secondary dominant = 2. Chromatic mediant / tritone sub / remote = 3.
function diatonicSet(mode) {
  const sc = mode === "minor" ? MINOR : MAJOR;
  const qual = mode === "minor" ? ["m", "dim", "M", "m", "m", "M", "M"] : ["M", "m", "m", "M", "M", "m", "dim"];
  return sc.map((r, i) => ({ root: r, q: qual[i] }));
}
const qOf = (c) => (c.dim ? "dim" : c.minor ? "m" : "M");

export function chordDU(sym, mode) {
  const c = parseChord(sym, mode);
  if (!c) return { du: 0, kind: "unknown" };
  if (c.secondary) return { du: 2, kind: "secondary dominant" };
  const dia = diatonicSet(mode);
  const scale = mode === "minor" ? [...MINOR, 11] : MAJOR;
  const outside = c.tones.filter((t) => !scale.includes(t));
  if (dia.some((d) => d.root === c.root && d.q === qOf(c))) {
    if (outside.length) return { du: 1, kind: "dominant seventh outside the key" };
    return { du: 0, kind: "diatonic" };
  }
  // in minor, the major V (and vii°) are the harmonic-minor home, not a departure
  if (mode === "minor" && ((c.root === 7 && qOf(c) === "M") || (c.root === 11 && c.dim))) return { du: 0, kind: "diatonic (harmonic minor)" };
  const par = diatonicSet(mode === "minor" ? "major" : "minor");
  if (par.some((d) => d.root === c.root && d.q === qOf(c))) return { du: 1, kind: "borrowed from the parallel " + (mode === "minor" ? "major" : "minor") };
  if (c.root === 6 || c.root === 1) return { du: 3, kind: "tritone or remote" };
  return { du: 3, kind: "chromatic mediant" };
}

// ---------- budgets (19.9 §3) and the schema discount (19.10) ----------
export const BUDGET = {
  "W-contemplative": { total: 4, ceiling: 2, name: "Contemplative Worship" },
  G: { total: 5, ceiling: 2, name: "Groove" },
  "W-enthronement": { total: 5, ceiling: 2, name: "Enthronement Worship" },
  L: { total: 6, ceiling: 2, name: "Lament" },
  W: { total: 6, ceiling: 3, name: "Praise / Thanksgiving Worship" },
  B: { total: 6, ceiling: 3, name: "Blues" },
  V: { total: 7, ceiling: 3, name: "Love Song" },
  T: { total: 7, ceiling: 3, name: "Testimony / Gospel" },
  A: { total: 8, ceiling: 3, name: "Anthem" },
  N: { total: 8, ceiling: 4, name: "Narrative" },
  P: { total: 9, ceiling: 4, name: "Paradox" },
};
// Types 19.9 does not list are read against the nearest row, and the app says so.
const NEAREST = { LR: "L", LD: "L", M: "W-contemplative", PR: "A" };
export function budgetFor(type) {
  const base = (type || "P").split("/")[0];
  const key = BUDGET[base] ? base : NEAREST[base] || "P";
  return { ...BUDGET[key], row: key, note: key !== base ? `19.9 has no ${base} row; read against ${BUDGET[key].name}.` : "" };
}

// Harmonic schema discount: 1 DU off schema-native harmonic moves.
function discounted(sym, du, type, mode) {
  const base = (type || "").split("/")[0];
  const c = parseChord(sym, mode);
  if (!c || du === 0) return du;
  if (["L", "LR", "LD"].includes(base)) {
    // Aeolian schema moves (i, bVII, bVI, V) are native
    if (["bVII", "bVI", "bIII", "iv"].includes(sym.replace(/7$/, ""))) return Math.max(0, du - 1);
  }
  if (base === "B" && c.seventh === "7" && [0, 5, 7].includes(c.root)) return 0; // I7, IV7, V7 in the form
  if (base === "P" && mode === "minor") return Math.max(0, du - 1);
  return du;
}

// ---------- the harmony model: loops of Window 28 plus the carrier ----------
// The commonest loops the window lists (POP909 and McGill), with the Lite Edition's
// I-V-vi-IV carrier. Every loop is four chords, one per bar.
export const LOOP_BANK = {
  major: {
    verse: [["I", "vi", "IV", "ii"], ["I", "vi", "IV", "I"], ["IV", "iii", "ii", "I"], ["I", "vi", "IV", "V"], ["I", "I", "IV", "IV"], ["I", "IV", "I", "IV"], ["IV", "IV", "I", "I"], ["I", "I", "vi", "vi"], ["I", "V", "vi", "IV"], ["vi", "IV", "I", "V"], ["I", "iii", "IV", "V"]],
    prechorus: [["IV", "V", "IV", "V"], ["ii", "IV", "V", "V"], ["vi", "IV", "ii", "V"], ["IV", "IV", "V", "V"], ["ii", "iii", "IV", "V"], ["vi", "V", "IV", "V"]],
    chorus: [["I", "vi", "IV", "ii"], ["IV", "iii", "ii", "V"], ["I", "vi", "ii", "V"], ["I", "IV", "I", "IV"], ["IV", "IV", "I", "I"], ["I", "I", "IV", "IV"], ["IV", "I", "IV", "I"], ["I", "V", "vi", "IV"], ["IV", "I", "V", "vi"], ["vi", "IV", "I", "V"], ["IV", "V", "iii", "vi"]],
    bridge: [["vi", "IV", "I", "V"], ["IV", "V", "vi", "vi"], ["ii", "V", "iii", "vi"], ["vi", "V", "IV", "IV"], ["IV", "IV", "V", "V"], ["iii", "vi", "IV", "V"]],
  },
  minor: {
    verse: [["VI", "i", "VI", "i"], ["i", "VII", "VI", "III"], ["i", "VI", "VII", "i"], ["i", "VII", "i", "VII"], ["i", "i", "i", "VI"], ["i", "i", "VII", "VII"], ["i", "iv", "VI", "V"], ["i", "VI", "III", "VII"]],
    prechorus: [["iv", "V", "iv", "V"], ["VI", "VII", "VI", "VII"], ["iv", "VI", "V", "V"], ["VI", "iv", "V", "V"]],
    chorus: [["i", "v", "VI", "VII"], ["VI", "i", "VI", "i"], ["i", "v", "VI", "III"], ["i", "VII", "VI", "V"], ["i", "VI", "i", "VI"], ["i", "i", "VII", "VII"], ["VI", "VII", "i", "i"], ["III", "VII", "VI", "VII"]],
    bridge: [["VI", "VII", "III", "III"], ["iv", "VI", "V", "V"], ["III", "VII", "i", "VI"], ["VI", "iv", "VII", "V"]],
  },
};

// Blues (Module 21): the twelve-bar form with the dominant-seventh tonic.
export const BLUES_BANK = {
  verse: [["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"], ["I7", "IV7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "I7"]],
  chorus: [["IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"], ["I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "V7"]],
  prechorus: [["IV7", "IV7", "V7", "V7"]],
  bridge: [["IV7", "IV7", "I7", "I7", "IV7", "IV7", "V7", "V7"]],
};

// Spice: moves the search may write into a loop to spend departure units where they belong.
const SPICE = {
  major: [
    { sym: "bVII", note: "borrowed ♭VII" }, { sym: "iv", note: "borrowed minor iv" }, { sym: "bVI", note: "borrowed ♭VI" },
    { sym: "V/vi", note: "secondary dominant V/vi" }, { sym: "V/V", note: "secondary dominant V/V" }, { sym: "V/ii", note: "secondary dominant V/ii" },
  ],
  minor: [
    { sym: "IV", note: "borrowed major IV (Dorian colour)" }, { sym: "V/iv", note: "secondary dominant V/iv" }, { sym: "bII", note: "Neapolitan ♭II" },
  ],
};

// First-order chord model over the bank (each loop read cyclically).
function buildModel(mode, bank = LOOP_BANK[mode]) {
  const counts = new Map();
  const add = (a, b) => { if (!counts.has(a)) counts.set(a, new Map()); const m = counts.get(a); m.set(b, (m.get(b) || 0) + 1); };
  Object.values(bank).flat().forEach((loop) => loop.forEach((c, i) => add(c, loop[(i + 1) % loop.length])));
  const vocab = new Set([...counts.keys(), ...[...counts.values()].flatMap((m) => [...m.keys()])]);
  SPICE[mode].forEach((s) => vocab.add(s.sym));
  return { counts, vocab: [...vocab] };
}
// The blues bank is defined below the model code, so its model is built lazily.
const MODELS = { major: buildModel("major"), minor: buildModel("minor") };
function model(key) { if (!MODELS[key]) MODELS[key] = buildModel("major", BLUES_BANK); return MODELS[key]; }

function predictive(prev, mode) {
  const { counts, vocab } = model(mode);
  const m = counts.get(prev) || new Map();
  const alpha = 0.3; // additive smoothing so unseen chords are possible, not free
  const total = [...m.values()].reduce((a, b) => a + b, 0) + alpha * vocab.length;
  const dist = new Map(vocab.map((v) => [v, ((m.get(v) || 0) + alpha) / total]));
  return dist;
}
const H = (dist) => [...dist.values()].reduce((a, p) => a - p * Math.log2(p), 0);

// Median splits for the quadrants, computed on this model over the bank (the spec's
// 2.355 / 1.657 bits are medians of its own corpus model; the method is the same).
function medians(mode) {
  const hs = [], ics = [];
  Object.values(mode === "blues" ? BLUES_BANK : LOOP_BANK[mode]).flat().forEach((loop) => loop.forEach((c, i) => {
    const d = predictive(loop[(i + loop.length - 1) % loop.length], mode);
    hs.push(H(d)); ics.push(-Math.log2(d.get(c)));
  }));
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { h: med(hs), ic: med(ics) };
}
const MED = { major: medians("major"), minor: medians("minor") };
const med = (key) => (MED[key] = MED[key] || medians(key));

// Window 46: score a loop on its second pass. Quadrant weights 1.0 (surprise in a clear
// context), 0.7 (uncertainty resolved), 0.5 (predictable in a clear context), 0.0 (surprise in confusion).
export function expectation(loop, mode) {
  const md = med(mode);
  const rows = loop.map((c, i) => {
    const prev = loop[(i + loop.length - 1) % loop.length];
    const d = predictive(prev, mode);
    const h = H(d), ic = -Math.log2(d.get(c) || 1e-4);
    const clear = h <= md.h, surprise = ic > md.ic;
    const quad = clear && surprise ? "surprise, clear" : !clear && !surprise ? "uncertainty resolved" : clear ? "predictable, clear" : "surprise in confusion";
    const w = { "surprise, clear": 1.0, "uncertainty resolved": 0.7, "predictable, clear": 0.5, "surprise in confusion": 0.0 }[quad];
    return { chord: c, h, ic, quad, w };
  });
  return { score: rows.reduce((a, r) => a + r.w, 0) / rows.length, rows };
}

// ---------- form ----------
const KIND = { V: "verse", PC: "prechorus", C: "chorus", B: "bridge", I: "intro", O: "outro", T: "tag", R: "chorus", H: "chorus" };
export function formKinds(formText = "", sections = null) {
  if (sections && sections.length) return [...new Set(sections.map((s) => s.kind))].filter((k) => ["verse", "prechorus", "chorus", "bridge"].includes(k));
  const parts = formText.toUpperCase().split(/[^A-Z]+/).filter(Boolean).map((p) => KIND[p.replace(/\d+$/, "")] || null).filter(Boolean);
  const kinds = [...new Set(parts)].filter((k) => ["verse", "prechorus", "chorus", "bridge"].includes(k));
  return kinds.length ? kinds : ["verse", "chorus", "bridge"];
}

// ---------- the ledger ----------
// Each section's loop is one phrase-pair; a phrase is two bars. Harmonic DU per phrase is
// the sum of its chords' costs (after the discount); a V-vi at the end of a loop is a
// deceptive cadence (2 DU). Repeats of a section are not recharged in the song total.
export function harmonicLedger(skel, type, mode) {
  const sections = {};
  let total = 0, peak = { du: 0, at: "" };
  for (const [kind, loop] of Object.entries(skel)) {
    if (!loop || !loop.length) continue;
    const chords = loop.map((sym, i) => {
      let { du, kind: why } = chordDU(sym, mode);
      if (i > 0 && /^V7?$/.test(loop[i - 1]) && sym === (mode === "minor" ? "VI" : "vi") && i === loop.length - 1) { du = Math.max(du, 2); why = "deceptive cadence"; }
      const net = discounted(sym, du, type, mode);
      return { sym, du: net, raw: du, why: net < du ? `${why} (schema discount)` : why };
    });
    const phrases = [];
    for (let i = 0; i < chords.length; i += 2) phrases.push(chords.slice(i, i + 2).reduce((a, c) => a + c.du, 0));
    const sectionDU = chords.reduce((a, c) => a + c.du, 0);
    const maxPhrase = Math.max(...phrases);
    sections[kind] = { chords, phrases, du: sectionDU, maxPhrase };
    total += sectionDU;
    if (maxPhrase > peak.du) peak = { du: maxPhrase, at: kind };
  }
  // Lament / Paradox schema boundary: a full cadence to the tonic at the chorus's end costs 2 DU.
  const base = (type || "").split("/")[0];
  if ((["L", "LR", "LD"].includes(base) || base === "P") && skel.chorus) {
    const ch = skel.chorus, n = ch.length;
    const tonic = mode === "minor" ? "i" : "I";
    if (/^V7?$/.test(ch[n - 2]) && ch[n - 1] === tonic) {
      sections.chorus.du += 2; total += 2;
      sections.chorus.chords[n - 1].du += 2; sections.chorus.chords[n - 1].why = "full cadence to the tonic: breaks the schema";
      sections.chorus.phrases[sections.chorus.phrases.length - 1] += 2;
      sections.chorus.maxPhrase = Math.max(...sections.chorus.phrases);
    }
  }
  return { sections, total, peak };
}

// ---------- the skeleton search ----------
// The hook phrase's harmonic share: the practical test wants the hook's total near the
// per-moment ceiling, and the melody usually brings 1-2 DU of its own; the type templates
// say how much of that harmony carries (Narrative "harmonic minimal", Paradox harmonic-weighted).
const HOOK_HARMONIC_TARGET = { N: 0, G: 0, W: 0, "W-enthronement": 0, "W-contemplative": 0, M: 0, L: 0, LR: 0, LD: 0, V: 1, A: 1, T: 1, B: 1, PR: 1, P: 2 };
const HARMONIC_WEIGHT = { // Module 0 / the type templates: how much of the budget harmony may carry
  N: [0, 1], G: [0, 1], A: [0, 2], W: [0, 1], "W-enthronement": [0, 1], "W-contemplative": [0, 1], M: [0, 1],
  V: [0, 2], T: [0, 2], PR: [1, 3], L: [0, 2], LR: [0, 2], LD: [0, 2], B: [0, 2], P: [1, 3],
};

export function searchSkeletons(type, mode, kinds, { n = 400, seed = 1 } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const bank = (type || "").split("/")[0] === "B" && mode === "major" ? BLUES_BANK : LOOP_BANK[mode];
  const budget = budgetFor(type);
  const base = (type || "P").split("/")[0];
  const [hLo, hHi] = HARMONIC_WEIGHT[base] || [0, 2];
  const tonic = mode === "minor" ? "i" : "I";
  const out = [];
  for (let i = 0; i < n; i++) {
    const skel = {};
    kinds.forEach((k) => { skel[k] = [...pick(bank[k] || bank.verse)]; });
    // spend: the chorus (the hook moment) or the bridge gets a designed departure
    const spends = [];
    const nSpice = r() < 0.35 ? 0 : r() < 0.75 ? 1 : 2;
    for (let s = 0; s < nSpice; s++) {
      const where = skel.bridge && r() < 0.45 ? "bridge" : skel.prechorus && r() < 0.25 ? "prechorus" : "chorus";
      const sp = pick(SPICE[mode]);
      const pos = 1 + Math.floor(r() * 3);
      if (!skel[where]) continue;
      skel[where][pos] = sp.sym;
      spends.push({ where, pos, ...sp });
    }
    const led = harmonicLedger(skel, type, mode);
    // hard: total and per-moment ceilings; harmony leaves room for the melody's spend
    if (led.total > budget.total) continue;
    if (led.peak.du > budget.ceiling) continue;
    const ch = led.sections.chorus;
    const chorusDU = ch ? ch.maxPhrase : 0;
    if (chorusDU > hHi || (led.total < hLo)) continue;
    const target = HOOK_HARMONIC_TARGET[base] ?? 1;
    const exp = expectation(skel.chorus || skel.verse, bank === BLUES_BANK ? "blues" : mode);
    const facts = {
      loopChanges: skel.chorus && skel.verse ? skel.chorus.join() !== skel.verse.join() : true,
      chorusOffTonic: skel.chorus ? skel.chorus[0] !== tonic : false,
      verseOnTonic: skel.verse ? skel.verse[0] === tonic : false,
      verseBelowChorus: skel.verse && ch ? led.sections.verse.maxPhrase <= ch.maxPhrase : true,
      bridgeDeparts: skel.bridge ? skel.bridge[0] !== tonic && skel.bridge.join() !== (skel.verse || []).join() && skel.bridge.join() !== (skel.chorus || []).join() : true,
    };
    // Window 28 tendencies as soft terms; the hook's spend near the type's harmonic share
    const fit = (facts.loopChanges ? 1 : 0) * 0.30 + (facts.chorusOffTonic ? 0.57 : 0.43) * 0.15 + (facts.verseOnTonic ? 0.65 : 0.35) * 0.10 +
      (facts.verseBelowChorus ? 1 : 0) * 0.15 + (facts.bridgeDeparts ? 1 : 0) * 0.10 + (1 - Math.min(1, Math.abs(chorusDU - target) / 2)) * 0.20;
    const score = 0.6 * fit + 0.4 * exp.score;
    out.push({ id: i, skel, spends, ledger: led, expectation: exp, facts, fit, score });
  }
  out.sort((a, b) => b.score - a.score || a.id - b.id);
  // three different choruses
  const seen = new Set(), top = [];
  for (const c of out) { const k = (c.skel.chorus || []).join(); if (seen.has(k)) continue; seen.add(k); top.push(c); if (top.length === 3) break; }
  return { considered: n, kept: out.length, top, budget };
}

// Measure the writer's own chords: "I V vi IV" per section.
export function parseLoop(text, mode) {
  const syms = String(text || "").trim().split(/[\s,|–-]+/).filter(Boolean);
  const bad = syms.filter((s) => !parseChord(s, mode));
  return { syms, bad };
}

// ---------- melodic and rhythmic DUs from a chosen melody (19.9's other two columns) ----------
// Per phrase (line): hook on the 2nd degree 1, on the 6th or 7th 2; ascending leap of a 5th
// or more 2, past an octave 3; peak crossing the passaggio at the hook 2, well above it 3;
// one held off-beat note 1, consistent syncopation 2; the title's held note on beat 2 or 4 1,
// on the "and" of 2 2. Groove takes 1 DU off its rhythmic spend (19.10).
export function melodyLedger(lines, ctx) {
  const { key, voiceBreak, beatsPerBar, type } = ctx;
  const base = (type || "").split("/")[0];
  const scale = key.mode === "minor" ? MINOR : MAJOR;
  const deg = (p) => { const i = scale.indexOf(((p - key.tonic) % 12 + 12) % 12); return i < 0 ? null : i + 1; };
  return lines.map((l) => {
    const ns = l.notes;
    let mel = 0, rhy = 0;
    const why = [];
    if (l.kind === "chorus") {
      const pk = ns.find((n) => n.peak);
      if (pk) { const d = deg(pk.p); if (d === 2) { mel = Math.max(mel, 1); why.push("hook on the 2nd"); } if (d === 6 || d === 7) { mel = Math.max(mel, 2); why.push(`hook on the ${d}th`); } }
    }
    let up = 0; for (let i = 1; i < ns.length; i++) up = Math.max(up, ns[i].p - ns[i - 1].p);
    if (up > 12) { mel = Math.max(mel, 3); why.push("leap past an octave"); } else if (up >= 7) { mel = Math.max(mel, 2); why.push("ascending leap of a 5th+"); }
    const top = Math.max(...ns.map((n) => n.p));
    if (l.kind === "chorus" && top >= voiceBreak + 3) { mel = Math.max(mel, 3); why.push("peak well above the break"); }
    else if (l.kind === "chorus" && top > voiceBreak) { mel = Math.max(mel, 2); why.push("crosses the break"); }
    const held = ns.filter((n, i) => i > 0 && n.onset % 2 === 1 && n.dur >= 2).length;
    if (held >= Math.max(2, ns.length / 2)) { rhy = 2; why.push("consistent syncopation"); } else if (held >= 1) { rhy = 1; why.push("a syncopated hit"); }
    const money = ns.find((n) => n.money);
    if (money) {
      const pos = money.onset % (beatsPerBar * 2);
      if (pos === 3) { rhy = Math.max(rhy, 2); why.push("title held on the and of 2"); }
      else if (pos === 2 || pos === 6) { rhy = Math.max(rhy, 1); why.push("title held on beat 2 or 4"); }
    }
    if (base === "G" && rhy > 0) rhy -= 1;
    return { section: l.section, kind: l.kind, line: l.index, mel, rhy, why };
  });
}

// One chord's cost after the schema discount.
export function chordCost(sym, type, mode) {
  return discounted(sym, chordDU(sym, mode).du, type, mode);
}

// The whole departure map: per phrase (line), harmonic + melodic + rhythmic DU against the
// per-moment ceiling, and the song total. Harmonic departures are counted once per section
// design; melodic and rhythmic events of 2 DU or more join the total once per section; the
// 1-DU moves count against the per-moment ceiling only (this app's accounting of 19.9).
export function departureMap(sections, ctx) {
  const { type, key, beatsPerBar, voiceBreak } = ctx;
  const budget = budgetFor(type);
  const barLen = beatsPerBar * 2;
  const lines = [];
  sections.filter((s) => !s.repeat).forEach((sec) => {
    sec.lines.forEach((l, i) => {
      const b0 = Math.floor(l.start / barLen), b1 = Math.floor((l.start + l.slot - 1) / barLen);
      const syms = [];
      for (let b = b0; b <= b1; b++) syms.push(sec.loop[b % sec.loop.length]);
      lines.push({ section: sec.name, kind: sec.kind, index: i, notes: l.notes, text: l.text, syms });
    });
  });
  const ml = melodyLedger(lines, { key, voiceBreak, beatsPerBar, type });
  const rows = lines.map((l, i) => {
    const harm = [...new Set(l.syms)].reduce((a, sym) => a + chordCost(sym, type, key.mode), 0);
    const m = ml[i];
    const total = harm + m.mel + m.rhy;
    return { section: l.section, kind: l.kind, line: l.index + 1, text: l.text, harm, mel: m.mel, rhy: m.rhy, total, why: m.why, over: total > budget.ceiling };
  });
  const seen = new Set();
  let songTotal = 0;
  sections.filter((s) => !s.repeat).forEach((sec) => {
    const k = sec.kind + ":" + sec.loop.join();
    if (!seen.has(k)) { seen.add(k); songTotal += [...new Set(sec.loop)].reduce((a, sym) => a + chordCost(sym, type, key.mode), 0); }
  });
  const bySection = new Map();
  rows.forEach((r) => {
    if (r.mel >= 2) songTotal += r.mel;
    if (r.rhy >= 2) songTotal += r.rhy;
    bySection.set(r.section, Math.max(bySection.get(r.section) || 0, r.total));
  });
  const hookRows = rows.filter((r) => r.kind === "chorus");
  const hookPeak = hookRows.length ? Math.max(...hookRows.map((r) => r.total)) : 0;
  const versePeak = Math.max(0, ...rows.filter((r) => r.kind === "verse").map((r) => r.total));
  return { rows, budget, songTotal, hookPeak, versePeak, bySection: [...bySection.entries()], over: rows.filter((r) => r.over) };
}
