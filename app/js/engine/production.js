// Checkpoint (e): production. The palette (9.6), the section entry/exit map (9.8), dynamics,
// the designed silence before the final chorus (Part VI, anticipation), the energy arc (9.12),
// register collision (9.13) with the keys re-voiced above the voice at the key bars, the
// low-interval limits of 9.14, and the producer one-sheet.

import { parseChord } from "./harmony.js";

// ---------- palettes (9.6: the lead is breath-, wood- or string-driven; no pads lead) ----------
const L = (id, name, kind, gm, extra = {}) => ({ id, name, kind, gm, ...extra });
export const PALETTES = {
  band: { name: "Pop / rock band", context: "a modern band record",
    layers: [L("fill", "Lead guitar", "fill", 27, { range: [52, 84] }), L("guitar", "Acoustic guitar", "strum", 25), L("keys", "Piano", "piano", 0), L("pad", "Strings", "pad", 48, { range: [55, 84] }), L("bass", "Bass", "bass", 33), L("drums", "Drums", "drums", null)] },
  americana: { name: "Americana / country ballad", context: "harmonica lead, steel-string guitar double",
    layers: [L("fill", "Harmonica", "fill", 22, { range: [60, 84] }), L("guitar", "Steel-string guitar", "strum", 25), L("keys", "Piano", "piano", 0), L("pad", "Fiddle", "pad", 40, { range: [55, 84] }), L("bass", "Upright bass", "bass", 32), L("drums", "Drums (brushes)", "drums", null, { brushes: true })] },
  folk: { name: "Folk / singer-songwriter", context: "flute lead, nylon guitar picked",
    layers: [L("fill", "Flute", "fill", 73, { range: [60, 91] }), L("guitar", "Nylon guitar", "pick", 24), L("pad", "Cello", "pad", 42, { range: [36, 62], low: true }), L("bass", "Upright bass", "bass", 32), L("drums", "Percussion (brushes)", "drums", null, { brushes: true, light: true })] },
  worship: { name: "Gospel / worship", context: "violin lead, viola double",
    layers: [L("fill", "Violin", "fill", 40, { range: [62, 91] }), L("guitar", "Acoustic guitar", "strum", 25), L("keys", "Piano", "piano", 0), L("pad", "Strings", "pad", 48, { range: [55, 84] }), L("bass", "Bass", "bass", 33), L("drums", "Drums", "drums", null)] },
  blues: { name: "Blues / roots", context: "harmonica lead, clean electric guitar",
    layers: [L("fill", "Harmonica", "fill", 22, { range: [60, 84] }), L("guitar", "Electric guitar (clean)", "strum", 27), L("keys", "Organ", "piano", 16), L("bass", "Bass", "bass", 33), L("drums", "Drums", "drums", null)] },
  cinematic: { name: "Orchestral / cinematic", context: "violin lead, cello double",
    layers: [L("fill", "Violin", "fill", 40, { range: [62, 91] }), L("keys", "Piano", "piano", 0), L("pad", "Strings", "pad", 48, { range: [55, 84] }), L("cello", "Cello", "pad", 42, { range: [36, 62], low: true }), L("bass", "Contrabass", "bass", 43), L("drums", "Percussion", "drums", null, { cinematic: true })] },
};
export function suggestPalettes(type, voiceName = "") {
  const base = (type || "P").split("/")[0];
  const order = {
    W: ["worship", "cinematic", "band"], T: ["worship", "band", "blues"], B: ["blues", "americana", "band"],
    L: ["folk", "cinematic", "americana"], LR: ["folk", "cinematic", "worship"], LD: ["folk", "cinematic", "americana"],
    M: ["cinematic", "folk", "worship"], N: ["folk", "americana", "band"], V: ["americana", "band", "folk"],
    A: ["band", "worship", "cinematic"], G: ["band", "blues", "americana"], PR: ["band", "worship", "cinematic"], P: ["folk", "band", "cinematic"],
  }[base] || ["band", "folk", "americana"];
  return order;
}

