// PDFs from the song record: the notation is engraved by abcjs and placed in the PDF by
// jsPDF (as a high-resolution image, so the symbols and fonts come through intact); the
// chart and the songbook are set as text.

import * as D from "./engine/docs.js";

const PAGE = { w: 612, h: 792, margin: 44 };
const ascii = (s) => String(s ?? "").replace(/♭/g, "b").replace(/♯/g, "#").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/·/g, "-").replace(/𝄪/g, "x").replace(/𝄫/g, "bb");

function needLibs() {
  if (!window.ABCJS || !window.jspdf) throw new Error("The notation and PDF tools didn't load. Check the connection and reload the page.");
}

// Render one ABC tune to a PNG data URL; returns {url, w, h} in CSS pixels.
async function abcImage(abc, staffwidth = 700) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:" + (staffwidth + 40) + "px;background:#fff;color:#000";
  document.body.append(host);
  try {
    window.ABCJS.renderAbc(host, abc, { staffwidth, paddingtop: 4, paddingbottom: 4, paddingleft: 4, paddingright: 4, foregroundColor: "#000000", format: { titlefont: "Georgia 20", subtitlefont: "Georgia 13", composerfont: "Georgia 11", vocalfont: "Helvetica 11", annotationfont: "Helvetica 11 bold", gchordfont: "Helvetica 12 bold", voicefont: "Helvetica 10" } });
    const svg = host.querySelector("svg");
    if (!svg) throw new Error("engraving failed");
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : null;
    const w = vb ? vb.width : Number(svg.getAttribute("width")) || staffwidth;
    const h = vb ? vb.height : Number(svg.getAttribute("height")) || 200;
    svg.setAttribute("width", w); svg.setAttribute("height", h);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const xml = new XMLSerializer().serializeToString(svg).replace(/\u00a0/g, " ").replace(/&nbsp;/g, " ");
    const img = new Image();
    const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("image")); img.src = src; });
    const scale = 3;
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL("image/png"), w, h };
  } finally { host.remove(); }
}

function footer(doc, rec, label) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(ascii(`${rec.title} - ${label}${rec.writer ? " - Words and music: " + rec.writer : ""}`), PAGE.margin, PAGE.h - 22);
    doc.text(`${i} / ${n}`, PAGE.w - PAGE.margin, PAGE.h - 22, { align: "right" });
    doc.setTextColor(0);
  }
}

async function placeSystems(doc, systems, y, { onProgress, label, staffwidth = 700 } = {}) {
  const width = PAGE.w - PAGE.margin * 2;
  for (let i = 0; i < systems.length; i++) {
    const im = await abcImage(systems[i].abc, staffwidth);
    const h = (im.h * width) / im.w;
    if (y + h > PAGE.h - 40) { doc.addPage(); y = PAGE.margin; }
    if (i > 0 || !/^T:/m.test(systems[i].abc)) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120);
      doc.text(String(systems[i].firstBar), PAGE.margin - 14, y + 14);
      doc.setTextColor(0);
    }
    doc.addImage(im.url, "PNG", PAGE.margin, y, width, h, undefined, "FAST");
    y += h + 6;
    if (onProgress) onProgress(`${label || "Engraving"}: system ${i + 1} of ${systems.length}`);
  }
  return y;
}

function newDoc() { const { jsPDF } = window.jspdf; return new jsPDF({ unit: "pt", format: "letter" }); }

export async function leadSheetPdf(rec, opts = {}) {
  needLibs();
  const doc = newDoc();
  const systems = D.scoreSystems(rec, ["voice"], { per: D.barsPerSystem(rec) });
  let y = PAGE.margin;
  y = await placeSystems(doc, systems, y, { ...opts, label: "Lead sheet" });
  if (rec.male) { doc.setFontSize(8); doc.text("The voice is written an octave higher than it sounds (treble clef with an 8).", PAGE.margin, Math.min(y + 8, PAGE.h - 34)); }
  footer(doc, rec, "lead sheet");
  return doc.output("arraybuffer");
}

export async function scoreAndPartsPdf(rec, opts = {}) {
  needLibs();
  const doc = newDoc();
  const all = D.INSTRUMENTS.map((x) => x.id);
  const score = D.scoreSystems(rec, all, { per: Math.min(4, D.barsPerSystem(rec) + 1) });
  let y = PAGE.margin;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(90);
  doc.text("FULL SCORE", PAGE.margin, y); doc.setTextColor(0);
  y = await placeSystems(doc, score, y + 8, { ...opts, label: "Full score", staffwidth: 1000 });
  for (const ins of D.INSTRUMENTS) {
    doc.addPage();
    const systems = D.partSystems(rec, ins.id, { title: true, per: ins.id === "voice" ? D.barsPerSystem(rec) : 4 });
    systems[0].abc = systems[0].abc.replace(/^(T:.*)$/m, `$1\nT:${ins.name}`);
    let py = PAGE.margin;
    py = await placeSystems(doc, systems, py, { ...opts, label: `${ins.name} part` });
    const notes = D.PLAYER_NOTES[ins.id];
    if (notes) {
      if (py > PAGE.h - 120) { doc.addPage(); py = PAGE.margin; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(`${ins.name}: by section`, PAGE.margin, py + 14);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9);
      let ly = py + 28;
      rec.sections.filter((s, i) => rec.sections.findIndex((x) => x.kind === s.kind) === i).forEach((s) => {
        const role = { intro: "intro", verse: "verse", prechorus: "build", chorus: "full", bridge: "thin" }[s.kind] || "verse";
        doc.text(ascii(`${s.name.replace(/\s*\d+$/, "")}: ${notes[role]}`), PAGE.margin, ly); ly += 13;
      });
    }
    if (ins.id === "bass") { doc.setFontSize(8); doc.text("Written an octave higher than it sounds.", PAGE.margin, PAGE.h - 34); }
    if (ins.id === "drums") { doc.setFontSize(8); doc.text("Bottom space: kick. Third space: snare. Top (x): hi-hat. Above the staff (x): crash.", PAGE.margin, PAGE.h - 34); }
  }
  footer(doc, rec, "full score and parts");
  return doc.output("arraybuffer");
}

