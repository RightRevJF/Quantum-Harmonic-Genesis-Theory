// Module 11.9: the song record and the documents written from it - the lead sheet, the
// full score, the parts, the Nashville chart and the songbook. Every document reads the
// same record, so they cannot disagree.
//
// The band parts are a default arrangement drawn from the chords and the section roles
// (quieter verse, fuller chorus, a thinner bridge) until checkpoint (e) writes the
// production notes; the documents say so.

import { parseChord, chordName } from "./harmony.js";

// ---------- spelling ----------
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
const TONIC_NAMES = { major: ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"], minor: ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"] };

export function keySpelling(key) {
  const name = TONIC_NAMES[key.mode][key.tonic];
  const li = LETTERS.indexOf(name[0]);
  const scale = key.mode === "minor" ? MINOR : MAJOR;
  const letters = scale.map((_, i) => LETTERS[(li + i) % 7]);
  const sig = {};
  letters.forEach((L, i) => { let a = (((key.tonic + scale[i]) - NAT[L]) % 12 + 12) % 12; if (a > 6) a -= 12; sig[L] = a; });
  const abcKey = name.replace("b", "b").replace("#", "#") + (key.mode === "minor" ? "m" : "");
  return { name, letters, scale, sig, abcKey, tonic: key.tonic, mode: key.mode };
}

// Spell a MIDI pitch in the key: scale tones take the key's letter; others the nearest
// letter, flat-side unless it is the raised leading tone of a minor key.
export function spell(p, ks) {
  const rel = ((p - ks.tonic) % 12 + 12) % 12;
  let i = ks.scale.indexOf(rel);
  let L;
  if (i >= 0) L = ks.letters[i];
  else if (ks.mode === "minor" && rel === 11) L = ks.letters[6];
  else {
    // the neighbouring letters; keep the accidental to a single sharp or flat, flat side first
    const pc = p % 12;
    const accOf = (X) => { let a = (pc - NAT[X] + 12) % 12; if (a > 6) a -= 12; return a; };
    const idx = LETTERS.findIndex((X) => NAT[X] === pc);
    if (idx >= 0) L = LETTERS[idx];
    else {
      const flatL = LETTERS.find((X) => accOf(X) === -1), sharpL = LETTERS.find((X) => accOf(X) === 1);
      L = ks.sig[flatL] === -1 || !(ks.sig[sharpL] === 1) ? flatL : sharpL;
      if (ks.mode === "minor" && rel === 11) L = ks.letters[6];
    }
  }
  let acc = ((p % 12) - NAT[L] + 12) % 12; if (acc > 6) acc -= 12;
  const octave = Math.floor((p - acc - NAT[L]) / 12) - 1;
  return { L, acc, octave };
}

function abcPitch({ L, octave }) {
  if (octave >= 5) return L.toLowerCase() + "'".repeat(octave - 5);
  return L + ",".repeat(Math.max(0, 4 - octave));
}

const NAMES_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export function noteLabel(p, ks) {
  const s = spell(p, ks);
  const acc = s.acc === 1 ? "♯" : s.acc === -1 ? "♭" : s.acc === 2 ? "𝄪" : s.acc === -2 ? "𝄫" : "";
  return `${s.L}${acc}${s.octave}`;
}

// ---------- the record ----------
const KIND_NAME = { verse: "Verse", prechorus: "Pre-chorus", chorus: "Chorus", bridge: "Bridge", intro: "Intro", outro: "Outro", tag: "Tag", vamp: "Vamp" };