// ---------- the entry/exit map (9.8) ----------
export const ROLES = ["intro", "verse", "verse2", "prechorus", "chorus", "bridge", "final", "tag"];
export const ROLE_NAME = { intro: "Intro", verse: "Verse 1", verse2: "Later verses", prechorus: "Pre-chorus", chorus: "Chorus", bridge: "Bridge", final: "Final chorus", tag: "Tag" };
const MAP = {
  fill: { intro: "on", verse: "off", verse2: "off", prechorus: "off", chorus: "off", bridge: "sparse", final: "sparse", tag: "on" },
  strum: { intro: "sparse", verse: "sparse", verse2: "on", prechorus: "on", chorus: "full", bridge: "sparse", final: "full", tag: "sparse" },
  pick: { intro: "on", verse: "on", verse2: "on", prechorus: "on", chorus: "on", bridge: "sparse", final: "full", tag: "on" },
  piano: { intro: "sparse", verse: "sparse", verse2: "sparse", prechorus: "on", chorus: "on", bridge: "sparse", final: "full", tag: "sparse" },
  pad: { intro: "off", verse: "off", verse2: "sparse", prechorus: "sparse", chorus: "on", bridge: "on", final: "full", tag: "on" },
  bass: { intro: "sparse", verse: "on", verse2: "on", prechorus: "on", chorus: "full", bridge: "sparse", final: "full", tag: "sparse" },
};
const DRUMS = {
  default: { intro: "intro", verse: "light", verse2: "light", prechorus: "pre", chorus: "full", bridge: "quiet", final: "max", tag: "fade" },
  brushes: { intro: "off", verse: "brush", verse2: "brush", prechorus: "pre", chorus: "full", bridge: "quiet", final: "max", tag: "fade" },
  light: { intro: "off", verse: "brush", verse2: "brush", prechorus: "brush", chorus: "light", bridge: "off", final: "light", tag: "off" },
  cinematic: { intro: "off", verse: "off", verse2: "off", prechorus: "light", chorus: "full", bridge: "off", final: "max", tag: "off" },
};
export const DYNAMICS = { intro: "mp", verse: "mp", verse2: "mp", prechorus: "mf", chorus: "f", bridge: "mp", final: "ff", tag: "mp" };
const VEL = { p: 45, mp: 60, mf: 75, f: 90, ff: 105 };

export function defaultPlan(type, voiceName) {
  const palette = suggestPalettes(type, voiceName)[0];
  return planFor(palette);
}
export function planFor(paletteId) {
  const pal = PALETTES[paletteId] || PALETTES.band;
  const levels = {};
  pal.layers.forEach((ly) => {
    if (ly.kind === "drums") levels[ly.id] = { ...(ly.cinematic ? DRUMS.cinematic : ly.light ? DRUMS.light : ly.brushes ? DRUMS.brushes : DRUMS.default) };
    else levels[ly.id] = { ...MAP[ly.kind] };
  });
  return { palette: paletteId, levels, dynamics: { ...DYNAMICS }, silence: true, tag: true };
}

// Which role each section of the record plays.
export function roles(rec) {
  const lastChorus = rec.sections.map((s) => s.kind).lastIndexOf("chorus");
  const choruses = rec.sections.filter((s) => s.kind === "chorus").length;
  let verses = 0;
  return rec.sections.map((s, i) => {
    if (s.kind === "intro") return "intro";
    if (s.kind === "tag" || s.kind === "outro") return "tag";
    if (s.kind === "verse") return ++verses > 1 ? "verse2" : "verse";
    if (s.kind === "chorus") return i === lastChorus && choruses > 1 ? "final" : "chorus";
    if (s.kind === "prechorus") return "prechorus";
    if (s.kind === "bridge") return "bridge";
    return "verse";
  });
}

// ---------- writers ----------
function voicingAbove(pcs, floor, ceiling) {
  for (let base = floor; base <= ceiling; base++) {
    if (!pcs.includes(base % 12)) continue;
    const v = [base];
    while (v.length < pcs.length) { let p = v[v.length - 1] + 1; while (!pcs.includes(p % 12) || v.some((q) => q % 12 === p % 12)) p++; v.push(p); }
    if (v[v.length - 1] <= ceiling + 7) return v;
  }
  return null;
}
// 9.14: no second below C4, no third below F3 in a voicing
function lowIntervalOk(v) {
  for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; if (d <= 2 && v[i - 1] < 60) return false; if (d <= 4 && v[i - 1] < 53) return false; }
  return true;
}