export function chartPdf(rec) {
  needLibs();
  const doc = newDoc();
  const c = D.chart(rec);
  const m = PAGE.margin;
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text(ascii(c.title), m, m + 10);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(ascii(`Nashville chart  -  Key ${c.key}  -  ${c.bpm} BPM  -  ${c.meter}${c.feel ? "  -  " + c.feel : ""}`), m, m + 28);
  if (rec.writer) doc.text(ascii(`Words and music: ${rec.writer}`), m, m + 42);
  let y = m + 66;
  const cellW = (PAGE.w - m * 2) / 4;
  c.rows.forEach((row) => {
    const lines = Math.ceil(row.cells.length / 4);
    const need = 22 + lines * 34 + 16;
    if (y + need > PAGE.h - 40) { doc.addPage(); y = m; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(ascii(`${row.name}  (${row.bars} bars, from bar ${row.startBar})`), m, y);
    y += 8;
    for (let i = 0; i < row.cells.length; i++) {
      const col = i % 4, line = Math.floor(i / 4);
      const x = m + col * cellW, yy = y + line * 34;
      doc.setDrawColor(170); doc.line(x, yy, x, yy + 28);
      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.text(ascii(row.cells[i]), x + 10, yy + 18);
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(120); doc.text(ascii(row.names[i]), x + 10, yy + 27); doc.setTextColor(0);
    }
    y += lines * 34 + 4;
    doc.setFont("helvetica", "italic"); doc.setFontSize(9);
    doc.text(ascii(`Drums: ${row.drums}`), m, y + 6);
    y += 26;
  });
  footer(doc, rec, "Nashville chart");
  return doc.output("arraybuffer");
}

export function songbookPdf(rec, song) {
  needLibs();
  const doc = newDoc();
  const b = D.songbook(rec, song);
  const m = PAGE.margin, W = PAGE.w - m * 2;
  let y = m;
  const ensure = (h) => { if (y + h > PAGE.h - 44) { doc.addPage(); y = m; } };
  const h1 = (t) => { ensure(40); doc.setFont("times", "bold"); doc.setFontSize(22); doc.text(ascii(t), m, y + 16); y += 30; };
  const h2 = (t) => { ensure(34); doc.setFont("times", "bold"); doc.setFontSize(14); doc.text(ascii(t), m, y + 12); y += 22; };
  const p = (t, size = 10, style = "normal") => { doc.setFont("times", style); doc.setFontSize(size); const ls = doc.splitTextToSize(ascii(t), W); ls.forEach((l) => { ensure(size + 4); doc.text(l, m, y + size); y += size + 3; }); y += 3; };
  h1(b.title);
  if (b.writer) p(`Words and music: ${b.writer}`, 11, "italic");
  h2("At a glance");
  p(`Key: ${b.glance.key}.  Tempo: ${b.glance.tempo}.  Metre: ${b.glance.meter}.  Length: ${b.glance.length}.`);
  p(`Form: ${b.glance.form}.`);
  if (b.glance.about) p(`What it is about, in the writer's words: "${b.glance.about}"`);
  if (b.glance.range) p(`Vocal range: ${b.glance.range}.`);
  p("How to play it: keep the verses down and let the chorus open up; the bridge thins out so the words carry. The band parts are a starting arrangement.");
  h2("Section by section");
  b.sections.forEach((s) => {
    p(`${s.name}  (bars ${s.bars})`, 11, "bold");
    s.lines.forEach((l) => { p(`[${l.chords.join(" ")}]  ${l.text}`, 10); p(l.melody, 9, "italic"); });
  });
  h2("For the singer");
  p(b.singer);
  h2("For each player");
  b.players.forEach((pl) => {
    p(pl.name, 11, "bold");
    const seen = new Set();
    pl.sections.forEach((s) => { const k = s.name.replace(/\s*\d+$/, ""); if (seen.has(k)) return; seen.add(k); p(`${k}: ${s.note}`, 10); });
  });
  doc.addPage(); y = m;
  h2("Lyric sheet with bar numbers");
  b.lyricSheet.forEach((s) => {
    p(s.name, 11, "bold");
    s.lines.forEach((l) => p(`${l.pickup ? `${l.bar} (pickup in ${l.pickup})` : l.bar}    ${l.text}`, 10));
  });
  h2("Score and parts");
  p("Full score and parts (one PDF): Voice, Guitar, Keys, Bass, Drums. Lead sheet. Nashville chart.");
  footer(doc, rec, "songbook");
  return doc.output("arraybuffer");
}

// Inline preview: the first systems of the lead sheet.
export function previewLeadSheet(el, rec) {
  if (!window.ABCJS) { el.textContent = "The notation tools didn't load."; return; }
  const systems = D.scoreSystems(rec, ["voice"], { per: D.barsPerSystem(rec) }).slice(0, 4);
  el.replaceChildren();
  systems.forEach((s) => { const d = document.createElement("div"); el.append(d); window.ABCJS.renderAbc(d, s.abc, { responsive: "resize", paddingleft: 0, paddingright: 0 }); });
}
