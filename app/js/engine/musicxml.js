// MusicXML 4.0 from the song record: every part of the arrangement, with chord symbols,
// lyrics, section marks, dynamics and tempo, so the song opens in MuseScore, Sibelius,
// Finale, Dorico or Logic with proper sounds and editable notation.
//
// Pitches are written as they sound, except the bass, which is written an octave up with a
// <transpose> so it plays in its real register. A male voice uses a treble clef with the 8.
// Strummed guitar is written as real chord voicings so it plays back.

import { spell, arrangement, hyphenate } from "./docs.js";
import { parseChord } from "./harmony.js";

const x = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TYPE = { 1: ["eighth", 0], 2: ["quarter", 0], 3: ["quarter", 1], 4: ["half", 0], 6: ["half", 1], 8: ["whole", 0], 12: ["whole", 1] };
function split(d) { const out = []; const o = [12, 8, 6, 4, 3, 2, 1]; while (d > 0) { const v = o.find((q) => q <= d); out.push(v); d -= v; } return out; }

function pitchXml(p, ks) {
  const s = spell(p, ks);
  return `<pitch><step>${s.L}</step>${s.acc ? `<alter>${s.acc}</alter>` : ""}<octave>${s.octave}</octave></pitch>`;
}

const KIND = (c) => (c.dim ? "diminished" : c.minor ? (c.seventh === "7" ? "minor-seventh" : "minor") : c.seventh === "7" ? "dominant" : c.seventh === "maj7" ? "major-seventh" : "major");
function harmonyXml(sym, rec) {
  const c = parseChord(sym, rec.key.mode);
  if (!c) return "";
  const r = spell(60 + ((rec.key.tonic + c.root) % 12), rec.ks);
  const k = KIND(c);
  const txt = { major: "", minor: "m", dominant: "7", diminished: "dim", "major-seventh": "maj7", "minor-seventh": "m7" }[k];
  return `<harmony><root><root-step>${r.L}</root-step>${r.acc ? `<root-alter>${r.acc}</root-alter>` : ""}</root><kind text="${txt}">${k}</kind></harmony>`;
}

const DRUM = { K: { step: "F", oct: 4, id: "K", name: "Bass Drum", midi: 36 }, S: { step: "C", oct: 5, id: "S", name: "Snare", midi: 38 }, H: { step: "G", oct: 5, id: "H", name: "Closed Hi-Hat", midi: 43, head: "x" }, C: { step: "A", oct: 5, id: "C", name: "Crash Cymbal", midi: 50, head: "x" } };

// Lay timed events into bars (ties across barlines); returns per-bar lists.
function intoBars(events, rec) {
  const { barLen, totalBars } = rec;
  const out = Array.from({ length: totalBars }, () => []);
  events.forEach((e) => {
    let t = e.t, d = e.dur, first = true;
    while (d > 0) {
      const b = Math.floor(t / barLen);
      if (b >= totalBars) break;
      const take = Math.min((b + 1) * barLen - t, d);
      out[b].push({ ...e, t, dur: take, tieIn: !first, tieOut: take < d });
      t += take; d -= take; first = false;
    }
  });
  return out.map((evs) => evs.sort((a, b) => a.t - b.t));
}

