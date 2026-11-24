import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setLexicon, lookup } from "../app/js/engine/lexicon.js";
import { analyzeLyric, parseSheet, tokenize, measureCandidate } from "../app/js/engine/lyric.js";
import { scoreTriage, QUESTIONS } from "../app/js/engine/triage.js";

setLexicon(JSON.parse(readFileSync(new URL("../app/data/lexicon.json", import.meta.url))));

const SONG = `[Verse 1]
He pours the same pot every morning six forty-two
The radio talks about rain and nobody listens
My father's boots still wait beside the kitchen door
I kept the house but I could not keep it

[Chorus]
I kept the house but lost the home
The lights are on and I'm alone
I kept the house but lost the home
Every room an echo of your name

[Verse 2]
The garden grew over the path he made of stone
Strict strengths of a quiet that I never chose
I sweep the porch at night because he would have >
And somewhere in the attic there's a box of letters

[Chorus]

[Bridge]
I would trade every wall for one more supper
With the window open and you laughing
I would burn it to the ground to hear you
Call me in from the yard
One more time

[Chorus]`;

const run = (o = {}) => analyzeLyric(SONG, { title: "I kept the house but lost the home", bpm: 76, ...o });
const rules = (r, name) => r.findings.filter((f) => f.rule.startsWith(name));

test("lexicon gives syllables, frequency and concreteness", () => {
  const d = lookup("door");
  assert.equal(d.syllables, 1);
  assert.ok(d.conc >= 4.5);
  assert.ok(d.zipf > 4);
  assert.equal(lookup("unbelievable").syllables, 5);
  assert.equal(lookup("doors").known, true);
});

test("tokenize keeps contractions and dropped-g forms", () => {
  assert.deepEqual(tokenize("I'm walkin' home, ain't it?"), ["i'm", "walkin'", "home", "ain't", "it"]);
});

test("sheet parsing expands repeated sections in sung order", () => {
  const s = parseSheet(SONG);
  assert.deepEqual(s.map((x) => x.kind), ["verse", "chorus", "verse", "chorus", "bridge", "chorus"]);
  assert.equal(s[3].ref, true);
  assert.equal(s[3].lines.length, 4);
});

test("headerless sheets: repeated blocks read as chorus (Window 27)", () => {
  const s = parseSheet("a door in the rain\nthe kettle on\n\nhold me home\nhold me home\n\nthe car in the drive\nthe radio low\n\nhold me home\nhold me home");
  assert.equal(s[1].kind, "chorus");
  assert.equal(s[0].kind, "verse");
});

test("weak line ending is a floor, lifted by the build-line mark", () => {
  const r = run();
  const weak = rules(r, "Weak line ending");
  assert.equal(weak.length, 1);
  assert.match(weak[0].message, /"it"/);
  // 'have >' is prospective and is not flagged
  assert.ok(!weak.some((f) => /have/.test(f.message)));
});

test("tongue-twister boundary of five consonants (10.7)", () => {
  const r = run();
  const t = rules(r, "Mouth test: consonant cluster").find((f) => f.level === "flag");
  assert.match(t.message, /strict strengths/);
});

test("convergence word must end open or on a liquid (Rule C2)", () => {
  const r = run();
  assert.match(rules(r, "Rule C2")[0].message, /"name"/);
  const ok = analyzeLyric("[Chorus]\nhold me now\nhold me close\nhold me now\nhold me home and let me go", {});
  assert.equal(rules(ok, "Rule C2").filter((f) => f.level === "flag").length, 0);
});

test("bridge over four lines is flagged; title counted across the sung song", () => {
  const r = run();
  assert.equal(rules(r, "Bridge length").length, 1);
  assert.equal(r.metrics.titleCount, 6);
  assert.equal(r.metrics.hookSyllables, 8);
});

test("never-say list is a floor", () => {
  const r = run({ neverSay: ["kitchen door"] });
  assert.equal(rules(r, "Never-say").length, 1);
});

test("Rule V1 reads the couplet; abstract verse pair fails", () => {
  const r = analyzeLyric("[Verse]\nI felt so lost and alone\nnothing made sense to me anymore\n\n[Chorus]\nhold on\nhold on", {});
  assert.equal(rules(r, "Rule V1").length, 2);
  const c = analyzeLyric("[Verse]\nI felt so lost and alone\nthe kettle cold upon the stove\n", {});
  assert.equal(rules(c, "Rule V1").length, 0);
});

test("density past the articulation ceiling (Window 36)", () => {
  const r = analyzeLyric("[Verse]\nunbelievably complicated information everywhere around the corner tonight", { bpm: 160, barsPerLine: 1 });
  assert.equal(rules(r, "Mouth test: density")[0].level, "floor");
});

test("candidate lines get notes", () => {
  const c = measureCandidate("I gave my heart to the", "verse");
  assert.ok(c.notes.some((n) => n.startsWith("weak ending")));
});

test("triage routes a clear paradox", () => {
  const r = scoreTriage({ Q1: 2, Q2: 1, Q3: 3, Q4: 1 });
  assert.equal(r.ranked[0].type, "P");
  assert.ok(r.clear);
});

test("triage routes an anthem and drops it for one voice", () => {
  const a = scoreTriage({ Q1: 0, Q2: 4, Q3: 1, Q4: 0, Q5: 2 });
  assert.equal(a.ranked[0].type, "A");
  const b = scoreTriage({ Q1: 0, Q2: 4, Q9: 1 });
  assert.ok(!b.ranked.some((x) => x.type === "A"));
});

test("every triage option names or keeps at least one type", () => {
  for (const q of QUESTIONS) for (const o of q.options) assert.ok((o.keep || []).length + (o.name || []).length > 0, `${q.id}: ${o.text}`);
});
