// The floor on the finished song (Table G, Windows 29-30), with the density of every line
// on the pick's own onsets (Window 36) and tessitura fatigue over the whole form (11.13).
// A song under the alignment or breath floor is not finished; everything else is a report.

import { degreeOf } from "./melody.js";

export const TABLE_G = {
  stressedOnStrong: { median: 0.783, floor: 0.444 },
  unstressedOnStrong: { median: 0.097 },
  reducedOnHeld: { median: 0.154 },
  peakPosition: { median: 0.31 },
  phraseSyllables: { median: 4.0, p90: 11.0, p95: 15.0 },
  phraseBeats: { median: 3.5, p95: 9.49 },
  melisma: { median: 0.122 },
  cadence: { verseClosed: [0.63, 0.66], verseTonic: [0.35, 0.36], chorusClosed: [0.67, 0.74], chorusTonic: [0.41, 0.48], phraseClosed: 0.57 },
  rhyme: { median: 0.46, floor: 0.25 },
  tempo: { median: 104, mid: [88, 120], usual: [60, 160] },
  firstChorus: [13, 28], choruses: [2, 4], sectionBars: 8, intro: 4, bridgeRatio: [0.64, 1.25],
};
// Module 11.13 / Window 35 bands (beats)
export const FATIGUE = {
  upperShare: { median: 0.357, p90: 0.579, p95: 0.653 },
  runAboveMid: { median: 11.763, p90: 29.0, p95: 36.095 },
  runUpper: { median: 7.304, p90: 16.998, p95: 23.017 },
  upperIn16: { median: 22.563, p90: 38.374, p95: 44.613 },
  restPer8: { median: 10.704 },
};
const SPS = { median: 2.481, p95: 4.762, p99: 6.4 };