// One voice of one measure: notes and rests filling the bar.
function measureNotes(evs, b, rec, opts) {
  const { barLen } = rec;
  const t0 = b * barLen;
  let pos = t0;
  const out = [];
  const voice = opts.voice || 1, staff = opts.staff ? `<staff>${opts.staff}</staff>` : "";
  const rest = (d) => split(d).forEach((v) => { const [type, dot] = TYPE[v]; out.push(`<note><rest/><duration>${v}</duration><voice>${voice}</voice><type>${type}</type>${dot ? "<dot/>" : ""}${staff}</note>`); });
  if (!evs.length) { out.push(`<note><rest measure="yes"/><duration>${barLen}</duration><voice>${voice}</voice>${staff}</note>`); return out.join(""); }
  evs.forEach((e) => {
    if (e.t > pos) rest(e.t - pos);
    const pieces = split(e.dur);
    let start = e.t;
    pieces.forEach((v, i) => {
      const [type, dot] = TYPE[v];
      const tieStart = i < pieces.length - 1 || e.tieOut, tieStop = i > 0 || e.tieIn;
      const ties = `${tieStop ? '<tie type="stop"/>' : ""}${tieStart ? '<tie type="start"/>' : ""}`;
      const tied = tieStop || tieStart ? `<notations>${tieStop ? '<tied type="stop"/>' : ""}${tieStart ? '<tied type="start"/>' : ""}</notations>` : "";
      // beam eighths in pairs within a beat
      const beam = v === 1 ? (start % 2 === 0 ? "begin" : "end") : null;
      const pitches = e.drum ? e.drum : e.ps;
      pitches.forEach((p, k) => {
        const head = e.drum ? (DRUM[p].head ? `<notehead>${DRUM[p].head}</notehead>` : "") : "";
        const pitch = e.drum ? `<unpitched><display-step>${DRUM[p].step}</display-step><display-octave>${DRUM[p].oct}</display-octave></unpitched>` : pitchXml(p, rec.ks);
        const inst = e.drum ? `<instrument id="${opts.partId}-${DRUM[p].id}"/>` : "";
        const lyric = k === 0 && i === 0 && !e.tieIn && e.lyric ? `<lyric number="1"><syllabic>${e.lyric.syllabic}</syllabic><text>${x(e.lyric.text)}</text></lyric>` : "";
        out.push(`<note>${k > 0 ? "<chord/>" : ""}${pitch}<duration>${v}</duration>${ties}${inst}<voice>${voice}</voice><type>${type}</type>${dot ? "<dot/>" : ""}${e.drum ? '<stem>up</stem>' : ""}${head}${staff}${beam && k === 0 && pieces.length === 1 && !e.drum ? `<beam number="1">${beam}</beam>` : ""}${tied}${lyric}</note>`);
      });
      start += v;
    });
    pos = e.t + e.dur;
  });
  if (pos < t0 + barLen) rest(t0 + barLen - pos);
  return out.join("");
}

