import { test } from "node:test";
import assert from "node:assert/strict";
import * as H from "../app/js/engine/harmony.js";

test("chords parse: diatonic, borrowed, applied, sevenths", () => {
  assert.deepEqual(H.parseChord("vi", "major").tones, [9, 0, 4]);
  assert.deepEqual(H.parseChord("bVII", "major").tones, [10, 2, 5]);
  assert.deepEqual(H.parseChord("V/V", "major").tones, [2, 6, 9]);
  assert.deepEqual(H.parseChord("I7", "major").tones, [0, 4, 7, 10]);
  assert.equal(H.parseChord("Xyz", "major"), null);
  assert.equal(H.chordName("bVII", { tonic: 7, mode: "major" }), "F");
  assert.equal(H.chordName("ii", { tonic: 5, mode: "major" }), "Gm");
});

test("Window 19.9: diatonic 0, borrowed 1, secondary dominant 2", () => {
  assert.equal(H.chordDU("IV", "major").du, 0);
  assert.equal(H.chordDU("iv", "major").du, 1);
  assert.equal(H.chordDU("bVII", "major").du, 1);
  assert.equal(H.chordDU("V/vi", "major").du, 2);
  assert.equal(H.chordDU("V", "minor").du, 0);
  assert.equal(H.chordDU("IV", "minor").du, 1);
});

test("deceptive cadence costs 2; budgets by type", () => {
  const led = H.harmonicLedger({ verse: ["I", "IV", "V", "vi"] }, "V", "major");
  assert.equal(led.total, 2);
  assert.deepEqual([H.budgetFor("L").total, H.budgetFor("L").ceiling], [6, 2]);
  assert.deepEqual([H.budgetFor("P").total, H.budgetFor("P").ceiling], [9, 4]);
  assert.match(H.budgetFor("M").note, /Contemplative/);
});

test("19.10 schema discount: blues sevenths are free; lament full cadence costs 2", () => {
  assert.equal(H.chordCost("I7", "B", "major"), 0);
  assert.equal(H.chordCost("I7", "V", "major"), 1);
  const lam = H.harmonicLedger({ chorus: ["VI", "VII", "V", "i"] }, "L", "minor");
  assert.equal(lam.total, 2);
});

test("the skeleton search keeps budgets, changes the chorus loop, and is repeatable", () => {
  for (const [t, mode] of [["V", "major"], ["L", "minor"], ["P", "minor"], ["G", "major"], ["B", "major"]]) {
    const r1 = H.searchSkeletons(t, mode, ["verse", "chorus", "bridge"], { n: 300, seed: 11 });
    const r2 = H.searchSkeletons(t, mode, ["verse", "chorus", "bridge"], { n: 300, seed: 11 });
    assert.equal(r1.top.length, 3, t);
    assert.deepEqual(r1.top.map((c) => c.id), r2.top.map((c) => c.id));
    r1.top.forEach((c) => {
      assert.ok(c.ledger.total <= r1.budget.total, `${t} total`);
      assert.ok(c.ledger.peak.du <= r1.budget.ceiling, `${t} ceiling`);
    });
    assert.ok(r1.top.some((c) => c.facts.loopChanges), `${t} chorus changes the loop`);
  }
});

test("expectation quadrants weight surprise in a clear context highest", () => {
  const e = H.expectation(["I", "V", "vi", "IV"], "major");
  assert.ok(e.score > 0 && e.score <= 1);
  assert.equal(e.rows.length, 4);
});

test("form kinds come from the form text", () => {
  assert.deepEqual(H.formKinds("V-PC-C-V-PC-C-B-C"), ["verse", "prechorus", "chorus", "bridge"]);
  assert.deepEqual(H.formKinds(""), ["verse", "chorus", "bridge"]);
});
