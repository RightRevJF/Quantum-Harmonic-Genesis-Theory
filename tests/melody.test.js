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

test("the voice row: a picked row is used as is; an older free-text voice reads the key note", () => {
  const b1 = M.makeBrief({ type: "P", contract: { voice: "female", key: "A major" } }, "[Verse]\nla la la la");
  assert.equal(b1.voiceName, "female");
  const b2 = M.makeBrief({ type: "P", contract: { voice: "Clear, steady, bright", key: "A major (clear female voice)" } }, "[Verse]\nla la la la");
  assert.equal(b2.voiceName, "female");
});

test("rhythm and phrasing sit inside the spec's real-song bands (Windows 25, 30, 79; Table GK)", async () => {
  const b = M.makeBrief(song("V"), LYRIC);
  const res = await M.search(b, { n: 300, seed: 21 });
  const strongShare = [], lastNote = [], restAfter = [], peak = [];
  res.top.forEach((t) => t.sections.filter((s) => !s.repeat).forEach((s) => {
    const syl = s.notes.filter((n) => !n.melisma);
    const strong = syl.filter((n) => n.onset % 8 === 0 || n.onset % 8 === 4);
    if (strong.length) strongShare.push(strong.filter((n) => n.stress > 0).length / strong.length);
    s.lines.forEach((l, li) => {
      const ns = l.notes, last = ns[ns.length - 1];
      lastNote.push(last.dur);
      const next = s.lines[li + 1] ? s.lines[li + 1].notes[0].onset : l.start + l.slot;
      restAfter.push(next - (last.onset + last.dur));
      const top = Math.max(...ns.map((n) => n.p));
      peak.push(ns.findIndex((n) => n.p === top) / Math.max(1, ns.length - 1));
      assert.ok(next - (last.onset + last.dur) >= 2, "every line leaves at least a beat to breathe");
    });
    assert.match(s.form, /^[A-D]+$/);
  }));
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(mean(strongShare) > 0.55 && mean(strongShare) < 0.92, `stressed on strong beats ${mean(strongShare)}: near the real 0.78, not pinned`);
  assert.ok(med(lastNote) >= 1 && med(lastNote) <= 3, "a line's last note is about a quarter");
  assert.ok(med(restAfter) >= 3 && med(restAfter) <= 6, `the rest after a line is about two beats (${med(restAfter)} eighths)`);
  assert.ok(med(peak) <= 0.35, "the line peaks early");
});

test("the chorus's last line comes home to the tonic (27.20's answered pair)", async () => {
  const b = M.makeBrief(song("V"), LYRIC);
  let home = 0, total = 0;
  for (let i = 0; i < 60; i++) {
    const c = M.buildCandidate(b, 33, i);
    const ch = c.sections.find((s) => s.kind === "chorus");
    const last = ch.lines[ch.lines.length - 1].notes.filter((n) => !n.melisma).pop();
    if (last.money) continue;
    total++; if (M.degreeOf(last.p, b.key) === 1) home++;
  }
  assert.ok(home / total > 0.8, `${home}/${total}`);
});

test("Rule C4: a chorus that returns with changed words keeps its melody", async () => {
  const lyric = LYRIC + `\n\n[Chorus]\nI kept the house but lost the home\nThe lights are low and I'm alone\nI kept the house but lost the home\nEvery room an echo of you though`;
  const b = M.makeBrief(song("V"), lyric);
  for (let i = 0; i < 20; i++) {
    const c = M.buildCandidate(b, 77, i);
    const ch = c.sections.filter((s) => s.kind === "chorus");
    const first = ch[0], final = ch[ch.length - 1];
    assert.equal(final.repeat, undefined, "the final chorus is built, not a plain repeat");
    // unchanged lines are copied note for note
    [0, 2, 3].forEach((li) => assert.deepEqual(final.lines[li].notes.map((n) => n.p), first.lines[li].notes.map((n) => n.p), `line ${li + 1}`));
    assert.notEqual(final.lines[1].how, "new", "the changed line follows the first chorus");
  }
});
