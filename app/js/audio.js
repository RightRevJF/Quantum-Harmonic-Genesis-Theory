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

// ---- the arrangement: every layer, played and written ----
const DRUM_NOTE = { K: 36, S: 38, H: 42, C: 49 };
export function playArrangement(rec, arr, { from = 0, to = Infinity, onEnd } = {}) {
  stop();
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  const e8 = 30 / rec.bpm;
  const start = ctx.currentTime + 0.08;
  const nodes = [];
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  const tone = (freq, t0, dur, type, gain, attack = 0.01, release = 0.05) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.setTargetAtTime(gain * 0.5, t0 + attack, Math.max(0.05, dur * 0.5));
    g.gain.setTargetAtTime(0, t0 + Math.max(attack, dur - release), release);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.3); nodes.push(o);
  };
  let noiseBuf = null;
  const noise = (t0, dur, gain, hp) => {
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
    g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.05); nodes.push(s);
  };
  const within = (t) => t >= from && t < to;
  rec.melody.filter((n) => within(n.t)).forEach((n) => { const t0 = start + (n.t - from) * e8; tone(midiHz(n.p), t0, Math.max(0.15, n.dur * e8 * 0.95), "triangle", 0.2, 0.02, 0.08); });
  arr.layers.forEach((ly) => {
    ly.events.filter((ev) => within(ev.t)).forEach((ev) => {
      const t0 = start + (ev.t - from) * e8, d = ev.dur * e8, v = (ev.vel || 80) / 127;
      if (ly.kind === "drums") {
        ev.hits.forEach((h) => {
          if (h === "K") tone(55, t0, 0.18, "sine", 0.5 * v, 0.003, 0.1);
          if (h === "S") noise(t0, ly.brushes ? 0.25 : 0.15, (ly.brushes ? 0.12 : 0.3) * v, ly.brushes ? 2500 : 1200);
          if (h === "H") noise(t0, 0.05, 0.08 * v, 7000);
          if (h === "C") noise(t0, 1.2, 0.15 * v, 4000);
        });
        return;
      }
      const ps = ev.ps || [];
      const kind = ly.kind;
      ps.forEach((p) => {
        if (kind === "pad") tone(midiHz(p), t0, d, "sine", 0.05 * v, Math.min(0.4, d / 3), 0.3);
        else if (kind === "bass") tone(midiHz(p - 12), t0, Math.min(d, 1.2), "triangle", 0.3 * v, 0.005, 0.08);
        else if (kind === "fill") tone(midiHz(p), t0, d * 0.95, "square", 0.04 * v, 0.03, 0.08);
        else if (kind === "strum") tone(midiHz(p), t0 + ps.indexOf(p) * 0.012, Math.min(d, 0.6), "triangle", 0.05 * v, 0.003, 0.1);
        else tone(midiHz(p), t0, Math.min(d, 1.5), "triangle", 0.07 * v, 0.004, 0.15);
      });
    });
  });
  playing = nodes;
  const end = (Math.min(to, rec.totalBars * rec.barLen) - from) * e8;
  const timer = setTimeout(() => { if (playing === nodes) { playing = null; onEnd && onEnd(); } }, end * 1000 + 600);
  nodes.push({ stop: () => clearTimeout(timer) });
}

export function midiFromRecord(rec, arr) {
  const PPQ = 480, E = PPQ / 2;
  const us = Math.round(60000000 / rec.bpm);
  const tracks = [];
  tracks.push([{ t: 0, o: 0, d: meta(0x03, ascii(rec.title || "Song")) }, { t: 0, o: 0, d: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) }, { t: 0, o: 0, d: meta(0x58, [rec.beatsPerBar, 2, 24, 8]) },
    ...rec.sections.map((s) => ({ t: (s.startBar - 1) * rec.barLen * E, o: 0, d: meta(0x06, ascii(s.name)) }))]);
  // 9.6: the guide melody is breath-, wood- or string-driven (never choir or pad): the palette's lead
  const lead = (arr.layers.find((l) => l.kind === "fill") || { gm: 73 }).gm;
  const accent = (t) => { const pos = t % rec.barLen; return pos === 0 ? 10 : rec.beatsPerBar === 4 && pos === rec.barLen / 2 ? 5 : pos % 2 ? -8 : 0; };
  const voice = [{ t: 0, o: 0, d: meta(0x03, ascii("Voice (guide)")) }, { t: 0, o: 0, d: [0xc0, lead] }, { t: 0, o: 0, d: [0xb0, 7, 110] }];
  rec.melody.forEach((n) => { const t = n.t * E, d = Math.max(1, n.dur * E - 20); if (n.word && !n.part) voice.push({ t, o: 1, d: meta(0x05, ascii(n.word)) }); const v = Math.max(1, Math.min(127, 92 + accent(n.t) + (n.stress > 0 ? 6 : 0))); voice.push({ t, o: 2, d: [0x90, n.p, v] }, { t: t + d, o: 0, d: [0x80, n.p, 0] }); });
  tracks.push(voice);
  let ch = 1;
  arr.layers.forEach((ly) => {
    if (ly.kind !== "drums" && ch === 9) ch++;
    const c = ly.kind === "drums" ? 9 : ch++;
    const tr = [{ t: 0, o: 0, d: meta(0x03, ascii(ly.name)) }];
    if (ly.kind !== "drums") tr.push({ t: 0, o: 0, d: [0xc0 | c, ly.gm || 0] }, { t: 0, o: 0, d: [0xb0 | c, 10, { strum: 40, pick: 40, piano: 64, pad: 88, bass: 64, fill: 80 }[ly.kind] ?? 64] }, { t: 0, o: 0, d: [0xb0 | c, 7, ly.kind === "pad" ? 80 : 96] });
    ly.events.forEach((ev) => {
      // metric accents (9.3); pads and strings sustain to the bar line, plucked parts stay short
      const legato = ly.kind === "pad" || ly.kind === "piano";
      const t = ev.t * E, d = Math.max(1, ev.dur * E - (legato ? 4 : 30)), v = Math.max(1, Math.min(127, (ev.vel || 80) + (ly.kind === "pad" ? 0 : accent(ev.t))));
      const ps = ly.kind === "drums" ? ev.hits.map((h) => DRUM_NOTE[h]) : ly.kind === "bass" ? ev.ps.map((p) => p - 12) : ev.ps;
      ps.forEach((p) => tr.push({ t, o: 2, d: [0x90 | c, p, v] }, { t: t + (ly.kind === "drums" ? 60 : d), o: 0, d: [0x80 | c, p, 0] }));
    });
    tracks.push(tr);
  });
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...head, ...tracks.flatMap((t) => track(t))]);
}
