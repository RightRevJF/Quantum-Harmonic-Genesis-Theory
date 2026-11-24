// The lyric scorer: Luthier v45's measurable lyric rules, applied to a lyric sheet.
//
// Every number here is cited to the spec (Module 10, Windows 27, 32, 36, 39 / 10.7,
// 10.9, the checklist). Per Principle 10 these are readings, not verdicts: each
// finding says what it measured, the real-song band, and what the writer can do.

import { lookup, isVowelPhone, consonantWeight } from "./lexicon.js";

// ---- Bands from the spec -------------------------------------------------
export const BANDS = {
  // Window 36: syllables per second of sung lines (median, p90, p95, p99 = articulation ceiling)
  sps: { median: 2.481, p90: 4.137, p95: 4.762, p99: 6.4 },
  // Window 36: friction = syllables/second x (1 + consonant load)
  friction: { median: 4.623, p90: 8.116, p95: 9.43, p99: 12.64 },
  // Window 36: consonant load per syllable (reported as information; hits run higher)
  load: { median: 0.925, p90: 1.3 },
  // Rule V2 / Window 27: verse lines 6-9 syllables (median 8.2, hits 8.7)
  verseLen: [6, 9],
  // Window 27: chorus lines shorter (median 7.0, middle half 6.0-8.4)
  chorusLen: [6.0, 8.4],
  // Window 27: lines in one chorus block (middle half 4-8)
  chorusLines: [4, 8],
  // Window 27: type-token ratios (middle halves)
  verseTTR: [0.3, 0.67],
  chorusTTR: [0.6, 0.83],
  // Window 27: title statements across the whole sung song (middle half 2-9; hits about 6)
  titleCount: [2, 9],
  // Checklist item 5: hook 4-9 syllables at singing speed
  hookLen: [4, 9],
  // Window 27: 'you' share of words (middle half)
  youShare: [0.016, 0.082],
  // 10.9: rare words are Zipf under 2.75
  rareZipf: 2.75,
  // Rule V1 / 10.9: a thing-word is Brysbaert >= 4.0; a meaning-word <= 2.5
  thing: 4.0,
  meaning: 2.5,
  // 10.9: ladder lines about one in ten (hits 0.1; hymns about one in two)
  ladder: 0.1,
  ladderHymn: 0.455,
  // Module 10.5: bridge four lines maximum
  bridgeMax: 4,
  // Window 27: rhyme density about 0.461; a block with no full and no loose rhyme is under the floor
  rhyme: 0.461,
};

// Window 32: a line ends on a concrete noun or a verb, never on a conjunction,
// preposition, article or dangling 'it'.
const WEAK_END = new Set(`a an the and but or nor so yet for if as than because though although while
of to in on at by from with into onto upon over under about above below across after against along among
around before behind beneath beside between beyond during except inside near off out outside past since
through throughout till toward towards until unto up via within without it its`.split(/\s+/));

const FUNCTION_WORDS = new Set(`a an the and but or nor so yet for if as than because though although while of to in
on at by from with into onto upon over under about above below across after against along among around before behind
beneath beside between beyond during except inside near off out outside past since through till toward towards until
unto up via within without it its i me my mine we us our ours you your yours he him his she her hers they them their
theirs this that these those who whom whose which what when where why how is am are was were be been being have has
had do does did will would shall should can could may might must not no oh yeah la na just there here then now all
some any each every more most such only own same too very s t don't i'm i've i'll i'd you're you've you'll it's that's
there's can't won't ain't let's we're they're he's she's we'll they'll`.split(/\s+/));

const PRONOUNS = {
  first: new Set(["i", "me", "my", "mine", "i'm", "i've", "i'll", "i'd", "myself"]),
  firstPlural: new Set(["we", "us", "our", "ours", "we're", "we'll", "we've", "ourselves"]),
  second: new Set(["you", "your", "yours", "you're", "you've", "you'll", "you'd", "yourself", "thee", "thou", "thy"]),
  third: new Set(["he", "him", "his", "she", "her", "hers", "they", "them", "their", "he's", "she's", "they're"]),
};

