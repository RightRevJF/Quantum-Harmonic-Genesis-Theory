// LilyPond files from the song record (Module 11), for print-quality engraving.
// The same record and arrangement as the PDFs (docs.js), so the two cannot disagree.
//
// Module 11 rules kept here: vocal melody in \relative c' (11.1); a male voice on
// \clef "treble_8" with the melody at sounding pitch; congregational melody transposed
// up an octave at the score level (11.7); \compressMMRests with chord-name skips as a
// single s1*n; strummed guitar as slashes (\improvisationOn); drums in \drummode.

import { spell, arrangement, keySpelling, hyphenate, noteFor } from "./docs.js";
import { parseChord } from "./harmony.js";

const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const ACC = { "-2": "eses", "-1": "es", 0: "", 1: "is", 2: "isis" };
function lyName(L, acc) {
  const base = L.toLowerCase();
  let s = ACC[acc] ?? "";
  if (s.startsWith("es") && (base === "e" || base === "a")) s = s.slice(1); // es, as (Dutch names)
  return base + s;
}
// Absolute: c = C3, c' = C4
function lyAbs(p, ks) {
  const s = spell(p, ks);
  const marks = s.octave - 3;
  return lyName(s.L, s.acc) + (marks > 0 ? "'".repeat(marks) : ",".repeat(-marks));
}
// Relative mode: each note within a fourth of the last unless marked.
function lyRel(p, ks, state) {
  const s = spell(p, ks);
  const pos = s.octave * 7 + LETTER_IDX[s.L];
  let d = pos - state.pos, marks = 0;
  while (d > 3) { d -= 7; marks++; }
  while (d < -3) { d += 7; marks--; }
  state.pos = pos;
  return lyName(s.L, s.acc) + (marks > 0 ? "'".repeat(marks) : ",".repeat(-marks));
}

// eighths -> LilyPond durations (ties for the rest)
const DUR = { 1: "8", 2: "4", 3: "4.", 4: "2", 6: "2.", 8: "1", 12: "1." };
function split(d) { const out = []; const o = [12, 8, 6, 4, 3, 2, 1]; while (d > 0) { const x = o.find((v) => v <= d); out.push(x); d -= x; } return out; }
function restTokens(d, sym = "r") { return split(d).map((x) => sym + DUR[x]); }

// Lay events into bars, splitting at barlines (ties carry).
function bars(events, rec) {
  const { barLen, totalBars } = rec;
  const out = Array.from({ length: totalBars }, () => []);
  events.forEach((e) => {
    let t = e.t, d = e.dur, first = true;
    while (d > 0) {
      const b = Math.floor(t / barLen);
      if (b >= totalBars) break;
      const take = Math.min((b + 1) * barLen - t, d);
      out[b].push({ ...e, t, dur: take, tieOut: take < d, cont: !first });
      t += take; d -= take; first = false;
    }
  });
  return out.map((evs) => evs.sort((a, b) => a.t - b.t));
}

function music(events, rec, render, { rest = "r", marks = null, dyn = null } = {}) {
  const per = bars(events, rec);
  const lines = per.map((evs, b) => {
    const t0 = b * rec.barLen;
    let pos = t0;
    const toks = [];
    if (marks && marks[b]) toks.push(`\\mark \\markup \\bold "${marks[b]}"`);
    if (!evs.length && rest === "r") { toks.push("R" + (DUR[rec.barLen] || "1")); return toks.join(" "); }
    evs.forEach((e) => {
      if (e.t > pos) toks.push(...restTokens(e.t - pos, rest));
      const pieces = split(e.dur);
      pieces.forEach((x, i) => {
        let d = "";
        if (dyn && dyn[b] && !e.cont && i === 0) { d = "\\" + dyn[b]; dyn[b] = null; }
        toks.push(render(e, i === 0) + DUR[x] + d + (i < pieces.length - 1 || e.tieOut ? "~" : ""));
      });
      pos = e.t + e.dur;
    });
    if (pos < t0 + rec.barLen) toks.push(...restTokens(t0 + rec.barLen - pos, rest));
    return toks.join(" ");
  });
  return lines;
}

