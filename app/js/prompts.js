// Prompts that hand the spec to Claude. Each call is memory-less, so every prompt
// carries the spec text it needs, the song's record so far, and the output format.

import { TYPES, typeLabel } from "./engine/triage.js";

let SPEC = null;
export async function loadSpec(url = "data/spec.json") {
  if (SPEC) return SPEC;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`spec: ${r.status}`);
  SPEC = await r.json();
  return SPEC;
}
export function spec() { return SPEC; }

function primaryModules(type) {
  const codes = (type || "P").split("/");
  return codes.map((c) => (TYPES[c] ? TYPES[c].module : "P"));
}

function typeText(type) {
  const mods = [...new Set(primaryModules(type))];
  return mods.map((m) => SPEC.types[m]).join("\n\n");
}

function record(s) {
  const lines = [];
  lines.push(`SEED: ${s.seed || "(none)"}`);
  if (s.q0) lines.push(`Q0, the writer's own words (verbatim, sovereign): ${s.q0}`);
  if (s.type) lines.push(`TYPE: ${s.type} (${typeLabel(s.type)})`);
  (s.log || []).forEach((e) => lines.push(`${e.id || ""} ${e.question} -> ${e.answer}`));
  if (s.tension && s.tension.statement) lines.push(`TENSION: ${s.tension.statement}`);
  const c = s.contract || {};
  if (c.title) lines.push(`TITLE (locked): ${c.title}`);
  if (c.neverSay) lines.push(`NEVER-SAY: ${c.neverSay}`);
  if (c.objects) lines.push(`OBJECTS OF THE STORY: ${c.objects}`);
  if (c.writerPhrases) lines.push(`WRITER'S PHRASES (use as written): ${c.writerPhrases}`);
  if (c.voice) lines.push(`VOICE: ${c.voice}${c.voiceChar ? ` (${c.voiceChar})` : ""}`);
  if (c.bpm) lines.push(`TEMPO: ${c.bpm} BPM, ${c.feel || ""}`);
  if (c.key) lines.push(`KEY: ${c.key}`);
  if (c.form) lines.push(`FORM: ${c.form}`);
  (s.constraints || []).forEach((k) => lines.push(`CONSTRAINT IN FORCE: ${k}`));
  return lines.join("\n");
}

const STYLE = `Write plainly. Lyrics are plain text: no punctuation at line ends, as few dashes as possible.`;

export function intakePrompt(s) {
  return `You are running Luthier v45, a songwriting engine, for a songwriter. Below is the engine's template for this song's type, then the session record.

Your job now: ask the NEXT question of this type's intake protocol (for example N1-N5, L1-L4, G1-G3, A1-A4, V1-V6, PR1-PR5, W1-W6, M1-M4, B1-B5, T1-T5, or for Paradox the 9-Question Intake Q2-Q9 of Module 10.1). Ask exactly one question. Skip a question the record already answers. Do not answer intake questions on the writer's behalf. When the type's intake is complete, return done.

Offer three short options the writer can tap (A, B, C), written from this song's seed and answers, plus a recommendation when one option clearly serves the Q0 answer best. The writer can also type their own answer, so options are suggestions, not limits.

=== TYPE TEMPLATE (${typeLabel(s.type)}) ===
${typeText(s.type)}

=== SESSION RECORD ===
${record(s)}

Return JSON only:
{"done": false, "id": "N2", "question": "the question, one sentence", "why": "what it extracts, under 15 words", "options": ["A text", "B text", "C text"], "recommended": 0}
or {"done": true}`;
}

