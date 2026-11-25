import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLexicon } from "../app/js/engine/lexicon.js";
import * as M from "../app/js/engine/melody.js";

setLexicon(JSON.parse(readFileSync(new URL("../app/data/lexicon.json", import.meta.url))));

const LYRIC = `[Verse 1]
My father's boots still wait beside the kitchen door
The radio talks about rain and nobody listens
He left his coffee cup upon the window sill
I keep the porch light burning like he's coming home

[Chorus]
I kept the house but lost the home
The lights are on and I'm alone
I kept the house but lost the home
Every room an echo of you though

[Verse 2]
The garden grew over the path he made of stone
I sweep the steps at night because he would have too
And somewhere in the attic there's a box of letters
I haven't opened one I leave them where they are

[Chorus]`;
const song = (type, key = "G major", voice = "male") => ({ type, contract: { key, voice, bpm: 76, beatsPerBar: 4, barsPerLine: 2, title: "I kept the house but lost the home" } });

test("keys, chords and voice rows parse", () => {
  assert.deepEqual(M.parseKey("A minor"), { tonic: 9, mode: "minor", name: "A minor" });
  assert.equal(M.parseKey("Bb").tonic, 10);
  assert.deepEqual(M.chordTones("V", "minor").tones, [7, 11, 2]);
  assert.deepEqual(M.chordTones("bVII", "major").tones, [10, 2, 5]);
  assert.equal(M.voiceRow("female, clear"), "female");
  assert.equal(M.voiceRow("", "W"), "male worship");
});

test("beta: white noise is low, a random walk is high", () => {
  const r = M.rng(7);
  const white = Array.from({ length: 256 }, () => r());
  let x = 0; const walk = Array.from({ length: 256 }, () => (x += r() - 0.5));
  assert.ok(M.betaPitch(white) < 0.5);
  assert.ok(M.betaPitch(walk) > 1.5);
});

test("the search is repeatable and its order is fingerprinted", async () => {
  const b = M.makeBrief(song("V"), LYRIC);
  const a1 = await M.search(b, { n: 300, seed: 99 });
  const a2 = await M.search(b, { n: 300, seed: 99 });
  assert.equal(a1.fingerprint, a2.fingerprint);
  assert.deepEqual(a1.top.map((t) => t.id), a2.top.map((t) => t.id));
  assert.ok(a1.survivors > 0, "some candidates survive");
  assert.equal(a1.built + a1.unbuildable, 300);
});

test("survivors keep Table A for their type", async () => {
  for (const type of ["V", "A", "L", "W"]) {
    const b = M.makeBrief(song(type), LYRIC);
    const res = await M.search(b, { n: 400, seed: 5 });
    assert.ok(res.survivors > 0, `${type} has survivors`);
    for (const t of res.top) {
      const all = t.sections.flatMap((s) => s.notes.map((n) => n.p));
      let leap = 0; t.sections.forEach((s) => s.notes.forEach((n, i) => { if (i) leap = Math.max(leap, Math.abs(n.p - s.notes[i - 1].p)); }));
      assert.ok(leap <= b.row.maxLeap, `${type} leap ${leap}`);
      assert.ok(Math.max(...all) <= b.voice.touch && Math.min(...all) >= b.voice.floor, `${type} in the voice`);
    }
  }
});

test("the hook is written from the title: peak and held money note", async () => {
  const b = M.makeBrief(song("V"), LYRIC);
  const res = await M.search(b, { n: 300, seed: 3 });
  const hook = res.top[0].sections.find((s) => s.kind === "chorus");
  const peak = hook.notes.find((n) => n.peak), money = hook.notes.find((n) => n.money);
  assert.equal(peak.syl, "kept");
  assert.equal(money.syl, "home");
  assert.ok(money.dur >= 3, "money syllable held 1.5 beats or more");
  assert.ok([1, 3, 5].includes(M.degreeOf(money.p, b.key)), "money note on a stable degree");
});

test("melisma (27.12): turns in the hook only, a step away, never on the held title or the last word", async () => {
  const b = M.makeBrief(song("V"), LYRIC);
  let turns = 0, held = 0, down = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const res = await M.search(b, { n: 150, seed });
    res.top.forEach((t) => t.sections.filter((s) => !s.repeat).forEach((s) => {
      const ms = s.notes.filter((n) => n.melisma);
      if (s.kind !== "chorus") assert.equal(ms.length, 0, "no melisma outside the hook");
      s.notes.forEach((n, i) => {
        if (!n.melisma) { if (s.kind === "chorus" && (n.dur >= 3 || s.notes[i + 1]?.melisma)) held++; return; }
        const prev = s.notes[i - 1];
        assert.ok(prev.slurStart && n.slurEnd, "slurred pair");
        assert.ok(Math.abs(n.p - prev.p) <= 2 && n.p !== prev.p, "a step");
        assert.ok(!prev.money, "not on the held title note");
        if (n.p < prev.p) down++;
        turns++;
      });
      const last = s.lines[s.lines.length - 1].notes;
      if (s.kind === "chorus") assert.ok(!last[last.length - 1].melisma, "the last word keeps one note");
    }));
  }
  assert.ok(turns > 0, "some turns are written");
  assert.ok(down / turns >= 0.5, `mostly down (${down}/${turns})`);
});