export function arrange(rec, plan) {
  const pal = PALETTES[plan.palette] || PALETTES.band;
  const { barLen, ks } = rec;
  const tonic = ks.tonic;
  const rs = roles(rec);
  // the voice's band, and the key bars (the title's held note, any note held a bar or more)
  const band = new Map(), keyBars = new Set();
  rec.melody.forEach((n) => {
    const b = Math.floor(n.t / barLen);
    const cur = band.get(b) || [n.p, n.p];
    band.set(b, [Math.min(cur[0], n.p), Math.max(cur[1], n.p)]);
    if (n.money || n.dur >= barLen / 2) keyBars.add(b);
  });
  const finalIdx = rs.indexOf("final");
  const approachBar = finalIdx > 0 && plan.silence ? rec.sections[finalIdx].startBar - 2 : -1; // the bar before the final chorus (0-based)
  const hook = (() => { const ch = rec.sections.find((s) => s.kind === "chorus"); return ch ? ch.notes.slice(0, 4).map((n) => n.p) : rec.melody.slice(0, 4).map((n) => n.p); })();
  const voiceRest = []; // per bar: free spans for fills
  const layers = pal.layers.map((ly) => ({ ...ly, events: [], notes: {} }));
  let prevV = null, prevPad = null;
  rec.sections.forEach((sec, si) => {
    const role = rs[si];
    const vel = VEL[plan.dynamics[role] || "mf"];
    sec.chords.forEach((sym, b) => {
      const bar = sec.startBar - 1 + b;
      const t0 = bar * barLen;
      const c = parseChord(sym, ks.mode) || parseChord(ks.mode === "minor" ? "i" : "I", ks.mode);
      const pcs = c.tones.slice(0, 3).map((x) => (tonic + x) % 12);
      const root = (tonic + c.root) % 12;
      const vb = band.get(bar);
      const isKey = keyBars.has(bar);
      const approach = bar === approachBar;
      const cut = approach ? barLen / 2 : barLen; // the designed silence: the band stops at the half bar
      const push = (ly, e) => { if (e.t - t0 < cut) ly.events.push({ ...e, dur: Math.min(e.dur, cut - (e.t - t0)), vel: e.vel ?? vel, approach }); };
      layers.forEach((ly) => {
        const lev = (plan.levels[ly.id] || {})[role] || "off";
        if (lev === "off" || lev === "silent") return;
        switch (ly.kind) {
          case "strum": {
            const step = lev === "full" ? 1 : lev === "on" ? 2 : barLen / 2;
            const gtr = [40 + ((root - 4 + 12) % 12), 0, 0, 0];
            gtr[1] = gtr[0] + 7; gtr[2] = gtr[0] + 12; gtr[3] = gtr[2] + ((pcs[1] - root + 12) % 12);
            for (let o = 0; o < barLen; o += step) push(ly, { t: t0 + o, dur: step, slash: true, ps: gtr, chord: o === 0 ? sym : null, vel: vel - (o % 2 ? 12 : 0) });
            break;
          }
          case "pick": {
            const r0 = 40 + ((root - 4 + 12) % 12);
            const pat = [r0, r0 + 7, r0 + 12, r0 + 12 + ((pcs[1] - root + 12) % 12), r0 + 12, r0 + 7, r0 + 12, r0 + 19];
            const step = lev === "sparse" ? 2 : 1;
            for (let o = 0, k = 0; o < barLen; o += step, k++) {
              // full: the thumb doubles the root on the strong beats
              const ps = lev === "full" && o % 4 === 0 && pat[k % pat.length] !== r0 ? [r0, pat[k % pat.length]] : [pat[k % pat.length]];
              push(ly, { t: t0 + o, dur: step, ps, vel: vel - 8 });
            }
            break;
          }
          case "piano": {
            // re-voice above the voice's top note at the key bars (9.13); otherwise the nearest voicing from G3
            let v = null;
            if (isKey && vb) v = voicingAbove(pcs, vb[1] + 1, 84);
            if (!v) {
              const cands = [];
              for (let base = 55; base <= 67; base++) { const x = voicingAbove(pcs, base, base); if (x && x[0] === base && lowIntervalOk(x)) cands.push(x); }
              const center = prevV ? prevV.reduce((a, x) => a + x, 0) / prevV.length : 64;
              v = cands.reduce((a, x) => (!a || Math.abs(x.reduce((s, y) => s + y, 0) / x.length - center) < Math.abs(a.reduce((s, y) => s + y, 0) / a.length - center) ? x : a), null) || [60, 64, 67];
            }
            prevV = v;
            const rh = lev === "full" ? [[0, 2], [2, 2], [4, 2], [6, 2]] : lev === "on" ? [[0, barLen / 2], [barLen / 2, barLen / 2]] : [[0, barLen]];
            rh.filter(([o]) => o < barLen).forEach(([o, d]) => push(ly, { t: t0 + o, dur: Math.min(d, barLen - o), ps: v, hand: "R" }));
            const lr = 36 + ((root + 12 - 0) % 12) + (root < 4 ? 12 : 0);
            if (lev === "full") { push(ly, { t: t0, dur: barLen / 2, ps: [lr - 12 >= 28 ? lr - 12 : lr, lr].filter((x, i, a) => a.indexOf(x) === i), hand: "L" }); push(ly, { t: t0 + barLen / 2, dur: barLen / 2, ps: [lr + 7 > 55 ? lr - 5 : lr + 7], hand: "L" }); }
            else push(ly, { t: t0, dur: barLen, ps: [lr], hand: "L" });
            break;
          }
          case "pad": {
            let v;
            if (ly.low) {
              const r = 36 + ((root - 0 + 12) % 12) + (root < 4 ? 12 : 0);
              v = lev === "sparse" ? [r] : [r, r + 7 <= 62 ? r + 7 : r - 5];
              if (vb && v.some((p) => p >= vb[0])) v = v.map((p) => (p >= vb[0] ? p - 12 : p));
            } else {
              const floor = isKey && vb ? vb[1] + 1 : Math.max(ly.range[0], vb ? Math.min(vb[1] + 1, 67) : 60);
              v = voicingAbove(pcs, floor, ly.range[1]) || voicingAbove(pcs, ly.range[0], ly.range[1]) || [67, 71, 74];
              if (lev === "sparse") v = [v[0], v[v.length - 1]];
              if (lev === "full" && v[0] + 12 <= 91) v = [...v, v[0] + 12];
              if (prevPad && Math.abs(prevPad[0] - v[0]) > 7) { const alt = voicingAbove(pcs, prevPad[0] - 3, ly.range[1]); if (alt) v = lev === "sparse" ? [alt[0], alt[alt.length - 1]] : alt; }
              prevPad = v;
            }
            push(ly, { t: t0, dur: barLen, ps: v, vel: vel - 15 });
            break;
          }
          case "bass": {
            const bR = 40 + ((root - 4 + 12) % 12);
            const fifth = bR + 7 <= 55 ? bR + 7 : bR - 5;
            if (lev === "full") for (let o = 0; o < barLen; o += 2) push(ly, { t: t0 + o, dur: 2, ps: [o === barLen - 2 && role === "final" ? bR + 12 : bR] });
            else if (lev === "on") { push(ly, { t: t0, dur: barLen / 2, ps: [bR] }); push(ly, { t: t0 + barLen / 2, dur: barLen / 2, ps: [fifth] }); }
            else push(ly, { t: t0, dur: barLen, ps: [bR] });
            break;
          }
          case "fill": {
            // answer the voice in its rests: the hook's first notes, an octave up, inside the gap
            const range = ly.range || [60, 84];
            const fitP = (p) => { let x = p; while (x < range[0]) x += 12; while (x > range[1]) x -= 12; return x; };
            const notesInBar = rec.melody.filter((n) => n.t < t0 + barLen && n.t + n.dur > t0);
            let free = [];
            if (!notesInBar.length) free = [[0, barLen]];
            else {
              let pos = t0;
              notesInBar.sort((a, b) => a.t - b.t).forEach((n) => { if (n.t - pos >= 4) free.push([pos - t0, n.t - t0]); pos = Math.max(pos, n.t + n.dur); });
              if (t0 + barLen - pos >= 4) free.push([pos - t0, barLen]);
            }
            if (lev === "sparse") free = free.filter(([a, z]) => z - a >= 6);
            free.forEach(([a, z]) => {
              const len = Math.min(hook.length, Math.floor((z - a - 1) / 1));
              for (let k = 0; k < len && a + k * 2 < z - 1; k++) push(ly, { t: t0 + a + k * 2, dur: k === len - 1 ? Math.min(4, z - a - k * 2) : 2, ps: [fitP(hook[k] + 12)], vel: vel - 10 });
            });
            break;
          }
          case "drums": {
            const style = lev;
            const kit = Array.from({ length: barLen }, () => []);
            const four = rec.beatsPerBar === 4;
            const beatAt = (o) => o % 2 === 0;
            for (let o = 0; o < barLen; o++) {
              const h = kit[o];
              if (style === "intro") { if (o === 0) h.push("K"); if (beatAt(o)) h.push("H"); }
              if (style === "brush") { if (o === 0) h.push("K"); if (four ? o === 2 || o === 6 : o === 2) h.push("S"); if (beatAt(o)) h.push("H"); }
              if (style === "light") { if (o === 0 || (four && o === 4)) h.push("K"); if (four ? o === 2 || o === 6 : o === 2 || o === 4) h.push("S"); h.push("H"); }
              if (style === "pre") { if (o === 0 || (four && o === 4)) h.push("K"); if (four ? o === 2 || o === 6 : o === 2 || o === 4) h.push("S"); h.push("H"); if (b === sec.bars - 1 && o >= barLen / 2) { if (!h.includes("S")) h.push("S"); } }
              if (style === "full" || style === "max") { if (o === 0 || (four && (o === 4 || o === 5))) h.push("K"); if (four ? o === 2 || o === 6 : o === 2 || o === 4) h.push("S"); h.push("H"); if (o === 0 && (b === 0 || (style === "max" && b % 2 === 0))) h.push("C"); if (style === "max" && o === 7 && four) h.push("K"); }
              if (style === "quiet") { if (o === 0) h.push("K"); if (o === barLen / 2) h.push("S"); if (beatAt(o)) h.push("H"); }
              if (style === "fade") { if (o === 0 && b % 2 === 0) h.push("K"); if (beatAt(o) && b < sec.bars - 1) h.push("H"); if (o === 0 && b === sec.bars - 1) h.push("C"); }
            }
            const at = kit.map((h, o) => (h.length ? o : -1)).filter((o) => o >= 0);
            at.forEach((o, k) => push(ly, { t: t0 + o, dur: (at[k + 1] ?? barLen) - o, hits: kit[o], vel: vel - (kit[o].includes("C") ? 0 : 10) }));
            break;
          }
          default: break;
        }
      });
    });
  });
  // player notes by role, in plain words
  layers.forEach((ly) => { ROLES.forEach((r) => { ly.notes[r] = playerNote(ly, (plan.levels[ly.id] || {})[r] || "off", r); }); });
  return { palette: pal, plan, layers, roles: rs, approachBar, keyBars: [...keyBars] };
}