const r2 = (x) => Math.round(x * 100) / 100;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// cand: a built candidate (sections with notes relative to the section); brief: the melody brief;
// lyricResult: analyzeLyric(...) for the rhyme reading.
export function floorReport(cand, brief, lyricResult) {
  const barLen = brief.beatsPerBar * 2; // eighths per bar
  const beatSec = 60 / brief.bpm;
  const strongPos = brief.beatsPerBar === 4 ? [0, 4] : brief.beatsPerBar === 6 ? [0, 6] : [0];
  const checks = [];
  const add = (c) => checks.push(c);

  // lay the form end to end
  const notes = [];
  let t = 0;
  const secs = [];
  cand.sections.forEach((sec, si) => {
    const bars = Math.ceil(sec.length / barLen);
    secs.push({ name: sec.name, kind: sec.kind, start: t, bars, sec });
    sec.notes.forEach((n) => notes.push({ ...n, t: t + n.onset, si, kind: sec.kind, section: sec.name }));
    t += bars * barLen;
  });
  const totalBars = t / barLen;

  // --- alignment (Window 30, Finding 1) ---
  const syl = notes.filter((n) => !n.melisma); // one entry per sung syllable
  const strong = syl.filter((n) => strongPos.includes(n.onset % barLen));
  const stressedStrong = strong.length ? strong.filter((n) => n.stress > 0).length / strong.length : 1;
  const unstressed = syl.filter((n) => !(n.stress > 0));
  const unstressedStrong = unstressed.length ? unstressed.filter((n) => strongPos.includes(n.onset % barLen)).length / unstressed.length : 0;
  const held = syl.filter((n) => n.dur >= 2);
  const reducedHeld = held.length ? held.filter((n) => n.reduced).length / held.length : 0;
  const lines = [];
  cand.sections.filter((s) => !s.repeat).forEach((sec) => sec.lines.forEach((l) => lines.push({ sec, l })));
  const peaks = lines.filter(({ l }) => l.notes.length > 1).map(({ l }) => {
    const top = Math.max(...l.notes.map((n) => n.p));
    return l.notes.findIndex((n) => n.p === top) / (l.notes.length - 1);
  });
  const peakPos = median(peaks);
  add({ group: "Alignment", name: "Stressed syllables on strong beats", value: r2(stressedStrong), band: `real median 0.783, floor 0.444`, level: stressedStrong < TABLE_G.stressedOnStrong.floor ? "floor" : "pass", fix: "Move a stressed syllable onto beat 1 or 3, or search again." });
  add({ group: "Alignment", name: "Unstressed syllables on strong beats", value: r2(unstressedStrong), band: "real median 0.097", level: "info" });
  add({ group: "Alignment", name: "Reduced vowels on held notes", value: r2(reducedHeld), band: "real median 0.154", level: reducedHeld > 0.3 ? "flag" : "info" });
  add({ group: "Alignment", name: "Where the line's high note falls", value: r2(peakPos), band: "real median 0.31 of the way through (early)", level: "info" });

  // --- breath (Finding 2): a phrase ends at a rest of half a beat or a held note of two beats ---
  const sorted = [...notes].sort((a, b) => a.t - b.t);
  const phrases = [];
  let cur = [];
  sorted.forEach((n, i) => {
    cur.push(n);
    const next = sorted[i + 1];
    const gap = next ? next.t - (n.t + n.dur) : Infinity;
    if (n.dur >= 4 || gap >= 1) { phrases.push(cur); cur = []; }
  });
  if (cur.length) phrases.push(cur);
  const pSyl = phrases.map((p) => p.filter((n) => !n.melisma).length);
  const pBeats = phrases.map((p) => (p[p.length - 1].t + p[p.length - 1].dur - p[0].t) / 2);
  const longSyl = phrases.filter((p) => p.filter((n) => !n.melisma).length > TABLE_G.phraseSyllables.p95);
  const longBeat = phrases.filter((p, i) => pBeats[i] > TABLE_G.phraseBeats.p95);
  const longest = phrases.reduce((a, p, i) => (pBeats[i] > a.b ? { b: pBeats[i], p } : a), { b: 0, p: null });
  add({ group: "Breath", name: "Syllables per phrase", value: `median ${median(pSyl)}, longest ${Math.max(...pSyl)}`, band: "real median 4, p95 15", level: longSyl.length ? "floor" : "pass",
    where: longSyl.length ? `${longSyl[0][0].section}, bar ${Math.floor(longSyl[0][0].t / barLen) + 1}` : null, fix: "Add a rest of half a beat, or hold a note for two beats." });
  add({ group: "Breath", name: "Phrase length in beats", value: `median ${r2(median(pBeats))}, longest ${r2(longest.b)}`, band: "real median 3.5, p95 9.49", level: longBeat.length ? "floor" : "pass",
    where: longBeat.length ? `${longBeat[0][0].section}, bar ${Math.floor(longBeat[0][0].t / barLen) + 1}` : null, fix: "Give the singer a breath: a rest of half a beat inside the phrase." });

  // --- melisma (Finding 3) ---
  const turns = notes.filter((n) => n.melisma).length;
  add({ group: "Melisma", name: "Syllables with two or more notes", value: r2(syl.length ? turns / syl.length : 0), band: "real 0.122 (line ends 0.169); the hook carries it, the verse none", level: "info" });

  // --- cadence (Finding 4) ---
  const firstOf = (kind) => cand.sections.find((s) => s.kind === kind && !s.repeat);
  const lastDeg = (sec) => (sec && sec.notes.length ? degreeOf(sec.notes[sec.notes.length - 1].p, brief.key) : null);
  const vDeg = lastDeg(firstOf("verse")), cDeg = lastDeg(firstOf("chorus"));
  const closed = (d) => [1, 3, 5].includes(d);
  if (vDeg) add({ group: "Cadence", name: "The verse ends on", value: `degree ${vDeg}${vDeg === 1 ? " (tonic)" : closed(vDeg) ? " (closed)" : " (open)"}`, band: "real: closed 63–66%, tonic 35–36%", level: "info" });
  if (cDeg) add({ group: "Cadence", name: "The chorus ends on", value: `degree ${cDeg}${cDeg === 1 ? " (tonic)" : closed(cDeg) ? " (closed)" : " (open)"}`, band: "real: closed 67–74%, tonic 41–48%", level: "info" });
  const lineEnds = lines.map(({ l }) => (l.notes.length ? degreeOf(l.notes[l.notes.length - 1].p, brief.key) : null)).filter(Boolean);
  const lineClosed = lineEnds.length ? lineEnds.filter(closed).length / lineEnds.length : 0;
  add({ group: "Cadence", name: "Phrase endings closed (1, 3 or 5)", value: r2(lineClosed), band: "real 0.57", level: "info" });

  // --- rhyme ---
  if (lyricResult) {
    const blocks = lyricResult.sections.filter((s) => s.rhyme && s.lines.length >= 2);
    const full = blocks.length ? blocks.reduce((a, s) => a + s.rhyme.full * s.lines.length, 0) / blocks.reduce((a, s) => a + s.lines.length, 0) : 0;
    const anyLoose = blocks.some((s) => s.rhyme.loose > 0);
    add({ group: "Rhyme", name: "Full-rhyme density", value: r2(full), band: "real 0.46; floor about 0.25 or loose rhyme present", level: full < TABLE_G.rhyme.floor && !anyLoose ? "flag" : "pass" });
  }

  // --- tempo (Finding 5) ---
  add({ group: "Tempo", name: "Tempo", value: `${brief.bpm} BPM`, band: "sung pop median 104 (middle half 88–120); unusual outside 60–160", level: brief.bpm < 60 || brief.bpm > 160 ? "flag" : "info" });

  // --- form (Window 29, 27.12) ---
  const chorusStarts = secs.filter((s) => s.kind === "chorus");
  const firstChorusBar = chorusStarts.length ? TABLE_G.intro + chorusStarts[0].start / barLen + 1 : null;
  if (firstChorusBar !== null) add({ group: "Form", name: "First chorus arrives at bar", value: firstChorusBar, band: "13–28 (median 20), counting a 4-bar intro", level: firstChorusBar < 13 || firstChorusBar > 28 ? "flag" : "pass" });
  add({ group: "Form", name: "Choruses", value: chorusStarts.length, band: "2–4 (median 3)", level: chorusStarts.length < 2 || chorusStarts.length > 4 ? "flag" : "pass" });
  const vBars = secs.find((s) => s.kind === "verse")?.bars, bBars = secs.find((s) => s.kind === "bridge")?.bars;
  secs.filter((s, i) => secs.findIndex((x) => x.kind === s.kind) === i).forEach((s) => add({ group: "Form", name: `${s.name.replace(/\s*\d+$/, "")} length`, value: `${s.bars} bars`, band: "real sections run 8 bars at the median (Billboard verses 12)", level: "info" }));
  if (vBars && bBars) { const ratio = bBars / vBars; add({ group: "Form", name: "Bridge against verse length", value: r2(ratio), band: "0.64–1.25 (median 1.0)", level: ratio < 0.64 || ratio > 1.25 ? "flag" : "pass" }); }
  add({ group: "Form", name: "Song length", value: `${totalBars + TABLE_G.intro} bars, ${Math.round(((totalBars + TABLE_G.intro) * brief.beatsPerBar * beatSec) / 6) / 10} minutes`, band: "with a 4-bar intro", level: "info" });

  // --- density on the pick's own onsets (Window 36) ---
  const sps = lines.filter(({ l }) => l.notes.length > 1).map(({ sec, l }) => {
    const span = (l.notes[l.notes.length - 1].onset - l.notes[0].onset) * beatSec / 2;
    return { s: span > 0 ? (l.notes.filter((n) => !n.melisma).length - 1) / span : 0, sec: sec.name, text: l.text };
  });
  const fast = sps.filter((x) => x.s > SPS.p99);
  add({ group: "Density", name: "Syllables a second on the melody", value: `median ${r2(median(sps.map((x) => x.s)))}, fastest ${r2(Math.max(0, ...sps.map((x) => x.s)))}`, band: "real median 2.48, p95 4.76, ceiling 6.4", level: fast.length ? "flag" : "info", where: fast.length ? `${fast[0].sec}: ${fast[0].text}` : null });

  // --- tessitura fatigue (11.13), against the voice's comfortable range ---
  const lo = brief.voice.floor, hi = brief.voice.ceil, range = hi - lo;
  const mid = lo + range / 2, upper = lo + (range * 2) / 3;
  const sung = sorted.reduce((a, n) => a + n.dur, 0);
  const upperDur = sorted.filter((n) => n.p >= upper).reduce((a, n) => a + n.dur, 0);
  const upperShare = sung ? upperDur / sung : 0;
  const run = (test) => {
    let best = 0, curRun = 0, endPrev = null, at = 0, startAt = 0;
    sorted.forEach((n) => {
      const gap = endPrev === null ? 0 : n.t - endPrev;
      if (!test(n) || gap >= 4) { if (curRun > best) { best = curRun; at = startAt; } curRun = 0; }
      if (test(n)) { if (curRun === 0) startAt = n.t; curRun += n.dur + (gap < 4 && curRun > 0 ? gap : 0); }
      endPrev = n.t + n.dur;
    });
    if (curRun > best) { best = curRun; at = startAt; }
    return { beats: best / 2, bar: Math.floor(at / barLen) + 1 };
  };
  const aboveMid = run((n) => n.p > mid), inUpper = run((n) => n.p >= upper);
  let most16 = 0, most16Bar = 1;
  for (let b = 0; b < totalBars; b++) {
    const w0 = b * barLen, w1 = w0 + 16 * barLen;
    const u = sorted.filter((n) => n.t >= w0 && n.t < w1 && n.p >= upper).reduce((a, n) => a + n.dur, 0) / 2;
    if (u > most16) { most16 = u; most16Bar = b + 1; }
  }
  const restPer8 = totalBars ? ((totalBars * barLen - sung) / 2) / (totalBars / 8) : 0;
  const lvl = (v, band) => (v > band.p95 ? "flag" : v > band.p90 ? "info" : "pass");
  const REM = "A rest of two beats, a bar below the midpoint, or the repeat of the line handed to a backing voice.";
  add({ group: "Fatigue", name: "Sung time in the upper third", value: r2(upperShare), band: "real median 0.357, p90 0.579, p95 0.653", level: lvl(upperShare, FATIGUE.upperShare), fix: upperShare > FATIGUE.upperShare.p90 ? REM : undefined });
  add({ group: "Fatigue", name: "Longest run above the midpoint", value: `${r2(aboveMid.beats)} beats`, band: "real median 11.8, p90 29, p95 36.1", level: lvl(aboveMid.beats, FATIGUE.runAboveMid), where: aboveMid.beats > FATIGUE.runAboveMid.p90 ? `from bar ${aboveMid.bar}` : null, fix: aboveMid.beats > FATIGUE.runAboveMid.p90 ? REM : undefined });
  add({ group: "Fatigue", name: "Longest run in the upper third", value: `${r2(inUpper.beats)} beats`, band: "real median 7.3, p90 17.0, p95 23.0", level: lvl(inUpper.beats, FATIGUE.runUpper), where: inUpper.beats > FATIGUE.runUpper.p90 ? `from bar ${inUpper.bar}` : null, fix: inUpper.beats > FATIGUE.runUpper.p90 ? REM : undefined });
  add({ group: "Fatigue", name: "Most upper-third beats in any 16 bars", value: r2(most16), band: "real median 22.6, p90 38.4, p95 44.6", level: lvl(most16, FATIGUE.upperIn16), where: most16 > FATIGUE.upperIn16.p90 ? `bars ${most16Bar}–${most16Bar + 15}` : null });
  add({ group: "Fatigue", name: "Rest beats per 8 bars", value: r2(restPer8), band: "real median 10.7 (a third of the time)", level: "info" });
  secs.filter((s, i) => secs.findIndex((x) => x.name === s.name) === i).forEach((s) => {
    const ns = s.sec.notes;
    const beats = ns.reduce((a, n) => a + n.dur, 0) / 2;
    const up = ns.filter((n) => n.p >= upper).reduce((a, n) => a + n.dur, 0) / 2;
    if (beats >= 16 && up / beats >= 0.6) add({ group: "Fatigue", name: `${s.name} sits high`, value: `${Math.round((up / beats) * 100)}% of ${r2(beats)} sung beats in the upper third`, band: "flagged at 60% of 16+ beats", level: "flag", fix: REM });
  });

  const floors = checks.filter((c) => c.level === "floor");
  return { checks, finished: floors.length === 0, floors: floors.length, flags: checks.filter((c) => c.level === "flag").length };
}