export function checkpointAPrompt(s) {
  return `You are running Luthier v45. Checkpoint (a): tension, hook, and form. Use the engine's rules below and the session record.

Rules that matter here: the tension is two things true at once that refuse to resolve (Principle 3, 5); the hook states the tension in 4-9 syllables and passes the mouth test (checklist 5); the title sits in the hook position; the tension holds veto power over every default (Principle 7); Q0 is the filter for every option.

=== CORE ===
${SPEC.lite.slice(0, 6000)}

=== HOOK ARCHITECTURE (excerpt) ===
${SPEC.hook.slice(0, 9000)}

=== TYPE TEMPLATE (${typeLabel(s.type)}) ===
${typeText(s.type).slice(0, 14000)}

=== SESSION RECORD ===
${record(s)}

Propose: the tension in one sentence; three hook lines (each a title in 4-9 syllables, different in kind); a form for this type with a one-line reason; and defaults the writer can change: the voice's character (one phrase), the voice row from Module 11.2 (exactly one of: male, female, male worship, female worship, male gospel, female gospel, anthemic, congregational, bass; read it from the writer's answers, e.g. a "clear female voice" is female), tempo in BPM with the feel, key, three to six concrete objects from the writer's own answers, and the never-say list: the words and phrases the writer's "must not sound like, say, or feel" answer rules out, written as a comma list of concrete words and phrases (for example "little green men, flying saucer"). If the writer gave no such answer, write "none".

Return JSON only:
{"tension": "...", "hooks": [{"title": "...", "why": "under 15 words"}, {...}, {...}], "recommended": 0, "form": "V-PC-C-V-PC-C-B-C", "formWhy": "...", "voice": "...", "voiceRow": "female", "bpm": 76, "feel": "a few words", "key": "A major", "objects": ["...", "..."], "neverSay": "word, phrase, phrase"}`;
}

function lyricRules() {
  return `=== MODULE 10: LYRIC RULES ===
${SPEC.lyric}

=== 10.7 PHONETIC SCRUB ===
${SPEC.phonetic}

=== 10.9 THE LADDER AND THE OBJECT (excerpt) ===
${SPEC.ladder.slice(0, 5000)}`;
}

export function draftPrompt(s) {
  return `You are running Luthier v45. Checkpoint (c): write the lyric skeleton as a full first draft from the writer's intake material. The writer finishes the song; this draft is the measured scaffold they edit.

Hard rules the app will measure after you write: every verse line holds a concrete picture (Rule V1, read on the couplet); no line ends on a conjunction, preposition, article or dangling "it" (Window 32) unless it is a build line; verse lines 6-9 syllables, close but not identical in pairs; chorus lines shorter, paired lines within one syllable, the chorus repeating its own words; the title in the chorus's first or last line, about six times in the song; the last word of the chorus ends on an open vowel or L/R, one syllable if possible; the bridge four lines at most, plain and heavy; no word from the never-say list; the writer's phrases used as written; at singing speed nothing crowded. Rhyme at least loosely in every block.

${lyricRules()}

=== TYPE TEMPLATE (${typeLabel(s.type)}) ===
${typeText(s.type)}

=== SESSION RECORD ===
${record(s)}

${STYLE}
Output only the lyric sheet. Mark every section with a header line in square brackets, like [Verse 1], [Pre-Chorus], [Chorus], [Bridge]. Write every chorus out in full each time it is sung (the final chorus may be the inversion: same melody, new knowledge). Mark a deliberate build line by ending it with " >". Never write tags such as [HOLD] inside a line. No commentary before or after.`;
}

export function revisePrompt(s, lyric, readings, note) {
  return `You are running Luthier v45. The writer wants a revision of their lyric. The writer's note comes first; the engine's readings are information, not verdicts (Principle 10). Keep every line the writer did not ask to change, and keep each changed line's kernel. Lines listed as constraints in force are kept exactly.

${lyricRules()}

=== TYPE TEMPLATE (${typeLabel(s.type)}) ===
${typeText(s.type).slice(0, 12000)}

=== SESSION RECORD ===
${record(s)}

=== CURRENT LYRIC ===
${lyric}

=== ENGINE READINGS ===
${readings}

=== THE WRITER'S NOTE ===
${note || "Fix what the readings flag, starting with the floors, then the flags. Change as little as possible."}

${STYLE}
Output only the full revised lyric sheet, same header format ([Verse 1], [Chorus] ...). No commentary.`;
}