// cand: the chosen candidate rebuilt from its seed; brief: its melody brief; song: the app's song state.
export function buildRecord(cand, brief, song) {
  const barLen = brief.beatsPerBar * 2;
  const ks = keySpelling(brief.key);
  const intro = 4;
  const sections = [];
  const firstLoop = (cand.sections.find((s) => s.kind === "verse") || cand.sections[0]).loop;
  sections.push({ name: "Intro", kind: "intro", startBar: 1, bars: intro, chords: Array.from({ length: intro }, (_, b) => firstLoop[b % firstLoop.length]), notes: [], lines: [] });
  let bar = intro + 1;
  cand.sections.forEach((sec) => {
    const bars = Math.ceil(sec.length / barLen);
    const t0 = (bar - 1) * barLen;
    sections.push({
      name: sec.name, kind: sec.kind, startBar: bar, bars, repeat: Boolean(sec.repeat),
      chords: Array.from({ length: bars }, (_, b) => sec.loop[b % sec.loop.length]),
      notes: sec.notes.map((n, i) => ({ ...n, t: t0 + n.onset, lineStart: i === 0 || sec.notes[i - 1].line !== n.line })),
      lines: sec.lines.map((l) => ({ text: l.text, bar: bar + Math.floor((l.notes[0] ? l.notes[0].onset : l.start) / barLen), startBar: bar + Math.floor(l.start / barLen), notes: l.notes.map((n) => ({ ...n, t: t0 + n.onset })) })),
    });
    bar += bars;
  });
  const totalBars = bar - 1;
  const c = song.contract || {};
  return {
    title: c.title || "Untitled", writer: c.writer || "", key: brief.key, ks, bpm: brief.bpm, beatsPerBar: brief.beatsPerBar, barLen,
    feel: c.feel || "", voiceName: brief.voiceName, voice: brief.voice, male: /male|bass|anthem/.test(brief.voiceName) && !/female/.test(brief.voiceName),
    sections, totalBars, about: song.q0 || "", form: sections.filter((s) => s.kind !== "intro").map((s) => s.name),
    melody: sections.flatMap((s) => s.notes),
  };
}

// ---------- the default arrangement (until checkpoint e) ----------
const ROLE = { intro: "intro", verse: "verse", prechorus: "build", chorus: "full", bridge: "thin", outro: "intro", tag: "full", vamp: "full" };

export function arrangement(rec) {
  const { barLen, ks } = rec;
  const tonic = ks.tonic;
  const keysRH = [], keysLH = [], guitar = [], bass = [], drums = [];
  let prevVoicing = null;
  rec.sections.forEach((sec) => {
    const role = ROLE[sec.kind] || "verse";
    sec.chords.forEach((sym, b) => {
      const t0 = (sec.startBar - 1 + b) * barLen;
      const ch = parseChord(sym, ks.mode) || parseChord(ks.mode === "minor" ? "i" : "I", ks.mode);
      const pcs = ch.tones.slice(0, 3).map((x) => (tonic + x) % 12);
      // right hand: the triad voicing nearest the last, between G3 and E5
      const voicings = [];
      for (let base = 55; base <= 67; base++) {
        if (!pcs.includes(base % 12)) continue;
        const v = [base];
        for (let k = 1; k < 3; k++) { let p = v[k - 1] + 1; while (!pcs.includes(p % 12) || v.includes(p) || v.some((q) => q % 12 === p % 12)) p++; v.push(p); }
        if (v[2] <= 76) voicings.push(v);
      }
      const center = prevVoicing ? prevVoicing.reduce((a, x) => a + x, 0) / 3 : 64;
      const v = voicings.reduce((a, x) => (Math.abs(x.reduce((s, y) => s + y, 0) / 3 - center) < Math.abs(a.reduce((s, y) => s + y, 0) / 3 - center) ? x : a), voicings[0]);
      prevVoicing = v;
      const root = (tonic + ch.root) % 12;
      const rhPattern = role === "full" ? [[0, barLen / 2], [barLen / 2, barLen / 2]] : [[0, barLen]];
      rhPattern.forEach(([o, d]) => keysRH.push({ t: t0 + o, dur: d, ps: v }));
      keysLH.push({ t: t0, dur: barLen, ps: [36 + ((root - 0 + 12) % 12) + (root < 7 ? 12 : 0)] });
      // guitar: strummed slashes under the chord names
      const strum = role === "full" ? 1 : role === "thin" ? barLen / 2 : 2;
      for (let o = 0; o < barLen; o += strum) guitar.push({ t: t0 + o, dur: strum, slash: true, chord: o === 0 ? sym : null });
      // bass (written an octave above sounding): root and fifth in the verse, roots on the beat in the chorus
      const bRoot = 40 + ((root - 4 + 12) % 12);
      const fifth = bRoot + 7 <= 55 ? bRoot + 7 : bRoot - 5;
      if (role === "full" || role === "build") for (let o = 0; o < barLen; o += 2) bass.push({ t: t0 + o, dur: 2, ps: [bRoot] });
      else if (role === "intro" || role === "thin") bass.push({ t: t0, dur: barLen, ps: [bRoot] });
      else { bass.push({ t: t0, dur: barLen / 2, ps: [bRoot] }); bass.push({ t: t0 + barLen / 2, dur: barLen / 2, ps: [fifth] }); }
      // drums: K kick, S snare, H hi-hat, C crash
      const kit = [];
      const four = rec.beatsPerBar === 4;
      for (let o = 0; o < barLen; o++) {
        const hits = [];
        const beat = o % 2 === 0 ? o / 2 + 1 : null;
        if (role === "thin") { if (o === 0) hits.push("K"); if (o === barLen / 2) hits.push("S"); if (beat) hits.push("H"); }
        else if (role === "intro") { if (o === 0) hits.push("K"); if (beat) hits.push("H"); }
        else {
          if (o === 0 || (four && o === 4) || (role === "full" && four && o === 5)) hits.push("K");
          if (four ? (o === 2 || o === 6) : (o === 2 || o === 4)) hits.push("S");
          hits.push("H");
          if (o === 0 && b === 0 && (role === "full")) hits.push("C");
        }
        kit.push(hits);
      }
      const hitAt = kit.map((h, o) => (h.length ? o : -1)).filter((o) => o >= 0);
      hitAt.forEach((o, k) => drums.push({ t: t0 + o, dur: (hitAt[k + 1] ?? barLen) - o, hits: kit[o] }));
    });
  });
  return { keysRH, keysLH, guitar, bass, drums };
}

