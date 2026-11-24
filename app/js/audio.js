// Playback and MIDI for a melody candidate: melody, chord pad and bass, so a candidate
// is judged with harmony under it (27.7: SYNTH_VERDICT).

import { chordTones } from "./engine/melody.js";

// Lay the sections end to end in sung order: [{p, t (eighths), dur, syl}], chords per bar.
export function timeline(cand, brief) {
  const notes = [], chords = [];
  let t = 0;
  const barLen = brief.beatsPerBar * 2;
  cand.sections.forEach((sec) => {
    sec.notes.forEach((n) => notes.push({ ...n, t: t + n.onset, section: sec.name }));
    const bars = Math.ceil(sec.length / barLen);
    for (let b = 0; b < bars; b++) {
      const roman = sec.loop[b % sec.loop.length];
      const c = chordTones(roman, brief.key.mode);
      chords.push({ t: t + b * barLen, dur: barLen, roman, root: c.root, tones: c.tones, section: sec.name });
    }
    t += bars * barLen;
  });
  return { notes, chords, length: t };
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
let ctx = null, playing = null;

export function stop() {
  if (playing) { playing.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }); playing = null; }
}

export function play(tl, brief, { from = 0, to = Infinity, onEnd } = {}) {
  stop();
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  const e = 30 / brief.bpm; // seconds per eighth
  const start = ctx.currentTime + 0.08;
  const nodes = [];
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  const voice = (freq, t0, dur, type, gain, attack = 0.02) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setTargetAtTime(gain * 0.6, t0 + attack, dur * 0.4);
    g.gain.setTargetAtTime(0, t0 + Math.max(attack, dur - 0.04), 0.03);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.2);
    nodes.push(o);
  };
  const tonicOct = 48 + brief.key.tonic;
  tl.chords.filter((c) => c.t >= from && c.t < to).forEach((c) => {
    const t0 = start + (c.t - from) * e, d = c.dur * e;
    c.tones.forEach((pc) => voice(midiHz(tonicOct + ((pc + 12) % 12)), t0, d * 0.98, "sine", 0.05, 0.08));
    voice(midiHz(36 + ((brief.key.tonic + c.root) % 12)), t0, e * 3, "triangle", 0.18);
    voice(midiHz(36 + ((brief.key.tonic + c.root) % 12)), t0 + d / 2, e * 3, "triangle", 0.14);
  });
  tl.notes.filter((n) => n.t >= from && n.t < to).forEach((n) => {
    const t0 = start + (n.t - from) * e, d = Math.max(0.12, n.dur * e * 0.95);
    voice(midiHz(n.p), t0, d, "triangle", 0.22);
    voice(midiHz(n.p) * 2, t0, d, "sine", 0.04);
  });
  playing = nodes;
  const end = Math.min(to, tl.length) - from;
  const timer = setTimeout(() => { if (playing === nodes) { playing = null; onEnd && onEnd(); } }, end * e * 1000 + 300);
  nodes.push({ stop: () => clearTimeout(timer) });
}

// ---- Standard MIDI file: tempo, melody with lyrics, chords, bass ----
function vlq(n) { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; }
function track(events) {
  events.sort((a, b) => a.t - b.t || a.o - b.o);
  const bytes = [];
  let last = 0;
  events.forEach((ev) => { bytes.push(...vlq(ev.t - last), ...ev.d); last = ev.t; });
  bytes.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, ...[24, 16, 8, 0].map((s) => (bytes.length >> s) & 0xff), ...bytes];
}
const ascii = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0); return c < 128 ? c : 63; });
const meta = (type, data) => [0xff, type, ...vlq(data.length), ...data];

export function midiFile(tl, brief, title) {
  const PPQ = 480, E = PPQ / 2;
  const us = Math.round(60000000 / brief.bpm);
  const conductor = [
    { t: 0, o: 0, d: meta(0x03, ascii(title || "Song")) },
    { t: 0, o: 0, d: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { t: 0, o: 0, d: meta(0x58, [brief.beatsPerBar, 2, 24, 8]) },
  ];
  const mel = [{ t: 0, o: 0, d: meta(0x03, ascii("Voice")) }, { t: 0, o: 0, d: [0xc0, 52] }];
  tl.notes.forEach((n) => {
    const t = n.t * E, d = Math.max(1, n.dur * E - 20);
    if (n.syl && n.syl !== "–") mel.push({ t, o: 1, d: meta(0x05, ascii(n.syl)) });
    mel.push({ t, o: 2, d: [0x90, n.p, 92] }, { t: t + d, o: 0, d: [0x80, n.p, 0] });
  });
  const chd = [{ t: 0, o: 0, d: meta(0x03, ascii("Chords")) }, { t: 0, o: 0, d: [0xc1, 0] }];
  const bas = [{ t: 0, o: 0, d: meta(0x03, ascii("Bass")) }, { t: 0, o: 0, d: [0xc2, 33] }];
  tl.chords.forEach((c) => {
    const t = c.t * E, d = c.dur * E - 10;
    chd.push({ t, o: 1, d: meta(0x06, ascii(c.roman)) });
    c.tones.forEach((pc) => { const p = 48 + ((brief.key.tonic + pc) % 12); chd.push({ t, o: 2, d: [0x91, p, 60] }, { t: t + d, o: 0, d: [0x81, p, 0] }); });
    const b = 36 + ((brief.key.tonic + c.root) % 12);
    bas.push({ t, o: 2, d: [0x92, b, 90] }, { t: t + d, o: 0, d: [0x82, b, 0] });
  });
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 4, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...head, ...track(conductor), ...track(mel), ...track(chd), ...track(bas)]);
}