function syllables(rec) {
  return rec.melody.map((n) => {
    let w = n.word || n.syl || "";
    if (/^i($|')/.test(w)) w = "I" + w.slice(1);
    if (n.lineStart && w) w = w[0].toUpperCase() + w.slice(1);
    const of = n.of || 1, part = n.part || 0;
    if (of === 1) return { syllabic: "single", text: w };
    return { syllabic: part === 0 ? "begin" : part === of - 1 ? "end" : "middle", text: hyphenate(w, of)[part] || "" };
  });
}

export function musicXml(rec) {
  const arr = arrangement(rec);
  const ks = rec.ks;
  const fifths = Object.values(ks.sig).reduce((f, a) => f + (a === 1 ? 1 : a === -1 ? -1 : 0), 0);
  const marks = {}; const dyns = {};
  rec.sections.forEach((s, i) => { marks[s.startBar - 1] = s.name; dyns[s.startBar - 1] = arr.plan.dynamics[arr.roles[i]]; });
  const chords = rec.sections.flatMap((s) => s.chords);
  const sy = syllables(rec);

  const parts = [];
  parts.push({ id: "P1", name: "Voice", abbr: "Vo.", program: (arr.layers.find((l) => l.kind === "fill") || { gm: 73 }).gm, channel: 1,
    clef: rec.male ? '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' : '<clef><sign>G</sign><line>2</line></clef>',
    voices: [{ events: rec.melody.map((n, i) => ({ t: n.t, dur: n.dur, ps: [n.p], lyric: sy[i] })) }], chords: true, marks: true });
  let ch = 2;
  arr.layers.forEach((ly, i) => {
    const id = `P${i + 2}`;
    if (ly.kind === "drums") {
      parts.push({ id, name: ly.name, abbr: "Dr.", drums: true, channel: 10, clef: '<clef><sign>percussion</sign></clef>',
        voices: [{ events: ly.events.map((e) => ({ t: e.t, dur: e.dur, drum: e.hits })) }] });
      return;
    }
    if (ch === 10) ch++;
    const p = { id, name: ly.name, abbr: ly.name.slice(0, 3) + ".", program: ly.gm || 0, channel: ch++ };
    if (ly.kind === "piano") {
      p.staves = 2;
      p.clef = '<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>';
      p.voices = [{ staff: 1, voice: 1, events: ly.events.filter((e) => e.hand === "R").map((e) => ({ t: e.t, dur: e.dur, ps: e.ps })) }, { staff: 2, voice: 5, events: ly.events.filter((e) => e.hand === "L").map((e) => ({ t: e.t, dur: e.dur, ps: e.ps })) }];
    } else {
      const ps = ly.events.flatMap((e) => e.ps || []).sort((a, b) => a - b);
      const low = ly.kind === "bass" || (ps.length && ps[Math.floor(ps.length / 2)] < 57);
      p.clef = ly.kind === "strum" || ly.kind === "pick" ? '<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>' : low ? '<clef><sign>F</sign><line>4</line></clef>' : '<clef><sign>G</sign><line>2</line></clef>';
      if (ly.kind === "bass") p.transpose = "<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>";
      p.voices = [{ events: ly.events.map((e) => ({ t: e.t, dur: e.dur, ps: e.ps })) }];
    }
    parts.push(p);
  });

  const partList = parts.map((p) => p.drums
    ? `<score-part id="${p.id}"><part-name>${x(p.name)}</part-name><part-abbreviation>${x(p.abbr)}</part-abbreviation>${Object.values(DRUM).map((d) => `<score-instrument id="${p.id}-${d.id}"><instrument-name>${d.name}</instrument-name></score-instrument>`).join("")}${Object.values(DRUM).map((d) => `<midi-instrument id="${p.id}-${d.id}"><midi-channel>10</midi-channel><midi-unpitched>${d.midi}</midi-unpitched></midi-instrument>`).join("")}</score-part>`
    : `<score-part id="${p.id}"><part-name>${x(p.name)}</part-name><part-abbreviation>${x(p.abbr)}</part-abbreviation><score-instrument id="${p.id}-I1"><instrument-name>${x(p.name)}</instrument-name></score-instrument><midi-instrument id="${p.id}-I1"><midi-channel>${p.channel}</midi-channel><midi-program>${p.program + 1}</midi-program></midi-instrument></score-part>`).join("");

  const body = parts.map((p) => {
    const perVoice = p.voices.map((v) => intoBars(v.events, rec));
    const measures = [];
    for (let b = 0; b < rec.totalBars; b++) {
      let m = `<measure number="${b + 1}">`;
      if (b === 0) {
        m += `<attributes><divisions>2</divisions><key><fifths>${fifths}</fifths><mode>${rec.key.mode}</mode></key><time><beats>${rec.beatsPerBar}</beats><beat-type>4</beat-type></time>${p.staves ? `<staves>${p.staves}</staves>` : ""}${p.clef}${p.transpose || ""}</attributes>`;
        if (p.id === "P1") m += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${rec.bpm}</per-minute></metronome></direction-type><sound tempo="${rec.bpm}"/></direction>`;
      }
      if (p.marks && marks[b]) m += `<direction placement="above"><direction-type><rehearsal>${x(marks[b])}</rehearsal></direction-type></direction>`;
      if (!p.marks && dyns[b]) m += `<direction placement="below"><direction-type><dynamics><${dyns[b]}/></dynamics></direction-type>${p.staves ? "<staff>1</staff>" : ""}</direction>`;
      if (p.chords) m += harmonyXml(chords[b], rec);
      p.voices.forEach((v, vi) => {
        if (vi > 0) m += `<backup><duration>${rec.barLen}</duration></backup>`;
        m += measureNotes(perVoice[vi][b], b, rec, { voice: v.voice || 1, staff: v.staff, partId: p.id });
      });
      if (b === rec.totalBars - 1) m += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
      measures.push(m + "</measure>");
    }
    return `<part id="${p.id}">${measures.join("")}</part>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${x(rec.title)}</work-title></work>
<identification>${rec.writer ? `<creator type="composer">Words and music: ${x(rec.writer)}</creator>` : ""}<encoding><software>Luthier</software></encoding></identification>
<part-list>${partList}</part-list>
${body}
</score-partwise>
`;
}
