// Module 11.9: the song record and the documents written from it - the lead sheet, the
// full score, the parts, the Nashville chart and the songbook. Every document reads the
// same record, so they cannot disagree.
//
// The band parts are a default arrangement drawn from the chords and the section roles
// (quieter verse, fuller chorus, a thinner bridge) until checkpoint (e) writes the
// production notes; the documents say so.

import { parseChord, chordName } from "./harmony.js";
import * as Prod from "./production.js";

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
  const plan = song.production && song.production.plan ? song.production.plan : Prod.defaultPlan(song.type, brief.voiceName);
  if (plan.tag) {
    // a 4-bar tag on the chorus's chords, home on the tonic
    const ch = (cand.sections.find((s) => s.kind === "chorus") || cand.sections[cand.sections.length - 1]).loop;
    const tonic = brief.key.mode === "minor" ? "i" : "I";
    sections.push({ name: "Tag", kind: "tag", startBar: bar, bars: 4, chords: [ch[0 % ch.length], ch[1 % ch.length], ch[2 % ch.length], tonic], notes: [], lines: [] });
    bar += 4;
  }
  const totalBars = bar - 1;
  const c = song.contract || {};
  return {
    title: c.title || "Untitled", writer: c.writer || "", key: brief.key, ks, bpm: brief.bpm, beatsPerBar: brief.beatsPerBar, barLen,
    feel: c.feel || "", voiceName: brief.voiceName, voice: brief.voice, male: /male|bass|anthem/.test(brief.voiceName) && !/female/.test(brief.voiceName),
    sections, totalBars, about: song.q0 || "", form: sections.filter((s) => s.kind !== "intro").map((s) => s.name),
    melody: sections.flatMap((s) => s.notes), production: plan,
  };
}

// ---------- the arrangement: checkpoint (e)'s plan, or the type's default palette ----------
const cache = new WeakMap();
export function arrangement(rec) {
  if (!cache.has(rec)) cache.set(rec, Prod.arrange(rec, rec.production));
  return cache.get(rec);
}
// Every staff of the song: the voice, then the palette's players.
export function instruments(rec) {
  return [{ id: "voice", name: "Voice", kind: "voice" }, ...arrangement(rec).layers.map((l) => ({ id: l.id, name: l.name, kind: l.kind, notes: l.notes }))];
}
export function noteFor(rec, id, sectionIndex) {
  const arr = arrangement(rec);
  const ly = arr.layers.find((l) => l.id === id);
  return ly ? ly.notes[arr.roles[sectionIndex]] : "";
}

// ---------- ABC ----------
const DUR_OK = { 1: "", 2: "2", 3: "3", 4: "4", 6: "6", 8: "8", 12: "12" };
function splitDur(d) {
  const out = [];
  const opts = [8, 6, 4, 3, 2, 1];
  while (d > 0) { const x = opts.find((o) => o <= d); out.push(x); d -= x; }
  return out;
}