const STYLE_WORDS = {
  off: "Tacet.", intro: "Hi-hat time with the kick on 1.", brush: "Brushes: kick on 1, snare swish on 2 and 4.", light: "Kick on 1 and 3, rim on 2 and 4, closed hi-hat eighths.",
  pre: "Kick on 1 and 3, snare on 2 and 4; build with snare eighths into the chorus.", full: "Kick on 1, 3 and the and of 3; snare on 2 and 4; crash into the section.",
  quiet: "Half-time: kick on 1, snare on 3, hi-hat quarters.", max: "Full groove, crash every two bars, the biggest the song gets.", fade: "Thin out: kick every other bar, a last crash.", silent: "Tacet.",
};
function playerNote(ly, lev, role) {
  if (ly.kind === "drums") return STYLE_WORDS[lev] || "Tacet.";
  if (lev === "off") return "Tacet.";
  const w = {
    strum: { sparse: "Half-note strums, let them ring.", on: "Quarter-note strums.", full: "Eighth-note strums, open and driving." },
    pick: { sparse: "Picked quarter notes.", on: "Picked eighths: root, fifth, octave, third.", full: "Picked eighths, digging in." },
    piano: { sparse: "Whole-note chords, below the voice.", on: "Half-note chords.", full: "Quarter-note chords with octave bass; above the voice under the held notes." },
    pad: { sparse: "Two-note sustain, quiet.", on: "Sustained chords above the voice.", full: "Full sustained chords, octave doubled." },
    bass: { sparse: "Roots, whole notes.", on: "Root and fifth, half notes.", full: "Roots on every beat, locked with the kick." },
    fill: { sparse: "Answer the voice only in the longest rests.", on: "Play the hook's opening notes in the gaps; stay out of the words." },
  }[ly.kind] || {};
  return w[lev] || w.on || "Play.";
}

