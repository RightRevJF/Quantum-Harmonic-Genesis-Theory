// Word lookups: CMU phones, Zipf frequency (wordfreq), Brysbaert concreteness.
// The table is app/data/lexicon.json: word -> "PHONES|zipf|concreteness".

let TABLE = null;

export function setLexicon(table) { TABLE = table; }
export function hasLexicon() { return TABLE !== null; }

export async function loadLexicon(url = "data/lexicon.json") {
  if (TABLE) return TABLE;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lexicon: ${res.status}`);
  TABLE = await res.json();
  return TABLE;
}

const VOWELS = new Set(["AA","AE","AH","AO","AW","AY","EH","ER","EY","IH","IY","OW","OY","UH","UW"]);
const PLOSIVE = new Set(["P","B","T","D","K","G"]);
const FRICATIVE = new Set(["F","V","TH","DH","S","Z","SH","ZH","HH","CH","JH"]);
const SONORANT = new Set(["M","N","NG","L","R","W","Y"]);

export function isVowelPhone(p) { return VOWELS.has(p.replace(/[0-9]/g, "")); }

// Window 36 consonant weights: plosive 1.0, fricative/affricate 0.7, nasal/liquid/glide 0.4.
export function consonantWeight(p) {
  if (PLOSIVE.has(p)) return 1.0;
  if (FRICATIVE.has(p)) return 0.7;
  if (SONORANT.has(p)) return 0.4;
  return 0;
}

function parse(entry) {
  const [phones, z, c] = entry.split("|");
  return { phones: phones.split(" "), zipf: Number(z), conc: c === "" ? null : Number(c) };
}

// Simple lemma candidates for frequency and concreteness (a plural or inflection read as its lemma).
function lemmas(w) {
  const out = [];
  if (w.endsWith("'s")) out.push(w.slice(0, -2));
  if (w.endsWith("ies")) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("es")) out.push(w.slice(0, -2));
  if (w.endsWith("s") && !w.endsWith("ss")) out.push(w.slice(0, -1));
  if (w.endsWith("ied")) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("ed")) { out.push(w.slice(0, -2)); out.push(w.slice(0, -1)); }
  if (w.endsWith("ing")) { out.push(w.slice(0, -3)); out.push(w.slice(0, -3) + "e"); }
  if (w.endsWith("in'")) { out.push(w.slice(0, -1) + "g"); out.push(w.slice(0, -3)); }
  if (w.endsWith("ly")) out.push(w.slice(0, -2));
  return out;
}

// Rough spelling-based syllable count for words the dictionary lacks.
export function guessSyllables(w) {
  const s = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return 0;
  if (s.length <= 3) return 1;
  const t = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = t.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

// Rough phones for unknown words: enough for syllables and consonant clusters.
function guessPhones(w) {
  const s = w.toLowerCase().replace(/[^a-z]/g, "");
  const n = guessSyllables(s);
  const lead = (s.match(/^[^aeiouy]*/) || [""])[0];
  const tail = (s.replace(/e$/, "").match(/[^aeiouy]*$/) || [""])[0];
  const cons = (str) => str.replace(/(ch|sh|th|ph|ng|ck)/g, "C").split("").map(() => "T");
  const phones = [...cons(lead)];
  for (let i = 0; i < n; i++) phones.push(i === 0 ? "AH1" : "AH0");
  phones.push(...cons(tail));
  return phones;
}

export function lookup(word) {
  const w = word.toLowerCase().replace(/’/g, "'");
  const direct = TABLE && TABLE[w];
  let rec = direct ? parse(direct) : null;
  let lemmaRec = null;
  if (TABLE) {
    for (const l of lemmas(w)) {
      if (TABLE[l]) { lemmaRec = parse(TABLE[l]); break; }
    }
  }
  const known = Boolean(rec);
  if (!rec) rec = { phones: guessPhones(w), zipf: lemmaRec ? lemmaRec.zipf : 0, conc: null };
  const conc = rec.conc ?? (lemmaRec ? lemmaRec.conc : null);
  const zipf = Math.max(rec.zipf, lemmaRec ? lemmaRec.zipf : 0);
  const syllables = rec.phones.filter(isVowelPhone).length || 1;
  return { word: w, phones: rec.phones, zipf, conc, syllables, known: known || Boolean(lemmaRec) };
}
