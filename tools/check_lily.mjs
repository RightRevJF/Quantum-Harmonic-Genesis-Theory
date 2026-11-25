// Generate the LilyPond files for a sample song and engrave them with LilyPond.
// Usage: node tools/check_lily.mjs <out-dir> [type] [key] [voice]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { setLexicon } from "../app/js/engine/lexicon.js";
import * as M from "../app/js/engine/melody.js";
import * as D from "../app/js/engine/docs.js";
import * as L from "../app/js/engine/lily.js";

setLexicon(JSON.parse(readFileSync(new URL("../app/data/lexicon.json", import.meta.url))));
const [out = "lily-out", type = "V", key = "Eb major", voice = "male"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
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

[Chorus]

[Bridge]
I would trade every wall for one more supper
With the window open and you laughing
Call me in from the yard
One more time

[Chorus]`;
const song = { type, q0: "The year after", harmony: { skel: { verse: ["I", "vi", "IV", "V"], chorus: ["IV", "I", "bVII", "V"], bridge: ["vi", "IV", "I", "V"] } }, contract: { key, voice, bpm: 76, beatsPerBar: 4, barsPerLine: 2, title: "I kept the house but lost the home", writer: "Test Writer" } };
if (/minor/.test(key)) song.harmony.skel = { verse: ["i", "VI", "III", "VII"], chorus: ["VI", "VII", "i", "V"], bridge: ["iv", "VI", "V", "V"] };
const b = M.makeBrief(song, LYRIC);
const res = await M.search(b, { n: 400, seed: 3 });
const pick = res.top.find((t) => t.sections.some((s) => s.notes.some((n) => n.melisma))) || res.top[0];
const rec = D.buildRecord(pick, b, song);
writeFileSync(`${out}/lead.ly`, L.leadSheetLy(rec));
writeFileSync(`${out}/score.ly`, L.scoreAndPartsLy(rec));
for (const f of ["lead.ly", "score.ly"]) {
  try {
    const log = execFileSync("lilypond", ["-s", "-o", out, `${out}/${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(f, "ok", log.trim());
  } catch (e) { console.log(f, "FAILED\n", (e.stderr || e.message).slice(0, 3000)); process.exitCode = 1; }
}