const esc = (s) => String(s).replace(/\\/g, "").replace(/"/g, "'");
function lyricWord(w) { return /^[A-Za-z]+$/.test(w) ? w : `"${esc(w)}"`; }

function lyricsFor(rec) {
  const toks = [];
  rec.melody.forEach((n) => {
    let w = n.word || n.syl || "";
    if (/^i($|')/.test(w)) w = "I" + w.slice(1);
    if (n.lineStart && w) w = w[0].toUpperCase() + w.slice(1);
    const parts = hyphenate(w, n.of || 1);
    const piece = parts[n.part || 0] || "_";
    toks.push(lyricWord(piece) + ((n.part || 0) < (n.of || 1) - 1 ? " --" : ""));
  });
  return toks.join(" ");
}

function chordToken(sym, rec, dur) {
  const c = parseChord(sym, rec.key.mode);
  if (!c) return `s${dur}`;
  const root = spell(60 + ((rec.key.tonic + c.root) % 12), rec.ks);
  const name = lyName(root.L, root.acc);
  const q = c.dim ? ":dim" : c.minor ? (c.seventh === "7" ? ":m7" : ":m") : c.seventh === "7" ? ":7" : c.seventh === "maj7" ? ":maj7" : "";
  return `${name}${dur}${q}`;
}

function chordsMusic(rec) {
  const whole = DUR[rec.barLen] || "1";
  return rec.sections.flatMap((s) => s.chords).map((sym) => chordToken(sym, rec, whole)).join(" ");
}

function marksFor(rec) { const m = {}; rec.sections.forEach((s) => { m[s.startBar - 1] = s.name; }); return m; }

function keyLine(rec) { const s = spell(60 + rec.key.tonic, rec.ks); return `\\key ${lyName(s.L, s.acc)} \\${rec.key.mode}`; }
function globalBlock(rec) { return `global = {\n  ${keyLine(rec)}\n  \\time ${rec.beatsPerBar}/4\n  \\tempo 4 = ${rec.bpm}\n}`; }

function header(rec, sub) {
  return `\\header {\n  title = "${esc(rec.title)}"\n${sub ? `  subtitle = "${esc(sub)}"\n` : ""}${rec.writer ? `  composer = "Words and music: ${esc(rec.writer)}"\n` : ""}  tagline = ##f\n}`;
}

const VAR = (i) => "part" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[i];
function dynMap(rec, arr) {
  const m = {};
  rec.sections.forEach((sec, i) => { m[sec.startBar - 1] = arr.plan.dynamics[arr.roles[i]]; });
  return m;
}

function variables(rec) {
  const ks = rec.ks;
  const arr = arrangement(rec);
  const marks = marksFor(rec);
  const rel = { pos: 4 * 7 }; // c'
  const melodyEvents = rec.melody.map((n) => ({ t: n.t, dur: n.dur, p: n.p }));
  const melody = music(melodyEvents, rec, (e) => lyRel(e.p, ks, rel), { marks });
  const absChord = (e) => (e.ps.length > 1 ? `<${e.ps.map((p) => lyAbs(p, ks)).join(" ")}>` : lyAbs(e.ps[0], ks));
  const DR = { K: "bd", S: "sn", H: "hh", C: "cymc" };
  const bar = (ls) => ls.map((l) => `  ${l} |`).join("\n");
  const clef = rec.voiceName === "congregational" ? "treble" : rec.male ? "\"treble_8\"" : "treble";
  const melodyVar = rec.voiceName === "congregational"
    ? `melody = \\transpose c c' \\relative c' {\n  \\global \\clef ${clef}\n${bar(melody)}\n  \\bar "|."\n}`
    : `melody = \\relative c' {\n  \\global \\clef ${clef}\n${bar(melody)}\n  \\bar "|."\n}`;
  const parts = [];
  arr.layers.forEach((ly, i) => {
    const name = VAR(i);
    const dyn = dynMap(rec, arr);
    const clefFor = () => { const ps = ly.events.flatMap((e) => e.ps || []).sort((a, b) => a - b); return ly.kind === "bass" || (ps.length && ps[Math.floor(ps.length / 2)] < 57) ? "bass" : "treble"; };
    if (ly.kind === "drums") parts.push(`${name} = \\drummode {\n  \\time ${rec.beatsPerBar}/4\n${bar(music(ly.events, rec, (e) => (e.hits.length > 1 ? `<${e.hits.map((x) => DR[x]).join(" ")}>` : DR[e.hits[0]]), { dyn }))}\n  \\bar "|."\n}`);
    else if (ly.kind === "strum") parts.push(`${name} = {\n  \\global \\clef treble \\improvisationOn\n${bar(music(ly.events, rec, () => "b'", { dyn }))}\n  \\bar "|."\n}`);
    else if (ly.kind === "piano") {
      parts.push(`${name}Right = {\n  \\global \\clef treble\n${bar(music(ly.events.filter((e) => e.hand === "R"), rec, absChord, { dyn }))}\n  \\bar "|."\n}`);
      parts.push(`${name}Left = {\n  \\global \\clef bass\n${bar(music(ly.events.filter((e) => e.hand === "L"), rec, absChord))}\n  \\bar "|."\n}`);
    } else parts.push(`${name} = {\n  \\global \\clef ${clefFor()}\n${bar(music(ly.events, rec, absChord, { dyn }))}\n  \\bar "|."\n}`);
  });
  return [
    `\\version "2.24.0"`,
    `\\language "nederlands"`,
    globalBlock(rec),
    melodyVar,
    `words = \\lyricmode {\n  ${lyricsFor(rec)}\n}`,
    `harmonies = \\chordmode {\n  ${chordsMusic(rec)}\n}`,
    ...parts,
  ].join("\n\n");
}

function staffFor(rec, id) {
  if (id === "voice") return `\\new Staff \\with { instrumentName = "Voice" shortInstrumentName = "Vo." } { \\new Voice = "mel" { \\melody } }\n      \\new Lyrics \\lyricsto "mel" { \\words }`;
  const arr = arrangement(rec);
  const i = arr.layers.findIndex((l) => l.id === id);
  const ly = arr.layers[i];
  const nm = esc(ly.name), sh = esc(ly.name.slice(0, 3)) + ".";
  if (ly.kind === "drums") return `\\new DrumStaff \\with { instrumentName = "${nm}" shortInstrumentName = "${sh}" } { \\${VAR(i)} }`;
  if (ly.kind === "piano") return `\\new PianoStaff \\with { instrumentName = "${nm}" shortInstrumentName = "${sh}" } <<\n        \\new Staff { \\${VAR(i)}Right }\n        \\new Staff { \\${VAR(i)}Left }\n      >>`;
  return `\\new Staff \\with { instrumentName = "${nm}" shortInstrumentName = "${sh}" midiInstrument = "${MIDI_NAMES[ly.gm] || "acoustic grand"}" } { \\${VAR(i)} }`;
}
const MIDI_NAMES = { 0: "acoustic grand", 16: "drawbar organ", 22: "harmonica", 24: "acoustic guitar (nylon)", 25: "acoustic guitar (steel)", 27: "electric guitar (clean)", 32: "acoustic bass", 33: "electric bass (finger)", 40: "violin", 42: "cello", 43: "contrabass", 48: "string ensemble 1", 73: "flute" };

export function leadSheetLy(rec) {
  return `${variables(rec)}

\\book {
  \\bookOutputSuffix "lead-sheet"
  ${header(rec, "Lead sheet")}
  \\score {
    <<
      \\new ChordNames { \\harmonies }
      ${staffFor(rec, "voice")}
    >>
    \\layout { \\context { \\Score \\override BarNumber.break-visibility = ##(#f #t #t) } }
  }
}
`;
}

export function scoreAndPartsLy(rec) {
  const arr = arrangement(rec);
  const ids = ["voice", ...arr.layers.map((l) => l.id)];
  const names = { voice: "Voice", ...Object.fromEntries(arr.layers.map((l) => [l.id, l.name])) };
  const noteMarkup = (id) => {
    if (id === "voice") return "";
    const seen = new Set();
    const lines = rec.sections.filter((s) => { const k = s.name.replace(/\s*\d+$/, ""); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((s) => `\\line { \\bold "${esc(s.name.replace(/\s*\d+$/, ""))}:" "${esc(noteFor(rec, id, rec.sections.indexOf(s)))}" }`);
    return `\\markup \\column { ${lines.join(" ")} }`;
  };
  const kindOf = (id) => (arr.layers.find((l) => l.id === id) || { kind: "voice" }).kind;
  const partBook = (id) => `\\book {
  \\bookOutputSuffix "${id}"
  ${header(rec, names[id])}
  \\score {
    <<
      ${kindOf(id) !== "drums" ? "\\new ChordNames { \\harmonies }" : ""}
      \\compressMMRests { << ${staffFor(rec, id)} >> }
    >>
    \\layout { }
  }
  ${noteMarkup(id)}
  ${kindOf(id) === "bass" ? '\\markup \\italic "Written an octave higher than it sounds."' : ""}
}`;
  return `${variables(rec)}

\\book {
  \\bookOutputSuffix "score"
  ${header(rec, "Full score")}
  \\paper { #(set-paper-size "letter") }
  \\score {
    <<
      \\new ChordNames { \\harmonies }
      ${ids.map((id) => staffFor(rec, id)).join("\n      ")}
    >>
    \\layout { }
    \\midi { }
  }
}

${ids.map(partBook).join("\n\n")}
`;
}

// One file for everything: compiling it writes the lead sheet, the full score (with MIDI)
// and one PDF per part: lilypond "<file>.ly"
export function allLy(rec) {
  const lead = leadSheetLy(rec);
  const book = lead.slice(lead.indexOf("\\book {"));
  return `% ${esc(rec.title)}${rec.writer ? " - Words and music: " + esc(rec.writer) : ""}
% Engrave with LilyPond 2.24 or later:  lilypond "this-file.ly"
% It writes the lead sheet, the full score (and a MIDI file) and a part for each player.
% The band parts are a starting arrangement until the production notes are written.

${scoreAndPartsLy(rec)}
${book}`;
}

export { keySpelling };
