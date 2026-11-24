import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLexicon } from "../app/js/engine/lexicon.js";
import * as M from "../app/js/engine/melody.js";
import * as D from "../app/js/engine/docs.js";
import * as P from "../app/js/engine/production.js";

setLexicon(JSON.parse(readFileSync(new URL("../app/data/lexicon.json", import.meta.url))));
const LYRIC = `[Verse 1]
My father's boots still wait beside the kitchen door
The radio talks about rain and nobody listens

[Chorus]
I kept the house but lost the home
The lights are on and I'm alone

[Verse 2]
The garden grew over the path he made of stone
I sweep the steps at night because he would have too

[Chorus]

[Bridge]
I would trade every wall for one more supper
Call me in from the yard

[Chorus]`;
const base = { type: "V", q0: "The year after", harmony: { skel: { verse: ["I", "vi", "IV", "V"], chorus: ["IV", "I", "bVII", "V"], bridge: ["vi", "IV", "I", "V"] } }, contract: { key: "G major", voice: "male", bpm: 76, beatsPerBar: 4, barsPerLine: 2, title: "I kept the house but lost the home" } };

async function recFor(palette) {
  const song = palette ? { ...base, production: { plan: P.planFor(palette) } } : base;
  const b = M.makeBrief(song, LYRIC);
  const res = await M.search(b, { n: 300, seed: 6 });
  return D.buildRecord(res.top[0], b, song);
}

test("palettes follow 9.6: no pad leads, and the type picks the first", () => {
  for (const pal of Object.values(P.PALETTES)) assert.ok(!pal.layers.some((l) => l.kind === "fill" && [48, 52, 53, 54, 88, 89].includes(l.gm)), pal.name);
  assert.equal(P.suggestPalettes("W")[0], "worship");
  assert.equal(P.suggestPalettes("B")[0], "blues");
});

test("roles: verses, the final chorus, intro and tag", async () => {
  const rec = await recFor();
  const r = P.roles(rec);
  assert.equal(r[0], "intro");
  assert.equal(r[r.length - 1], "tag");
  assert.ok(r.includes("verse2"));
  assert.equal(r.filter((x) => x === "final").length, 1);
});

test("the designed silence: the band stops at the half bar before the final chorus", async () => {
  const rec = await recFor("band");
  const arr = D.arrangement(rec);
  assert.ok(arr.approachBar > 0);
  const t0 = arr.approachBar * rec.barLen, half = t0 + rec.barLen / 2, t1 = t0 + rec.barLen;
  const late = arr.layers.flatMap((l) => l.events).filter((e) => e.t < t1 && e.t + e.dur > half);
  assert.equal(late.length, 0);
});

test("9.12: the default plans have no inversions", async () => {
  for (const pal of ["band", "americana", "folk", "worship", "blues", "cinematic"]) {
    const rec = await recFor(pal);
    const arc = P.energyArc(rec, D.arrangement(rec));
    assert.deepEqual(arc.flags, [], pal);
    const fin = arc.rows.find((x) => x.role === "final"), ch = arc.rows.find((x) => x.role === "chorus");
    assert.ok(fin.energy > ch.energy, `${pal}: the final chorus is the top`);
  }
});

test("9.13: keys and strings are re-voiced above the voice at the key bars", async () => {
  const rec = await recFor("worship");
  const audit = P.registerAudit(rec, D.arrangement(rec));
  const crowded = audit.flatMap((x) => x.crowdedKeyBars);
  assert.equal(crowded.length, 0, `crowded key bars: ${crowded.join(", ")}`);
});

test("9.14: no second below C4 and no third below F3 in the piano voicings", async () => {
  const rec = await recFor("band");
  const keys = D.arrangement(rec).layers.find((l) => l.kind === "piano");
  keys.events.filter((e) => e.hand === "R").forEach((e) => {
    for (let i = 1; i < e.ps.length; i++) {
      const d = e.ps[i] - e.ps[i - 1];
      assert.ok(!(d <= 2 && e.ps[i - 1] < 60) && !(d <= 4 && e.ps[i - 1] < 53), `voicing ${e.ps}`);
    }
  });
});

test("the one-sheet has its five blocks and the songbook carries it", async () => {
  const rec = await recFor("folk");
  const book = D.songbook(rec, base);
  const ps = book.producer;
  assert.ok(ps.target.length > 0);
  assert.ok(Array.isArray(ps.references));
  assert.equal(ps.arc.length, rec.sections.length);
  assert.ok(ps.nonNegotiables.some((x) => /silence/.test(x)));
  assert.ok(ps.mix.length >= 3);
  assert.ok(book.session.chords.length === rec.sections.length);
});
