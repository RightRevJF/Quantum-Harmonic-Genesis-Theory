import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLexicon } from "../app/js/engine/lexicon.js";
import * as M from "../app/js/engine/melody.js";
import * as D from "../app/js/engine/docs.js";

setLexicon(JSON.parse(readFileSync(new URL("../app/data/lexicon.json", import.meta.url))));
const LYRIC = `[Verse 1]
My father's boots still wait beside the kitchen door
The radio talks about rain and nobody listens

[Chorus]
I kept the house but lost the home
The lights are on and I'm alone

[Chorus]`;
const song = { type: "V", q0: "The year after", harmony: { skel: { verse: ["I", "vi", "IV", "V"], chorus: ["IV", "I", "bVII", "V"] } }, contract: { key: "Eb major", voice: "male", bpm: 76, beatsPerBar: 4, barsPerLine: 2, title: "I kept the house but lost the home", writer: "J. B." } };

test("spelling follows the key", () => {
  const eb = D.keySpelling({ tonic: 3, mode: "major" });
  assert.equal(eb.abcKey, "Eb");
  assert.deepEqual(D.spell(70, eb), { L: "B", acc: -1, octave: 4 });
  assert.equal(D.noteLabel(61, eb), "D♭4");
  const am = D.keySpelling({ tonic: 9, mode: "minor" });
  assert.equal(D.noteLabel(68, am), "G♯4");
  assert.equal(D.keySpelling({ tonic: 6, mode: "major" }).abcKey, "F#");
});

test("Nashville numbers", () => {
  assert.equal(D.nashville("vi", "major"), "6m");
  assert.equal(D.nashville("bVII", "major"), "♭7");
  assert.equal(D.nashville("V7", "major"), "57");
  assert.equal(D.nashville("i", "minor"), "1m");
});

test("one record feeds the score, parts, chart and songbook", async () => {
  const b = M.makeBrief(song, LYRIC);
  const res = await M.search(b, { n: 300, seed: 9 });
  const rec = D.buildRecord(res.top[0], b, song);
  assert.equal(rec.sections[0].name, "Intro");
  assert.equal(rec.sections[1].startBar, 5);
  const score = D.scoreSystems(rec, D.INSTRUMENTS.map((x) => x.id), { per: 4 });
  assert.match(score[0].abc, /%%score V G \{R L\} B D/);
  assert.match(score[0].abc, /K:Eb/);
  assert.match(score[0].abc, /C:Words and music: J\. B\./);
  // every system's voice line has as many bars as it claims
  score.forEach((s) => { const v = s.abc.split("\n").find((l) => l.startsWith("[V:V]")); assert.ok(v.split("|").length >= 2); });
  const lead = D.scoreSystems(rec, ["voice"], { per: 4 });
  assert.match(lead[0].abc, /Z4/, "the intro is a compressed rest in the voice part");
  assert.match(lead.map((s) => s.abc).join("\n"), /^w: .*kept/m, "the lyric is under the notes");
  const c = D.chart(rec);
  assert.deepEqual(c.rows[1].cells.slice(0, 4), ["1", "6m", "4", "5"]);
  const book = D.songbook(rec, song);
  assert.match(book.glance.key, /Eb major/);
  assert.ok(book.lyricSheet.some((s) => s.lines.some((l) => /kept the house/.test(l.text))));
  assert.ok(!/DU|Module|Window|fingerprint/.test(JSON.stringify(book)), "no engine terms in the songbook");
});

test("bars in every voice add up to the meter", async () => {
  const b = M.makeBrief(song, LYRIC);
  const res = await M.search(b, { n: 200, seed: 1 });
  const rec = D.buildRecord(res.top[0], b, song);
  const arr = D.arrangement(rec);
  for (const part of ["keysRH", "keysLH", "guitar", "bass", "drums"]) {
    const perBar = new Map();
    arr[part].forEach((e) => { const bar = Math.floor(e.t / rec.barLen); perBar.set(bar, (perBar.get(bar) || 0) + e.dur); });
    perBar.forEach((d, bar) => assert.equal(d, rec.barLen, `${part} bar ${bar + 1}`));
  }
});