export function hyphenate(word, n) {
  if (n <= 1) return [word];
  const w = word.replace(/'/g, "’");
  const groups = [];
  const rx = /[aeiouy]+/gi; let m;
  while ((m = rx.exec(w))) groups.push([m.index, m.index + m[0].length]);
  // too few vowel groups for the syllables (ra-di-o): split a group between its vowels
  for (let g = 0; groups.length < n && g < groups.length; g++) {
    const [a, b] = groups[g];
    if (b - a >= 2 && !/^(ee|oo|ea|ai|ay|ou|ow|oa|ie|ei|ey|oy|oi|au|aw|ue)$/i.test(w.slice(a, b))) { groups.splice(g, 1, [a, a + 1], [a + 1, b]); g--; }
  }
  for (let g = 0; groups.length < n && g < groups.length; g++) {
    const [a, b] = groups[g];
    if (b - a >= 2) { groups.splice(g, 1, [a, a + 1], [a + 1, b]); g--; }
  }
  const cuts = [];
  for (let g = 0; g + 1 < groups.length && cuts.length < n - 1; g++) {
    const gapStart = groups[g][1], gapEnd = groups[g + 1][0];
    const gap = w.slice(gapStart, gapEnd).toLowerCase();
    // keep digraphs together (fa-ther, wash-ing); otherwise split a cluster after its first consonant
    const di = /^(th|sh|ch|ph|wh|gh|ck|ng)/.test(gap) ? 0 : 1;
    cuts.push(gapEnd - gapStart >= 2 ? gapStart + di : gapStart);
  }
  while (cuts.length < n - 1) cuts.push(Math.round((w.length * (cuts.length + 1)) / n));
  const parts = [];
  let prev = 0;
  cuts.sort((a, b) => a - b).forEach((c) => { const cc = Math.max(c, prev + 1); parts.push(w.slice(prev, cc)); prev = cc; });
  parts.push(w.slice(prev));
  return parts.map((p) => (p || "_").replace(/’/g, "'"));
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

const LETTERS_V = "ABCEFHIJKMNOPQSTUWXYZ";
function voiceData(rec, arr, id, inScore = false, top = false) {
  const ann0 = annotations(rec), chords0 = chordList(rec);
  const ann = !inScore || top ? ann0 : null;
  const perc = { K: "F", S: "c", H: "!style=x!g", C: "!style=x!a" };
  if (id === "voice") {
    const melodyEvents = rec.melody.map((n) => ({ t: n.t, dur: n.dur, ps: [n.p], syl: n.syl, word: n.word, part: n.part, of: n.of, lineStart: n.lineStart }));
    return [{ v: "V", name: "Voice", clef: rec.male ? "treble-8" : "treble", data: voiceBars(melodyEvents, rec, { lyrics: true, chords: chords0, annotations: ann }) }];
  }
  const li = arr.layers.findIndex((l) => l.id === id);
  if (li < 0) return [];
  const ly = arr.layers[li];
  const v = LETTERS_V[li % LETTERS_V.length];
  const chords = !inScore || ly.kind === "strum" ? chords0 : null;
  const clefFor = (evs) => { const ps = evs.flatMap((e) => e.ps || []); if (!ps.length) return "treble"; const med = ps.sort((a, b) => a - b)[Math.floor(ps.length / 2)]; return med < 57 ? "bass" : "treble"; };
  switch (ly.kind) {
    case "strum": return [{ v, name: ly.name, clef: "treble", style: "rhythm", data: voiceBars(ly.events.map((e) => ({ t: e.t, dur: e.dur, slash: true })), rec, { chords, annotations: ann }) }];
    case "piano": {
      const R = ly.events.filter((e) => e.hand === "R"), Lh = ly.events.filter((e) => e.hand === "L");
      return [{ v: "R", name: ly.name, clef: "treble", data: voiceBars(R, rec, { chords, annotations: ann }) }, { v: "L", name: "", clef: "bass", data: voiceBars(Lh, rec, {}) }];
    }
    case "drums": return [{ v: "D", name: ly.name, clef: "perc", data: voiceBars(ly.events.map((d) => ({ t: d.t, dur: d.dur, perc: d.hits.length > 1 ? `[${d.hits.map((h) => perc[h].replace("!style=x!", "")).join("")}]` : perc[d.hits[0]] })), rec, { annotations: ann }) }];
    default: return [{ v, name: ly.name, clef: ly.kind === "bass" ? "bass" : clefFor(ly.events), data: voiceBars(ly.events.map((e) => ({ t: e.t, dur: e.dur, ps: e.ps })), rec, { chords, annotations: ann }) }];
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
    drums: noteFor(rec, "drums", rec.sections.indexOf(s)),
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
  const players = instruments(rec).filter((x) => x.id !== "voice").map((x) => ({ name: x.name, sections: rec.sections.map((s, i) => ({ name: s.name, note: noteFor(rec, x.id, i) })) }));
  return {
    title: rec.title, writer: rec.writer,
    glance: {
      key: `${ks.name} ${rec.key.mode}`, tempo: `${rec.bpm} BPM${rec.feel ? ", " + rec.feel : ""}`, meter: `${rec.beatsPerBar}/4`,
      form: rec.form.join(" · "), length: `${rec.totalBars} bars`, about: song.q0 || "",
      range: mel.length ? `${noteLabel(lo, ks)} to ${noteLabel(hi, ks)}${rec.male ? " (written an octave higher on the treble clef with an 8)" : ""}` : "",
    },
    sections, lyricSheet, players,
    producer: Prod.oneSheet(rec, song, arrangement(rec), { target: song.production && song.production.target, references: song.production && song.production.references }),
    session: {
      tempo: `${rec.bpm} BPM, click on quarters, ${rec.beatsPerBar}/4; a 4-bar intro${rec.sections.some((x) => x.kind === "tag") ? " and a 4-bar tag" : ""}.`,
      key: `${ks.name} ${rec.key.mode}.`,
      chords: rec.sections.map((x) => `${x.name} (bars ${x.startBar}–${x.startBar + x.bars - 1}): ${x.chords.map((c) => chordName(c, rec.key)).join(" | ")}`),
      range: mel.length ? `${noteLabel(lo, ks)} to ${noteLabel(hi, ks)}.` : "",
      tracking: `Track to the click: ${["bass and drums together", ...arrangement(rec).layers.filter((l) => l.kind !== "bass" && l.kind !== "drums").map((l) => l.name.toLowerCase())].join(", then ")}, then the lead vocal, then the ${(arrangement(rec).layers.find((l) => l.kind === "fill") || { name: "fills" }).name.toLowerCase()} answers.`,
      panning: "Voice, bass and kick in the centre; guitars and keys spread left and right; strings wide; the lead instrument slightly off centre, opposite the main guitar.",
    },
    singer: mel.length ? `The range runs ${noteLabel(lo, ks)} to ${noteLabel(hi, ks)}. The highest note is ${noteLabel(hi, ks)} on "${(mel.find((n) => n.p === hi) || {}).word || ""}" in bar ${Math.floor((mel.find((n) => n.p === hi) || { t: 0 }).t / rec.barLen) + 1}. Breathe at the rests between lines.` : "",
  };
}