export const PLAYER_NOTES = {
  keys: { intro: "Whole-note chords, soft.", verse: "Whole-note chords under the voice; stay below the melody.", build: "Whole notes, lifting in level.", full: "Half-note chords, fuller and louder.", thin: "Whole notes, sparse: leave room for the words." },
  guitar: { intro: "Quarter-note strums, light.", verse: "Quarter-note strums.", build: "Quarter notes, digging in.", full: "Eighth-note strums, open and driving.", thin: "Half-note strums, let them ring." },
  bass: { intro: "Roots, whole notes.", verse: "Root and fifth, half notes.", build: "Roots on every beat.", full: "Roots on every beat, locked with the kick.", thin: "Roots, whole notes." },
  drums: { intro: "Hi-hat time with the kick on 1.", verse: "Kick on 1 and 3, snare on 2 and 4, closed hi-hat eighths.", build: "Same groove, building.", full: "Kick on 1, 3 and the and of 3; snare on 2 and 4; crash into the chorus.", thin: "Half-time: kick on 1, snare on 3, hi-hat quarters." },
};

// ---------- ABC ----------
const DUR_OK = { 1: "", 2: "2", 3: "3", 4: "4", 6: "6", 8: "8", 12: "12" };
function splitDur(d) {
  const out = [];
  const opts = [8, 6, 4, 3, 2, 1];
  while (d > 0) { const x = opts.find((o) => o <= d); out.push(x); d -= x; }
  return out;
}