export function coachPrompt(s, line, section, problems, neighbors) {
  return `You are running Luthier v45's lyric coach (Module 29: coach one line at a time, keep the line's kernel in every alternative). Write three alternatives for ONE line of the writer's lyric.

The line: "${line}"
Its section: ${section}
Lines around it:
${neighbors}
What the engine measured: ${problems}

Rules: keep the kernel (what the line means and its key image); fix what was measured; verse lines carry a concrete picture; end on a concrete noun or a verb; keep the syllable count near the original; plain words; no never-say words. Three alternatives different in approach.

=== SESSION RECORD ===
${record(s)}

Return JSON only: {"alternatives": ["...", "...", "..."]}`;
}

export function suggestTypePrompt(lyric) {
  return `You are running Luthier v45's lyric-first path (Module 29). The writer brought a finished lyric. Read it before judging it: suggest the song type with the evidence, as a suggestion. Also find the title (the line or phrase the song is built around).

=== MODULE 0: TYPES ===
${SPEC.module0.slice(0, 7000)}

=== THE LYRIC ===
${lyric}

Return JSON only: {"type": "one of P, N, LR, LD, G, A, V, PR, W, M, B, T (or a hybrid like N/LR)", "evidence": "two sentences quoting the lyric", "title": "...", "alternatives": ["X", "Y"]}`;
}

export function completionPrompt(s, lyric) {
  return `You are running Luthier v45's completion check against Q0. Return to the writer's Q0 answer: does the finished lyric deliver what the writer said the song was about? Answer as information, briefly, quoting the lyric.

Q0 (verbatim): ${s.q0}
Tension: ${(s.tension && s.tension.statement) || ""}

=== THE LYRIC ===
${lyric}

Return JSON only: {"delivers": "yes" | "partly" | "no", "reading": "two or three sentences", "lost": "what was lost, or empty"}`;
}

// The workshop: Claude proposes line-by-line changes; the writer accepts or rejects each.
export function changesPrompt(s, numbered, readings, instruction) {
  return `You are running Luthier v45's lyric workshop. The writer will review every change you propose and accept or reject each one, so propose only what the instruction asks for, as few lines as possible, keeping each changed line's kernel and the song's voice. Lines listed as constraints in force are never changed. A line the writer has already rewritten by hand is theirs: change it only if the instruction names it.

${lyricRules().slice(0, 9000)}

=== SESSION RECORD ===
${record(s)}

=== THE LYRIC, LINES NUMBERED ===
${numbered}

=== ENGINE READINGS (information, not verdicts) ===
${readings}

=== THE INSTRUCTION ===
${instruction}

Rules: replace whole lines only, by their number; never change a section header; keep lines singable at the same melody length (within one syllable unless the instruction asks otherwise); never write tags like [HOLD]; plain text, no punctuation at line ends.
Return JSON only: {"summary": "one or two sentences in plain words: what you changed and why", "changes": [{"line": 12, "new": "the new line", "why": "under 15 words"}]}
If nothing should change, return {"summary": "why not", "changes": []}.`;
}

export function askPrompt(s, lyric, readings, question) {
  return `You are Luthier v45, a songwriting engine, answering the writer's question about their lyric. Answer in plain words for a songwriter, in three to six sentences, using the spec's evidence where it helps. Say clearly whether something is a real problem for this song or just information. Do not rewrite the lyric; you may quote a line and suggest what to try.

=== CORE RULES (excerpt) ===
${SPEC.lyric.slice(0, 7000)}

=== SESSION RECORD ===
${record(s)}

=== THE LYRIC ===
${lyric}

=== ENGINE READINGS ===
${readings}

=== THE QUESTION ===
${question}

Return JSON only: {"answer": "..."}`;
}