// ---------- 9.12 the energy arc ----------
export function energyArc(rec, arr) {
  const { barLen } = rec;
  const rows = rec.sections.map((sec, si) => {
    const t0 = (sec.startBar - 1) * barLen, t1 = t0 + sec.bars * barLen;
    const evs = arr.layers.flatMap((ly) => ly.events.filter((e) => e.t >= t0 && e.t < t1).map((e) => ({ ...e, ly })));
    const tracks = new Set(evs.map((e) => e.ly.id)).size + (sec.notes.length ? 1 : 0);
    const onsets = (evs.reduce((a, e) => a + (e.ps ? e.ps.length : e.hits ? e.hits.length : 1), 0) + sec.notes.length) / sec.bars;
    const vel = evs.length ? evs.reduce((a, e) => a + (e.vel || 0), 0) / evs.length : 0;
    const drums = evs.filter((e) => e.hits).reduce((a, e) => a + e.hits.length, 0) / sec.bars;
    const mel = sec.notes.length ? [...sec.notes.map((n) => n.p)].sort((a, b) => a - b)[Math.floor(sec.notes.length / 2)] : 0;
    return { name: sec.name, role: arr.roles[si], bars: `${sec.startBar}–${sec.startBar + sec.bars - 1}`, tracks, onsets, vel, drums, mel, dyn: arr.plan.dynamics[arr.roles[si]] };
  });
  // composite: rank-average of density, velocity, tracks, drums and melody tessitura
  const keys = ["onsets", "vel", "tracks", "drums", "mel"];
  const rank = (k) => { const vals = rows.map((r) => r[k]); const sorted = [...vals].sort((a, b) => a - b); return vals.map((v) => { const lo = sorted.indexOf(v), hi = sorted.lastIndexOf(v); return (lo + hi) / 2 / Math.max(1, rows.length - 1); }); };
  const ranks = keys.map(rank);
  rows.forEach((r, i) => { r.energy = Math.round((ranks.reduce((a, rk) => a + rk[i], 0) / keys.length) * 100) / 100; });
  const flags = [];
  const first = (role) => rows.find((r) => r.role === role);
  const v = first("verse"), c = first("chorus") || first("final"), pc = first("prechorus"), br = first("bridge"), fin = first("final");
  let lift = null;
  if (v && c) {
    lift = Math.round((c.onsets / Math.max(0.01, v.onsets)) * 100) / 100;
    if (c.energy <= v.energy) flags.push("The first chorus is no more energetic than the first verse.");
  }
  if (pc && c && (pc.onsets > c.onsets || pc.vel > c.vel || pc.tracks > c.tracks)) flags.push("The pre-chorus is denser, louder or fuller than its chorus.");
  if (br && fin && br.energy >= fin.energy) flags.push("The bridge is as full as the final chorus.");
  if (fin && c && fin !== c && fin.energy <= c.energy) flags.push("The final chorus is no more energetic than the first.");
  const ch = rows.filter((r) => r.role === "chorus" || r.role === "final");
  const near = (a, b) => Math.abs(a - b) / Math.max(0.01, b) < 0.05;
  if (ch.length > 1 && ch.every((r) => near(r.onsets, ch[0].onsets) && near(r.vel, ch[0].vel) && r.tracks === ch[0].tracks)) flags.push("Every chorus has the same arrangement and level (a flatline).");
  return { rows, lift, liftBand: "real records ×1.082 at the median (middle half 0.972–1.364)", flags };
}

