import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLexicon } from "../app/js/engine/lexicon.js";
import * as M from "../app/js/engine/melody.js";
import * as F from "../app/js/engine/floor.js";
import { analyzeLyric } from "../app/js/engine/lyric.js";

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
const song = { type: "V", contract: { key: "G major", voice: "male", bpm: 76, beatsPerBar: 4, barsPerLine: 2, title: "I kept the house but lost the home" } };

test("the floor reads alignment, breath, cadence, form and fatigue", async () => {
  const b = M.makeBrief(song, LYRIC);
  const res = await M.search(b, { n: 400, seed: 2 });
  const f = F.floorReport(res.top[0], b, analyzeLyric(LYRIC, { title: song.contract.title }));
  const groups = new Set(f.checks.map((c) => c.group));
  for (const g of ["Alignment", "Breath", "Cadence", "Rhyme", "Tempo", "Form", "Density", "Fatigue"]) assert.ok(groups.has(g), g);
  const align = f.checks.find((c) => c.name.startsWith("Stressed syllables"));
  assert.ok(align.value >= 0.444, "the rhythm writer puts stress on strong beats");
  assert.equal(f.checks.find((c) => c.name === "Choruses").value, 2);
});

test("a breathless phrase is under the floor", () => {
  const b = M.makeBrief(song, LYRIC);
  const notes = Array.from({ length: 20 }, (_, i) => ({ p: 60, onset: i, dur: 1, stress: i % 2 ? 0 : 1, reduced: false, chord: "I", line: 0 }));
  const sec = { name: "Verse 1", kind: "verse", notes, lines: [{ notes, text: "x", start: 0, slot: 24 }], length: 24, loop: ["I"] };
  const f = F.floorReport({ sections: [sec] }, b, null);
  assert.equal(f.finished, false);
  assert.ok(f.checks.some((c) => c.group === "Breath" && c.level === "floor"));
});