function hyphenate(word, n) {
  if (n <= 1) return [word];
  const w = word.replace(/'/g, "");
  const groups = [];
  const rx = /[aeiouy]+/gi; let m;
  while ((m = rx.exec(w))) groups.push([m.index, m.index + m[0].length]);
  const cuts = [];
  for (let g = 0; g + 1 < groups.length && cuts.length < n - 1; g++) {
    const gapStart = groups[g][1], gapEnd = groups[g + 1][0];
    const gap = w.slice(gapStart, gapEnd).toLowerCase();
    // keep digraphs together (fa-ther, wash-ing); otherwise split a cluster after its first consonant
    const di = /^(th|sh|ch|ph|wh|gh|ck|ng)$/.test(gap) ? 0 : /^(th|sh|ch|ph|wh)/.test(gap) ? 0 : 1;
    const cut = gapEnd - gapStart >= 2 ? gapStart + di : gapStart;
    cuts.push(Math.max(1, cut));
  }
  while (cuts.length < n - 1) cuts.push(Math.round((w.length * (cuts.length + 1)) / n));
  const parts = [];
  let prev = 0;
  cuts.sort((a, b) => a - b).forEach((c) => { parts.push(w.slice(prev, c)); prev = c; });
  parts.push(w.slice(prev));
  return parts.map((p) => p || "_");
}

// Turn timed events into ABC bars for one voice. ev: {t, dur, ps:[] | rest, slash, chord, syl, word, part, of, ann}
function voiceBars(events, rec, opts = {}) {
  const { barLen, ks, totalBars } = rec;
  const bars = [];
  const lyr = [];
  const byBar = Array.from({ length: totalBars }, () => []);
  events.forEach((e) => {
    let t = e.t, d = e.dur, first = true;
    while (d > 0) {
      const b = Math.floor(t / barLen);
      if (b >= totalBars) break;
      const room = (b + 1) * barLen - t;
      const take = Math.min(room, d);
      byBar[b].push({ ...e, t, dur: take, tieOut: take < d, cont: !first });
      t += take; d -= take; first = false;
    }
  });
  for (let b = 0; b < totalBars; b++) {
    const evs = byBar[b].sort((x, y) => x.t - y.t);
    const state = {};
    let pos = b * barLen;
    let out = "";
    const words = [];
    const chordAt = opts.chords ? opts.chords[b] : null;
    let chordDone = !chordAt;
    const ann = opts.annotations ? opts.annotations[b] : null;
    let annDone = !ann;
    const prefix = () => {
      let s = "";
      if (!annDone) { s += `"^${ann}"`; annDone = true; }
      if (!chordDone) { s += `"${chordName(chordAt, rec.key)}"`; chordDone = true; }
      return s;
    };
    const rest = (d) => splitDur(d).forEach((x) => { out += prefix() + (opts.invisibleRests ? "x" : "z") + DUR_OK[x] + " "; });
    evs.forEach((e) => {
      if (e.t > pos) rest(e.t - pos);
      const pieces = splitDur(e.dur);
      let pstart = e.t;
      pieces.forEach((x, i) => {
        let note;
        if (e.slash) note = "B";
        else if (e.perc) note = e.perc;
        else {
          const ns = e.ps.map((p) => {
            const s = spell(p, ks);
            const k = s.L + s.octave;
            const cur = state[k] ?? ks.sig[s.L] ?? 0;
            let acc = "";
            if (s.acc !== cur) { acc = s.acc === 1 ? "^" : s.acc === -1 ? "_" : s.acc === 2 ? "^^" : s.acc === -2 ? "__" : "="; state[k] = s.acc; }
            return acc + abcPitch(s);
          });
          note = ns.length > 1 ? `[${ns.join("")}]` : ns[0];
        }
        const tie = i < pieces.length - 1 || e.tieOut ? "-" : "";
        // beam eighths within a beat: no space unless the note ends on a beat
        const end = pstart + x; pstart = end;
        out += prefix() + note + DUR_OK[x] + tie + (end % 2 === 0 || x >= 2 ? " " : "");
        if (opts.lyrics && !e.slash) {
          if (i === 0 && !e.cont) {
            if (e.word) {
              let w = /^i($|')/.test(e.word) ? "I" + e.word.slice(1) : e.word;
              if (e.lineStart) w = w[0].toUpperCase() + w.slice(1);
              const parts = hyphenate(w, e.of || 1);
              const piece = parts[e.part || 0] || "";
              words.push(piece + ((e.part || 0) < (e.of || 1) - 1 ? "-" : ""));
            } else words.push(e.syl && e.syl !== "–" ? e.syl : "*");
          } else words.push("_");
        }
      });
      pos = e.t + e.dur;
    });
    if (pos < (b + 1) * barLen) rest((b + 1) * barLen - pos);
    bars.push(out.trim());
    lyr.push(words.join(" ").replace(/- /g, "-"));
  }
  return { bars, lyr };
}

function header(rec, { title = true, meter = true, extra = "" } = {}) {
  const lines = ["X:1"];
  if (title) { lines.push(`T:${rec.title}`); if (rec.writer) lines.push(`C:Words and music: ${rec.writer}`); }
  lines.push(meter ? `M:${rec.beatsPerBar}/4` : "M:none", "L:1/8");
  if (meter) lines.push(`Q:1/4=${rec.bpm}`);
  if (extra) lines.push(extra);
  return lines;
}

function annotations(rec) {
  const a = {};
  rec.sections.forEach((s) => { a[s.startBar - 1] = s.name; });
  return a;
}
function chordList(rec) { return rec.sections.flatMap((s) => s.chords); }

export const INSTRUMENTS = [
  { id: "voice", name: "Voice" },
  { id: "guitar", name: "Guitar" },
  { id: "keys", name: "Keys" },
  { id: "bass", name: "Bass" },
  { id: "drums", name: "Drums" },
];

function voiceData(rec, arr, id, inScore = false, top = false) {
  const melodyEvents = rec.melody.map((n) => ({ t: n.t, dur: n.dur, ps: [n.p], syl: n.syl, word: n.word, part: n.part, of: n.of, lineStart: n.lineStart }));
  const ann0 = annotations(rec), chords0 = chordList(rec);
  const ann = !inScore || top ? ann0 : null;
  const chords = !inScore || id === "voice" || id === "guitar" ? chords0 : null;
  const perc = { K: "F", S: "c", H: "!style=x!g", C: "!style=x!a" };
  switch (id) {
    case "voice": return [{ v: "V", name: "Voice", clef: rec.male ? "treble-8" : "treble", data: voiceBars(melodyEvents, rec, { lyrics: true, chords, annotations: ann }) }];
    case "guitar": return [{ v: "G", name: "Guitar", clef: "treble", style: "rhythm", data: voiceBars(arr.guitar, rec, { chords, annotations: ann }) }];
    case "keys": return [
      { v: "R", name: "Keys", clef: "treble", data: voiceBars(arr.keysRH, rec, { chords, annotations: ann }) },
      { v: "L", name: "", clef: "bass", data: voiceBars(arr.keysLH, rec, {}) },
    ];
    case "bass": return [{ v: "B", name: "Bass", clef: "bass", data: voiceBars(arr.bass, rec, { chords, annotations: ann }) }];
    case "drums": return [{ v: "D", name: "Drums", clef: "perc", data: voiceBars(arr.drums.map((d) => ({ t: d.t, dur: d.dur, perc: d.hits.length > 1 ? `[${d.hits.map((h) => perc[h].replace("!style=x!", "")).join("")}]` : perc[d.hits[0]] })), rec, { annotations: ann }) }];
    default: return [];
  }
}

// Systems of `per` bars, each its own ABC tune so the PDF can break pages between them.
export function scoreSystems(rec, ids, { per = 4, title = true, lyricsOn = true } = {}) {
  const arr = arrangement(rec);
  const inScore = ids.length > 1;
  const voices = ids.flatMap((id, i) => voiceData(rec, arr, id, inScore, i === 0));
  // units: one bar each, or a run of empty bars compressed into a multi-bar rest (single-staff parts)
  const units = [];
  const single = voices.length === 1;
  const emptyBar = (txt) => !/[A-Ga-g]/.test(txt.replace(/"[^"]*"/g, "")) && /z/.test(txt);
  for (let b = 0; b < rec.totalBars; b++) {
    const v0 = voices[0].data;
    if (single && emptyBar(v0.bars[b])) {
      let e = b;
      while (e + 1 < rec.totalBars && emptyBar(v0.bars[e + 1])) e++;
      if (e > b) {
        const ann = (v0.bars[b].match(/"\^[^"]*"/) || [""])[0];
        units.push({ first: b, last: e, bars: [`${ann}Z${e - b + 1}`], lyr: [""] });
        b = e; continue;
      }
    }
    units.push({ first: b, last: b, bars: voices.map((v) => v.data.bars[b]), lyr: voices.map((v) => v.data.lyr[b]) });
  }
  const systems = [];
  for (let s = 0; s * per < units.length; s++) {
    const chunk = units.slice(s * per, s * per + per);
    const head = header(rec, { title: title && s === 0, meter: s === 0 });
    const decl = ["%%stretchlast 1"];
    const groups = [];
    let i = 0;
    while (i < voices.length) {
      if (voices[i].v === "R" && voices[i + 1] && voices[i + 1].v === "L") { groups.push(`{R L}`); i += 2; } else { groups.push(voices[i].v); i++; }
    }
    if (voices.length > 1) decl.push(`%%score ${groups.join(" ")}`);
    voices.forEach((v) => decl.push(`V:${v.v} clef=${v.clef}${v.name && s === 0 ? ` name="${v.name}"` : ""}${v.name && s > 0 && voices.length > 1 ? ` sname="${v.name.slice(0, 3)}."` : ""}${v.style ? ` style=${v.style}` : ""}`));
    const body = [];
    const isEnd = chunk[chunk.length - 1].last === rec.totalBars - 1;
    voices.forEach((v, vi) => {
      body.push(`[V:${v.v}] ${chunk.map((u) => u.bars[vi] ?? u.bars[0]).join(" | ")} ${isEnd ? "|]" : "|"}`);
      if (lyricsOn && v.v === "V") body.push(`w: ${chunk.map((u) => u.lyr[vi] ?? "").join(" | ")}`);
    });
    systems.push({ firstBar: chunk[0].first + 1, abc: [...head, `K:${rec.ks.abcKey}`, ...decl, ...body].join("\n") });
  }
  return systems;
}

// Bars per system: fewer when the melody is busy, so the lyric has room under the notes.
export function barsPerSystem(rec) {
  const per = new Map();
  rec.melody.forEach((n) => { const b = Math.floor(n.t / rec.barLen); per.set(b, (per.get(b) || 0) + 1); });
  const busiest = Math.max(0, ...per.values());
  return busiest >= 6 ? 2 : busiest >= 4 ? 3 : 4;
}

// A part: one instrument, with its own heading, 4 bars a line, rests compressed.
export function partSystems(rec, id, opts = {}) { return scoreSystems(rec, [id], { per: 4, ...opts }); }

// ---------- the Nashville chart ----------
const NUMS = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];
export function nashville(sym, mode) {
  const c = parseChord(sym, mode);
  if (!c) return sym;
  const q = c.dim ? "°" : c.minor ? "m" : "";
  return `${NUMS[c.root]}${q}${c.seventh}`;
}
export function chart(rec) {
  const rows = rec.sections.map((s) => ({
    name: s.name, startBar: s.startBar, bars: s.bars,
    cells: s.chords.map((c) => nashville(c, rec.key.mode)),
    names: s.chords.map((c) => chordName(c, rec.key)),
    drums: PLAYER_NOTES.drums[ROLE[s.kind] || "verse"],
  }));
  return { title: rec.title, key: `${rec.ks.name} ${rec.key.mode}`, bpm: rec.bpm, meter: `${rec.beatsPerBar}/4`, feel: rec.feel, rows };
}

// ---------- the songbook (for musicians: no engine terms) ----------
export function songbook(rec, song) {
  const ks = rec.ks;
  const mel = rec.melody;
  const lo = mel.length ? Math.min(...mel.map((n) => n.p)) : 0, hi = mel.length ? Math.max(...mel.map((n) => n.p)) : 0;
  const unique = rec.sections.filter((s, i) => rec.sections.findIndex((x) => x.name.replace(/\s*\d+$/, "") === s.name.replace(/\s*\d+$/, "") && !x.repeat) === i || (!s.repeat && s.kind === "verse"));
  const sections = rec.sections.filter((s) => s.kind !== "intro" && !s.repeat).map((s) => ({
    name: s.name, bars: `${s.startBar}–${s.startBar + s.bars - 1}`,
    lines: s.lines.map((l) => {
      const top = l.notes.reduce((a, n) => (n.p > a.p ? n : a), l.notes[0]);
      const first = l.notes[0];
      const bar = (t) => Math.floor(t / rec.barLen) + 1;
      return {
        text: l.text, bar: l.bar, startBar: l.startBar,
        chords: [...new Set(l.notes.map((n) => bar(n.t)))].map((b) => chordName(rec.sections.flatMap((x) => x.chords)[b - 1], rec.key)),
        melody: first ? `Enters on ${noteLabel(first.p, ks)} in bar ${bar(first.t)}${bar(first.t) !== l.startBar ? ` (pickup in ${l.startBar})` : ""}; high note ${noteLabel(top.p, ks)} on "${top.word || top.syl}" in bar ${bar(top.t)}.` : "",
      };
    }),
  }));
  const lyricSheet = rec.sections.filter((s) => s.kind !== "intro").map((s) => ({ name: s.name, lines: s.lines.map((l) => ({ bar: l.bar, pickup: l.bar !== l.startBar ? l.startBar : null, text: l.text })) }));
  const players = INSTRUMENTS.filter((x) => x.id !== "voice").map((x) => ({ name: x.name, bySection: [...new Set(rec.sections.map((s) => ROLE[s.kind] || "verse"))].map((role) => ({ role, note: PLAYER_NOTES[x.id][role] })), sections: rec.sections.map((s) => ({ name: s.name, note: PLAYER_NOTES[x.id][ROLE[s.kind] || "verse"] })) }));
  return {
    title: rec.title, writer: rec.writer,
    glance: {
      key: `${ks.name} ${rec.key.mode}`, tempo: `${rec.bpm} BPM${rec.feel ? ", " + rec.feel : ""}`, meter: `${rec.beatsPerBar}/4`,
      form: rec.form.join(" · "), length: `${rec.totalBars} bars`, about: song.q0 || "",
      range: mel.length ? `${noteLabel(lo, ks)} to ${noteLabel(hi, ks)}${rec.male ? " (written an octave higher on the treble clef with an 8)" : ""}` : "",
    },
    sections, lyricSheet, players,
    singer: mel.length ? `The range runs ${noteLabel(lo, ks)} to ${noteLabel(hi, ks)}. The highest note is ${noteLabel(hi, ks)} on "${(mel.find((n) => n.p === hi) || {}).word || ""}" in bar ${Math.floor((mel.find((n) => n.p === hi) || { t: 0 }).t / rec.barLen) + 1}. Breathe at the rests between lines.` : "",
  };
}