// ---------- 9.13 register collision ----------
export function registerAudit(rec, arr) {
  const { barLen } = rec;
  const out = rec.sections.map((sec) => {
    let inside = 0, total = 0, worst = { share: 0, bar: null, tracks: [] };
    for (let b = 0; b < sec.bars; b++) {
      const bar = sec.startBar - 1 + b, t0 = bar * barLen, t1 = t0 + barLen;
      const vn = rec.melody.filter((n) => n.t >= t0 && n.t < t1);
      if (!vn.length) continue;
      const lo = Math.min(...vn.map((n) => n.p)), hi = Math.max(...vn.map((n) => n.p));
      let bi = 0, bt = 0; const tr = new Set();
      arr.layers.forEach((ly) => {
        if (ly.kind === "drums" || ly.kind === "strum") return; // strums are written as rhythm
        ly.events.filter((e) => e.t >= t0 && e.t < t1 && e.ps).forEach((e) => e.ps.forEach((p) => { bt++; if (p >= lo && p <= hi) { bi++; tr.add(ly.name); } }));
      });
      inside += bi; total += bt;
      const share = bt ? bi / bt : 0;
      if (share > worst.share) worst = { share, bar: bar + 1, tracks: [...tr] };
    }
    const keyBad = arr.keyBars.filter((kb) => kb >= sec.startBar - 1 && kb < sec.startBar - 1 + sec.bars).filter((kb) => {
      const t0 = kb * barLen, t1 = t0 + barLen;
      const vn = rec.melody.filter((n) => n.t >= t0 && n.t < t1);
      if (!vn.length) return false;
      const lo = Math.min(...vn.map((n) => n.p)), hi = Math.max(...vn.map((n) => n.p));
      let bi = 0, bt = 0;
      arr.layers.forEach((ly) => { if (ly.kind === "drums" || ly.kind === "strum") return; ly.events.filter((e) => e.t >= t0 && e.t < t1 && e.ps).forEach((e) => e.ps.forEach((p) => { bt++; if (p >= lo && p <= hi) bi++; })); });
      return bt && bi / bt > 0.25;
    }).map((kb) => kb + 1);
    return { name: sec.name, share: total ? Math.round((inside / total) * 100) / 100 : 0, worst, crowdedKeyBars: keyBad };
  });
  return out;
}

