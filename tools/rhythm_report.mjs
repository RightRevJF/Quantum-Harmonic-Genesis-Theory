// Measure the melody search's top candidates against the spec's real-song rhythm and phrase bands.
// Usage: node tools/rhythm_report.mjs [type] [n] [seeds]
import { readFileSync } from "node:fs";
import { setLexicon } from "../app/js/engine/lexicon.js";
import * as M from "../app/js/engine/melody.js";
import * as F from "../app/js/engine/floor.js";
import { analyzeLyric } from "../app/js/engine/lyric.js";
setLexicon(JSON.parse(readFileSync(new URL("../app/data/lexicon.json", import.meta.url))));
const LYRIC = `[Verse 1]
The dish turns slow against the dark
Cold coffee ringing on the chart
Warm headphones pressed on both my ears
Just static hissing, nothing clears

[Pre-Chorus]
The needle shivers, then lies flat
Static settles like salt on glass
I thumb the switch and lean in close
And speak into the mic once more

[Chorus]
Hello, is anybody there
I send it out into the air
One word and a wire and a prayer
Hello, I'm calling anyone, hello

[Verse 2]
The log book holds a thousand nights
Of pencil ticks and empty lines
Frost is creeping up the gate
The generator hums and waits

[Pre-Chorus]
The needle shivers, then lies flat
Static settles like salt on glass
Frost on my sleeve, I lean in close
And speak into the mic once more

[Chorus]

[Bridge]
Three pulses, then silence, then three
The third time, exactly the same
My pencil rolls off to the floor
I can't call it noise anymore

[Chorus]`;
const [type = "P", n = 600, seeds = 3] = process.argv.slice(2).map((x, i) => (i ? Number(x) : x));
const song = { type, harmony: { skel: { verse: ["I", "I", "IV", "IV"], prechorus: ["IV", "V/ii", "V", "V"], chorus: ["IV", "I", "V", "vi"], bridge: ["IV", "V", "V/ii", "vi"] } }, contract: { key: "A major", voice: "female", bpm: 80, title: "Hello, is anybody there" } };
const b = M.makeBrief(song, LYRIC);
const lr = analyzeLyric(LYRIC, { title: song.contract.title });
const acc = { align: [], unstrongStrong: [], restPer8: [], restShare: [], lastNote: [], restAfter: [], phraseSyl: [], sameRhythm: [], fourthTonic: [], otherTonic: [], peakPos: [], forms: {}, survival: [], melisma: [] };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
for (let k = 0; k < seeds; k++) {
  const res = await M.search(b, { n, seed: 1000 + k });
  acc.survival.push(res.rateBuilt);
  for (const t of res.top) {
    const f = F.floorReport(t, b, lr);
    const get = (name) => f.checks.find((c) => c.name.startsWith(name));
    acc.align.push(get("Stressed syllables on strong").value);
    acc.unstrongStrong.push(get("Unstressed syllables on strong").value);
    acc.restPer8.push(Number(get("Rest beats per 8").value));
    acc.melisma.push(Number(get("Syllables with two").value));
    t.sections.filter((s) => !s.repeat).forEach((s) => {
      acc.forms[s.kind + ":" + s.form] = (acc.forms[s.kind + ":" + s.form] || 0) + 1;
      s.lines.forEach((l, li) => {
        const ns = l.notes; if (!ns.length) return;
        const last = ns[ns.length - 1];
        acc.lastNote.push(last.dur / 2);
        const nextStart = s.lines[li + 1] ? s.lines[li + 1].notes[0]?.onset : l.start + l.slot;
        if (nextStart !== undefined) acc.restAfter.push((nextStart - (last.onset + last.dur)) / 2);
        const span = last.onset + last.dur - ns[0].onset; const sung = ns.reduce((a, x) => a + x.dur, 0);
        acc.restShare.push(1 - sung / (l.slot));
        const top = Math.max(...ns.map((x) => x.p)); acc.peakPos.push(ns.findIndex((x) => x.p === top) / Math.max(1, ns.length - 1));
        const deg = M.degreeOf(last.p, b.key);
        if (s.lines.length >= 4) (li === 3 ? acc.fourthTonic : acc.otherTonic).push(deg === 1 ? 1 : 0);
        if (li > 0) { const pr = s.lines[li - 1]; const a = new Set(pr.notes.map((x) => x.onset - pr.start)), c = new Set(ns.map((x) => x.onset - l.start)); const inter = [...a].filter((x) => c.has(x)).length; acc.sameRhythm.push((2 * inter) / (a.size + c.size) >= 0.8 ? 1 : 0); }
      });
    });
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const r2 = (x) => Math.round(x * 100) / 100;
console.log(`type ${type}: survival ${acc.survival.map((x) => r2(x)).join(", ")}`);
console.log(`stressed on strong beats: ${r2(med(acc.align))} (real median 0.783)`);
console.log(`unstressed on strong beats: ${r2(med(acc.unstrongStrong))} (real 0.097)`);
console.log(`rest beats per 8 bars: ${r2(med(acc.restPer8))} (real median 10.7)`);
console.log(`a line's last note, beats: ${r2(med(acc.lastNote))} (real median 1)`);
console.log(`rest after a line, beats (quartiles): ${[0.25, 0.5, 0.75].map((q) => r2([...acc.restAfter].sort((a, b) => a - b)[Math.floor(q * acc.restAfter.length)])).join(", ")} (real 1.25, 2, 4)`);
console.log(`rest share of the line slot: ${r2(med(acc.restShare))} (real 0.21 / 0.30 / 0.39 inside sung)`);
console.log(`consecutive lines sharing a rhythm: ${r2(mean(acc.sameRhythm))} (pop 0.26, folk and hymn 0.50)`);
console.log(`line ends on the tonic: 4th line ${r2(mean(acc.fourthTonic))}, others ${r2(mean(acc.otherTonic))} (pop 0.34 vs 0.22)`);
console.log(`where the line peaks: ${r2(med(acc.peakPos))} (real median 0.17)`);
console.log(`melisma share: ${r2(mean(acc.melisma))} (real 0.122)`);
console.log("forms:", Object.entries(acc.forms).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${v}`).join(", "));