// 10.7 / Window 39 vowel classes (ARPAbet). Held notes want open vowels; close is the anti-hit direction.
const OPEN_V = new Set(["AA", "AE", "AO", "AW", "AY", "OW", "OY", "AH"]);
const CLOSE_V = new Set(["IY", "IH", "UW", "UH", "ER"]);
const LIQUID = new Set(["L", "R"]);

// ---- Parsing ---------------------------------------------------------------
const KIND_RX = [
  [/pre[\s-]?chorus|lift|climb|build/i, "prechorus"],
  [/chorus|refrain|hook/i, "chorus"],
  [/bridge|middle\s*8/i, "bridge"],
  [/verse/i, "verse"],
  [/intro/i, "intro"],
  [/outro|coda|ending/i, "outro"],
  [/tag/i, "tag"],
  [/vamp/i, "vamp"],
];

function headerOf(line) {
  const t = line.trim();
  let m = t.match(/^\[(.+?)\]$/) || t.match(/^\((.+?)\)$/) || t.match(/^#+\s*(.+)$/) ||
    t.match(/^((?:pre[\s-]?)?(?:verse|chorus|refrain|bridge|intro|outro|tag|vamp|hook|pre-chorus|prechorus|middle 8|coda)\b[^:]{0,20}):?$/i);
  if (!m) return null;
  const name = m[1].replace(/:$/, "").trim();
  const kind = (KIND_RX.find(([rx]) => rx.test(name)) || [null, "verse"])[1];
  return { name, kind };
}

export function tokenize(line) {
  return (line.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)*'?/g) || [])
    .map((w) => (/[a-z]in'$/.test(w) ? w : w.replace(/^'+|'+$/g, "")))
    .filter(Boolean);
}

function stripMarks(line) {
  return line.replace(/\s*>\s*$/, "").replace(/^\s*\(aside\)\s*/i, "").trim();
}

export function parseSheet(text) {
  const raw = text.replace(/\r/g, "").split("\n");
  const sections = [];
  let cur = null;
  let hadHeaders = false;
  const push = (name, kind) => { cur = { name, kind, lines: [], ref: false }; sections.push(cur); };
  for (const l of raw) {
    const h = headerOf(l);
    if (h) { hadHeaders = true; push(h.name, h.kind); continue; }
    if (!l.trim()) { if (!hadHeaders && cur && cur.lines.length) cur = null; continue; }
    if (!cur) push(`Block ${sections.length + 1}`, "verse");
    cur.lines.push({
      text: stripMarks(l),
      prospective: /\s>\s*$/.test(l) || /^\S.*>\s*$/.test(l),
      aside: /^\s*\(aside\)/i.test(l),
    });
  }
  // Without headers: a block whose lines mostly recur elsewhere is chorus-like (Window 27's method).
  if (!hadHeaders) {
    const counts = new Map();
    sections.forEach((s) => s.lines.forEach((ln) => counts.set(norm(ln.text), (counts.get(norm(ln.text)) || 0) + 1)));
    let v = 0;
    sections.forEach((s) => {
      const rep = s.lines.filter((ln) => counts.get(norm(ln.text)) > 1).length;
      if (rep / s.lines.length >= 0.5) s.kind = "chorus", s.name = "Chorus";
      else s.name = `Verse ${++v}`;
    });
  }
  // A header with no lines repeats the last section of the same name or kind (sung order).
  sections.forEach((s, i) => {
    if (s.lines.length) return;
    const prev = sections.slice(0, i).reverse().find((p) => p.lines.length && !p.ref &&
      (p.name.toLowerCase() === s.name.toLowerCase() || p.kind === s.kind));
    if (prev) { s.lines = prev.lines.map((l) => ({ ...l })); s.ref = true; }
  });
  return sections.filter((s) => s.lines.length);
}

function norm(t) { return tokenize(t).join(" "); }

// ---- Per-line measures -------------------------------------------------------
function lastVowelInfo(phones) {
  let idx = -1;
  for (let i = phones.length - 1; i >= 0; i--) if (isVowelPhone(phones[i])) { idx = i; break; }
  if (idx < 0) return { vowel: null, stress: null, tail: [] };
  // prefer the last stressed vowel for the held sound
  let s = idx;
  for (let i = phones.length - 1; i >= 0; i--) if (/[12]$/.test(phones[i])) { s = i; break; }
  return { vowel: phones[s].replace(/[0-9]/g, ""), stress: phones[s].slice(-1), reduced: /0$/.test(phones[s]) && phones[s].startsWith("AH"), tail: phones.slice(idx + 1) };
}

export function vowelClass(phones) {
  const v = lastVowelInfo(phones);
  if (!v.vowel) return "none";
  if (v.reduced) return "reduced";
  if (OPEN_V.has(v.vowel)) return "open";
  if (CLOSE_V.has(v.vowel)) return "close";
  return "mid";
}

// Rhyme key: phones from the last stressed vowel to the end.
function rhymeKey(phones) {
  let s = -1;
  for (let i = phones.length - 1; i >= 0; i--) if (/[12]$/.test(phones[i])) { s = i; break; }
  if (s < 0) for (let i = phones.length - 1; i >= 0; i--) if (isVowelPhone(phones[i])) { s = i; break; }
  if (s < 0) return null;
  return phones.slice(s).map((p) => p.replace(/[0-9]/g, ""));
}

export function rhymeKind(a, b) {
  if (!a || !b) return "none";
  if (a.join(" ") === b.join(" ")) return "full";
  const va = a[0], vb = b[0];
  const ca = a.slice(1).filter((p) => !isVowelPhone(p)), cb = b.slice(1).filter((p) => !isVowelPhone(p));
  const fam = (p) => (["P","B","T","D","K","G"].includes(p) ? "stop" : ["M","N","NG"].includes(p) ? "nasal" : ["F","V","TH","DH","S","Z","SH","ZH"].includes(p) ? "fric" : p);
  if (va === vb) return "loose"; // assonance
  if (ca.length && cb.length && ca.map(fam).join() === cb.map(fam).join() && ca[ca.length - 1] === cb[cb.length - 1]) return "loose"; // consonance
  return "none";
}

function measureLine(text, ctx) {
  const words = tokenize(text);
  const looks = words.map((w) => lookup(w));
  const syllables = looks.reduce((a, l) => a + l.syllables, 0);
  let cons = 0;
  looks.forEach((l) => l.phones.forEach((p) => { cons += consonantWeight(p); }));
  const load = syllables ? cons / syllables : 0;
  // Window 36 at the writer's tempo: one line over its slot, less a beat for breath.
  const beatSec = 60 / ctx.bpm;
  const span = Math.max(beatSec, (ctx.barsPerLine * ctx.beatsPerBar - 1) * beatSec);
  const sps = syllables / span;
  const friction = sps * (1 + load);
  // 10.7 word-boundary clusters: final consonants of one word + initial consonants of the next.
  const clusters = [];
  for (let i = 0; i + 1 < looks.length; i++) {
    const a = looks[i].phones, b = looks[i + 1].phones;
    let fin = 0; for (let j = a.length - 1; j >= 0 && !isVowelPhone(a[j]); j--) fin++;
    let ini = 0; for (let j = 0; j < b.length && !isVowelPhone(b[j]); j++) ini++;
    if (fin + ini >= 4) clusters.push({ at: `${words[i]} ${words[i + 1]}`, size: fin + ini });
  }
  const content = looks.filter((l) => !FUNCTION_WORDS.has(l.word));
  const exempt = ctx.exemptWords;
  const things = looks.filter((l) => l.conc !== null && l.conc >= BANDS.thing && !FUNCTION_WORDS.has(l.word)).map((l) => l.word);
  const meanings = content.filter((l) => l.conc !== null && l.conc <= BANDS.meaning).map((l) => l.word);
  const objectHit = ctx.objects.some((o) => o && norm(text).includes(o));
  // a capitalised word after the first word of the line counts as a name (Rule V1 allows names)
  const names = text.match(/(?<=\S\s+)[A-Z][a-z]{2,}/g) || [];
  const rare = looks.filter((l) => !FUNCTION_WORDS.has(l.word) && l.zipf < BANDS.rareZipf && !exempt.has(l.word) && !/^\d+$/.test(l.word)).map((l) => l.word);
  const last = looks[looks.length - 1];
  return {
    text, words, syllables, load, sps, friction, clusters,
    things, meanings, objectHit, names, rare,
    lastWord: last ? last.word : "",
    lastPhones: last ? last.phones : [],
    lastSyllables: last ? last.syllables : 0,
    held: last ? vowelClass(last.phones) : "none",
    rhyme: last ? rhymeKey(last.phones) : null,
    picture: things.length > 0 || objectHit || names.length > 0,
    ladder: things.length > 0 && meanings.length > 0,
    weakEnd: last ? WEAK_END.has(last.word) : false,
  };
}

function ttr(words) { return words.length ? new Set(words).size / words.length : 0; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function r2(x) { return Math.round(x * 100) / 100; }
function inBand(x, [lo, hi]) { return x >= lo && x <= hi; }

function rhymeScheme(lines) {
  const letters = [];
  const keys = [];
  let next = 0;
  let full = 0, loose = 0;
  lines.forEach((ln, i) => {
    let letter = null;
    for (let j = Math.max(0, i - 4); j < i; j++) {
      const k = rhymeKind(ln.rhyme, lines[j].rhyme);
      if (k === "full" && !letter) letter = letters[j];
    }
    if (!letter) for (let j = Math.max(0, i - 4); j < i; j++) if (rhymeKind(ln.rhyme, lines[j].rhyme) === "loose") { letter = letters[j].toLowerCase(); break; }
    const window = lines.slice(Math.max(0, i - 4), i).concat(lines.slice(i + 1, i + 5));
    if (window.some((o) => o.lastWord !== ln.lastWord && rhymeKind(ln.rhyme, o.rhyme) === "full")) full++;
    else if (window.some((o) => o.lastWord !== ln.lastWord && rhymeKind(ln.rhyme, o.rhyme) !== "none")) loose++;
    letters.push(letter || String.fromCharCode(65 + (next++ % 26)));
    keys.push(ln.rhyme);
  });
  return { scheme: letters.join(""), full: lines.length ? full / lines.length : 0, loose: lines.length ? loose / lines.length : 0 };
}

// ---- The whole sheet ----------------------------------------------------------
export function analyzeLyric(text, options = {}) {
  const opts = {
    title: "", bpm: 80, beatsPerBar: 4, barsPerLine: 2, objects: [], writerPhrases: [], neverSay: [],
    hymn: false, pictureRule: true, ...options,
  };
  const titleNorm = norm(opts.title || "");
  const exemptWords = new Set([...tokenize(opts.title || ""), ...opts.objects.flatMap(tokenize), ...opts.writerPhrases.flatMap(tokenize)]);
  const ctx = { ...opts, objects: opts.objects.map(norm).filter(Boolean), exemptWords };
  const sections = parseSheet(text).map((s) => ({
    ...s,
    lines: s.lines.map((l) => ({ ...l, ...measureLine(l.text, ctx), section: s.name, kind: s.kind })),
  }));
  const findings = [];
  const add = (f) => findings.push(f);
  const sung = sections.flatMap((s) => s.lines);
  const allWords = sung.flatMap((l) => l.words);

  if (!sung.length) {
    return { sections, findings: [{ rule: "Sheet", level: "floor", message: "No lyric lines found." }], metrics: {}, summary: { floors: 1, flags: 0 } };
  }

  // Per-line rules
  sections.forEach((s) => {
    if (s.ref) return; // a repeated section is measured once
    s.lines.forEach((l, i) => {
      const where = { section: s.name, line: i + 1, text: l.text };
      const isWriter = opts.writerPhrases.some((p) => p && norm(l.text).includes(norm(p)));
      // Window 32 / Module 28: weak line endings are a floor, lifted for a prospective line.
      if (l.weakEnd && !l.prospective && !isWriter) {
        add({ rule: "Weak line ending (Window 32)", level: "floor", where,
          message: `Ends on "${l.lastWord}". Real lyric lines end weak only 5% of the time; the last word carries the payload.`,
          fix: "End on a concrete noun or a verb, or mark the line as a build line with > at the end." });
      }
      // Rule V1 on the couplet, verse slots only.
      if (opts.pictureRule && s.kind === "verse" && !l.aside && !isWriter) {
        const next = s.lines[i + 1], prev = s.lines[i - 1];
        if (!l.picture) {
          if ((prev && prev.picture) || (next && next.picture)) {
            l.pictureBy = "couplet";
          } else {
            add({ rule: "Rule V1: picture in every verse line", level: "floor", where,
              message: "No concrete word, intake object or name in this line or the line beside it.",
              fix: "Put something the listener can touch, smell, see or hear in the line (a thing-word rated 4.0 or more)." });
          }
        } else l.pictureBy = "line";
      }
      // Window 36 density at singing speed
      if (l.sps > BANDS.sps.p99) {
        add({ rule: "Mouth test: density (Window 36)", level: "floor", where,
          message: `${r2(l.sps)} syllables a second at ${opts.bpm} BPM over ${opts.barsPerLine} bars, past the articulation ceiling of 6.4.`,
          fix: "Trim syllables, or give the line more bars." });
      } else if (l.friction > BANDS.friction.p95) {
        add({ rule: "Mouth test: friction (Window 36)", level: "flag", where,
          message: `Friction ${r2(l.friction)}, past the real 95th percentile (9.43): crowded.`,
          fix: "Trim a word or two, or give the line more room." });
      } else if (l.friction > BANDS.friction.p90) {
        add({ rule: "Mouth test: friction (Window 36)", level: "info", where,
          message: `Friction ${r2(l.friction)}, past the real 90th percentile (8.12): dense.` });
      }
      // 10.7 boundary clusters
      l.clusters.forEach((c) => {
        add({ rule: "Mouth test: consonant cluster (10.7)", level: c.size >= 5 ? "flag" : "info", where,
          message: `"${c.at}" joins ${c.size} consonants at the word boundary${c.size >= 5 ? ": a tongue-twister" : ""}.`,
          fix: c.size >= 5 ? "Swap one of the two words, or put a vowel between them." : undefined });
      });
      // 10.9 rare words
      if (l.rare.length) {
        add({ rule: "Rare word (10.9)", level: "info", where,
          message: `${l.rare.map((w) => `"${w}"`).join(", ")} ${l.rare.length > 1 ? "are" : "is"} under the rare-word floor (Zipf 2.75). The ear gets one pass.`,
          fix: "Keep it if it is the point; otherwise use the commoner word." });
      }
      // Never-say list (intake Q9 / N5)
      opts.neverSay.forEach((ns) => {
        const n = norm(ns);
        if (n && (` ${norm(l.text)} `).includes(` ${n} `)) {
          add({ rule: "Never-say list", level: "floor", where, message: `Uses "${ns}", which is on the never-say list.`, fix: "Rewrite the line without it." });
        }
      });
    });
  });

  // Section rules
  const verses = sections.filter((s) => s.kind === "verse" && !s.ref);
  const choruses = sections.filter((s) => s.kind === "chorus");
  const firstChorus = choruses.find((c) => !c.ref);
  const bridges = sections.filter((s) => s.kind === "bridge" && !s.ref);

  verses.forEach((s) => {
    const lens = s.lines.map((l) => l.syllables);
    const out = s.lines.filter((l) => !inBand(l.syllables, BANDS.verseLen));
    if (out.length) {
      add({ rule: "Rule V2: verse line length", level: "info", where: { section: s.name },
        message: `${out.length} of ${s.lines.length} lines sit outside 6 to 9 syllables (${out.map((l) => l.syllables).join(", ")}). Real verse lines run 8.2 at the median, hits 8.7.` });
    }
    let identical = 0;
    for (let i = 0; i + 1 < lens.length; i += 2) if (lens[i] === lens[i + 1]) identical++;
    if (lens.length >= 4 && identical === Math.floor(lens.length / 2)) {
      add({ rule: "Rule V2: verse entropy", level: "info", where: { section: s.name },
        message: "Every paired verse line has the same syllable count. Verse rhythm wants to be close but not identical, like speech.",
        fix: "Let one line of a pair run a syllable longer or shorter." });
    }
  });

  if (firstChorus) {
    const c = firstChorus;
    const lens = c.lines.map((l) => l.syllables);
    if (!inBand(c.lines.length, BANDS.chorusLines)) {
      add({ rule: "Chorus block size (Window 27)", level: "info", where: { section: c.name },
        message: `${c.lines.length} lines. Real chorus blocks run 4 to 8 (median 6).` });
    }
    const vMean = mean(verses.flatMap((v) => v.lines.map((l) => l.syllables)));
    const cMean = mean(lens);
    if (verses.length && cMean >= vMean) {
      add({ rule: "Rule C1: chorus lines shorter than verse", level: "flag", where: { section: c.name },
        message: `Chorus lines average ${r2(cMean)} syllables against the verse's ${r2(vMean)}. Real choruses run shorter (7.0 against 8.2).`,
        fix: "Tighten the chorus lines." });
    }
    // mirrored pairs
    let unmatched = 0;
    for (let i = 0; i + 1 < lens.length; i += 2) if (Math.abs(lens[i] - lens[i + 1]) > 1) unmatched++;
    if (unmatched) {
      add({ rule: "Rule C1: mirror the syllables", level: "flag", where: { section: c.name },
        message: `${unmatched} paired chorus line${unmatched > 1 ? "s differ" : " differs"} by more than one syllable (${lens.join(", ")}).`,
        fix: "Match each pair of chorus lines within a syllable." });
    }
    // Rule C2 convergence word
    const last = c.lines[c.lines.length - 1];
    const finalPhone = last.lastPhones[last.lastPhones.length - 1] || "";
    const endsOpen = isVowelPhone(finalPhone) || LIQUID.has(finalPhone);
    if (!endsOpen) {
      add({ rule: "Rule C2: the convergence word", level: "flag", where: { section: c.name, line: c.lines.length, text: last.text },
        message: `The chorus ends on "${last.lastWord}", which closes on a consonant (${finalPhone}). The held convergence word must end on an open vowel or a liquid.`,
        fix: "End the chorus on a word like 'go', 'free', 'home'... that ends on a vowel, L or R." });
    } else if (last.lastSyllables > 1) {
      add({ rule: "Rule C2: the convergence word", level: "info", where: { section: c.name, line: c.lines.length, text: last.text },
        message: `"${last.lastWord}" has ${last.lastSyllables} syllables. One syllable is preferred for the held note.` });
    }
    // Held-note vowels (10.7): treat chorus line endings as held
    const held = c.lines.map((l) => l.held);
    const closeOrReduced = c.lines.filter((l) => l.held === "close" || l.held === "reduced");
    if (closeOrReduced.length) {
      add({ rule: "Held-note vowel (10.7)", level: "info", where: { section: c.name },
        message: `Chorus line endings that will likely be held: ${held.filter((h) => h === "open").length} open, ${closeOrReduced.length} close or reduced (${closeOrReduced.map((l) => `"${l.lastWord}"`).join(", ")}). Open on held notes is hit-like; close is the other direction.` });
    }
    // Rhyme floor per block
  }

  [...verses, ...(firstChorus ? [firstChorus] : []), ...bridges].forEach((s) => {
    const r = rhymeScheme(s.lines);
    s.rhyme = r;
    if (s.lines.length >= 2 && r.full === 0 && r.loose === 0) {
      add({ rule: "Rhyme floor (Rule C1, Window 27)", level: "flag", where: { section: s.name },
        message: `No full or loose rhyme in this block (scheme ${r.scheme}). About 46% of real line endings rhyme within four lines.`,
        fix: "Let at least one pair of line endings rhyme, fully or loosely." });
    }
  });

  bridges.forEach((b) => {
    if (b.lines.length > BANDS.bridgeMax) {
      add({ rule: "Bridge length (10.5)", level: "flag", where: { section: b.name },
        message: `${b.lines.length} lines. The bridge is four lines at most: plain, heavy, no wordplay.`, fix: "Cut to the four lines that cost the most." });
    }
  });

  // Inversion: final chorus singable on the first chorus's melody (10.6 INVERSION_NOT_SINGABLE)
  const chorusOccur = choruses.filter((c) => !c.ref);
  if (chorusOccur.length > 1) {
    const a = chorusOccur[0].lines, b = chorusOccur[chorusOccur.length - 1].lines;
    const bad = b.filter((l, i) => a[i] && Math.abs(l.syllables - a[i].syllables) > 1);
    if (bad.length) {
      add({ rule: "Final chorus singable on the same melody (10.6)", level: "flag", where: { section: chorusOccur[chorusOccur.length - 1].name },
        message: `${bad.length} line${bad.length > 1 ? "s" : ""} of the final chorus differ from the first chorus by more than one syllable.`,
        fix: "Match each line within a syllable so it sings on the same melody." });
    }
  }

  // POV contract (Rule C3): pronoun persons by section
  const persons = (s) => {
    const ws = s.lines.flatMap((l) => l.words);
    return Object.entries(PRONOUNS).filter(([, set]) => ws.some((w) => set.has(w))).map(([k]) => k);
  };
  const v1 = verses[0];
  if (v1 && firstChorus) {
    const pv = persons(v1), pc = persons(firstChorus);
    const singerV = pv.includes("first") ? "first" : pv.includes("third") ? "third" : null;
    const singerC = pc.includes("first") ? "first" : pc.includes("third") ? "third" : null;
    if (singerV && singerC && singerV !== singerC) {
      add({ rule: "Rule C3: the POV contract", level: "info", where: { section: firstChorus.name },
        message: `Verse 1 speaks in the ${singerV} person; the chorus in the ${singerC}. Check that the listener still knows whose interior they are in.` });
    }
  }

  // Title and hook
  let titleCount = 0, titleInChorus = false, titleFirstLine = false, hookLine = null;
  if (titleNorm) {
    sung.forEach((l) => {
      const n = ` ${norm(l.text)} `;
      let idx = n.indexOf(` ${titleNorm} `);
      while (idx >= 0) { titleCount++; idx = n.indexOf(` ${titleNorm} `, idx + 1); }
    });
    if (firstChorus) {
      const cl = firstChorus.lines.map((l) => ` ${norm(l.text)} `);
      titleInChorus = cl.some((t) => t.includes(` ${titleNorm} `));
      titleFirstLine = cl[0].includes(` ${titleNorm} `) || cl[cl.length - 1].includes(` ${titleNorm} `);
      hookLine = firstChorus.lines.find((l) => ` ${norm(l.text)} `.includes(` ${titleNorm} `)) || null;
    }
    if (!titleInChorus && firstChorus) {
      add({ rule: "Title in the hook position", level: "flag", where: { section: firstChorus.name },
        message: "The title does not appear in the chorus.", fix: "Put the title in the chorus, in its first or last line." });
    } else if (firstChorus && !titleFirstLine) {
      add({ rule: "Title in the hook position", level: "info", where: { section: firstChorus.name },
        message: "The title is in the chorus but not in its first or last line." });
    }
    if (!inBand(titleCount, BANDS.titleCount)) {
      add({ rule: "Title count (Window 27)", level: "info",
        message: `The title is sung ${titleCount} time${titleCount === 1 ? "" : "s"}. Real songs state it 2 to 9 times (hits about 6).` });
    }
    if (hookLine && !inBand(hookLine.syllables, BANDS.hookLen)) {
      add({ rule: "Hook length (checklist 5)", level: "flag", where: { section: firstChorus.name, text: hookLine.text },
        message: `The hook line has ${hookLine.syllables} syllables. The hook is 4 to 9 syllables at singing speed.`, fix: "Trim or grow the hook line to 4 to 9 syllables." });
    }
  }

  // Song-level readings
  const verseWords = verses.flatMap((v) => v.lines.flatMap((l) => l.words));
  const chorusSung = choruses.flatMap((c) => c.lines.flatMap((l) => l.words));
  const chorusBlock = firstChorus ? [...new Set(firstChorus.lines.map((l) => norm(l.text)))].join(" ").split(" ").filter(Boolean) : [];
  const lineCounts = new Map();
  sung.forEach((l) => lineCounts.set(norm(l.text), (lineCounts.get(norm(l.text)) || 0) + 1));
  const repeated = sung.filter((l) => lineCounts.get(norm(l.text)) > 1).length;
  const unique = [...new Set(sections.filter((s) => !s.ref).flatMap((s) => s.lines))];
  const ladderShare = unique.length ? unique.filter((l) => l.ladder).length / unique.length : 0;
  const contentLooks = allWords.filter((w) => !FUNCTION_WORDS.has(w)).map(lookup).filter((l) => l.conc !== null);
  const concreteRatio = contentLooks.length ? contentLooks.filter((l) => l.conc >= 3.5).length / contentLooks.length : 0;
  const youShare = allWords.length ? allWords.filter((w) => PRONOUNS.second.has(w)).length / allWords.length : 0;
  const metrics = {
    lines: unique.length,
    sungLines: sung.length,
    words: allWords.length,
    verseTTR: r2(ttr(verseWords)),
    chorusTTR_sung: r2(ttr(chorusSung)),
    chorusTTR_block: r2(ttr(chorusBlock)),
    verseLen: r2(mean(verses.flatMap((v) => v.lines.map((l) => l.syllables)))),
    chorusLen: firstChorus ? r2(mean(firstChorus.lines.map((l) => l.syllables))) : null,
    repeatedLineShare: r2(repeated / sung.length),
    titleCount,
    hookSyllables: hookLine ? hookLine.syllables : null,
    youShare: r2(youShare),
    ladderShare: r2(ladderShare),
    concreteRatio: r2(concreteRatio),
    spsMedian: r2(median(unique.map((l) => l.sps))),
    frictionMedian: r2(median(unique.map((l) => l.friction))),
    loadMean: r2(mean(unique.map((l) => l.load))),
    weakEndings: unique.filter((l) => l.weakEnd && !l.prospective).length,
  };

  if (verseWords.length && chorusSung.length && ttr(chorusSung) >= ttr(verseWords)) {
    add({ rule: "Chorus entropy (Rule C1, Window 27)", level: "flag",
      message: `The sung chorus repeats less than the verse (type-token ratio ${metrics.chorusTTR_sung} against ${metrics.verseTTR}). In real songs the chorus is lower in 85% of cases (0.23 against 0.575).`,
      fix: "Let the chorus repeat its own words and lines; let the verse range." });
  }
  const target = opts.hymn ? BANDS.ladderHymn : BANDS.ladder;
  if (ladderShare < target / 2) {
    add({ rule: "The ladder line (10.9)", level: "info",
      message: `${Math.round(ladderShare * 100)}% of lines put a thing and a meaning-word together. Hits do it in about ${opts.hymn ? "half" : "one line in ten"}.`,
      fix: "Somewhere, put the feeling's object and the feeling in the same line." });
  }
  if (!inBand(youShare, BANDS.youShare)) {
    add({ rule: "Address (Window 27)", level: "info",
      message: `'You' is ${Math.round(youShare * 1000) / 10}% of the words. Real songs run 1.6% to 8.2%; hits say 'you' a little more.` });
  }

  const summary = {
    floors: findings.filter((f) => f.level === "floor").length,
    flags: findings.filter((f) => f.level === "flag").length,
    infos: findings.filter((f) => f.level === "info").length,
  };
  return { sections, findings, metrics, summary, options: opts };
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Score a single candidate line in the context of its section (for the coaching step).
export function measureCandidate(text, kind, options = {}) {
  const opts = { bpm: 80, beatsPerBar: 4, barsPerLine: 2, objects: [], writerPhrases: [], title: "", ...options };
  const exemptWords = new Set([...tokenize(opts.title), ...opts.objects.flatMap(tokenize), ...opts.writerPhrases.flatMap(tokenize)]);
  const l = measureLine(text, { ...opts, objects: opts.objects.map(norm), exemptWords });
  const notes = [];
  if (l.weakEnd) notes.push(`weak ending "${l.lastWord}"`);
  if (kind === "verse" && !l.picture) notes.push("no picture");
  if (l.sps > BANDS.sps.p99) notes.push("past the articulation ceiling");
  else if (l.friction > BANDS.friction.p95) notes.push("crowded");
  if (l.clusters.some((c) => c.size >= 5)) notes.push("tongue-twister");
  if (l.rare.length) notes.push(`rare: ${l.rare.join(", ")}`);
  return { ...l, notes };
}