// ---------- the producer one-sheet ----------
export function oneSheet(rec, song, arr, extra = {}) {
  const levelWord = { p: "soft", mp: "medium soft", mf: "medium", f: "strong", ff: "the loudest" };
  const arc = rec.sections.map((s, i) => {
    const role = arr.roles[i];
    const on = arr.layers.filter((ly) => ((arr.plan.levels[ly.id] || {})[role] || "off") !== "off").map((ly) => ly.name);
    let change = on.length ? `${on.join(", ")}` : "voice alone";
    if (role === "final") change += "; everything up";
    if (role === "bridge") change += "; thinned so the words carry";
    const silence = arr.approachBar >= s.startBar - 1 && arr.approachBar < s.startBar - 1 + s.bars ? `the band stops at the half bar of bar ${arr.approachBar + 1}: one beat of air before the final chorus` : "";
    return { section: s.name, bars: `${s.startBar}–${s.startBar + s.bars - 1}`, level: `${arr.plan.dynamics[role]} (${levelWord[arr.plan.dynamics[role]]})`, change, silence };
  });
  const title = rec.title;
  return {
    target: extra.target || `${song.q0 ? `In the writer's words, it is about this: "${song.q0.replace(/\.$/, "")}."` : ""} ${song.tension && song.tension.statement ? `The record holds the tension and does not resolve it: ${song.tension.statement.replace(/\.$/, "")}.` : ""}`.trim(),
    references: extra.references || [],
    arc,
    nonNegotiables: [
      `The title, "${title}", is always clear and on top.`,
      arr.approachBar >= 0 ? `The silence before the final chorus (bar ${arr.approachBar + 1}, second half) stays silent.` : null,
      "The verse stays under the chorus; the final chorus is the biggest moment.",
      `The lead instrument (${arr.layers.find((l) => l.kind === "fill") ? arr.layers.find((l) => l.kind === "fill").name : "none"}) answers the voice in its rests and never plays over the words.`,
    ].filter(Boolean),
    mix: [
      "Voice in the centre and on top; nothing covers the held title note.",
      "Bass below the voice; high-pass everything but the bass.",
      "Keys and strings voiced above the voice under the held notes.",
      "Peaks at -6 dBFS before mastering.",
    ],
  };
}
