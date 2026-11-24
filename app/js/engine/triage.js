// Module 0 Extension: the Song Type Triage Protocol (Q0 + Q1-Q9), encoded from
// the spec's routing tables. Each answer adds weight to the types it keeps open
// or names, and removes the types it eliminates. Q0 stays the sovereign anchor:
// the writer confirms or overrides the type the routing suggests.

export const TYPES = {
  P: { name: "Paradox", job: "Hold two truths in irreducible tension simultaneously", module: "P" },
  N: { name: "Narrative", job: "Tell a story with a beginning, turning point, and ending image", module: "N" },
  LR: { name: "Lament (Resolved)", job: "Give voice to grief, with a turn toward ground", module: "L" },
  LD: { name: "Lament (Dark)", job: "Give voice to grief that does not resolve", module: "L" },
  G: { name: "Groove", job: "Generate the pleasurable urge to move", module: "G" },
  A: { name: "Anthem", job: "The room declaring together with one voice", module: "A" },
  V: { name: "Love Song", job: "Name a specific love in its specific state", module: "V" },
  PR: { name: "Prophetic", job: "Speak a word that re-names present reality and calls toward a different one", module: "PR" },
  W: { name: "Praise/Worship", job: "Directed adoration toward a being or reality larger than the self", module: "W" },
  M: { name: "Meditative", job: "Bring the listener to stillness", module: "M" },
  B: { name: "Blues", job: "Name the suffering, find the ironic twist, keep standing", module: "B" },
  T: { name: "Gospel / Testimony", job: "Tell the redemption: before, encounter, invitation", module: "T" },
};

const ALL = Object.keys(TYPES).filter((t) => t !== "B" && t !== "T");

// keep: +1, name: +2 (primary candidates), drop: eliminated
export const QUESTIONS = [
  {
    id: "Q1", label: "Motion",
    question: "Is this song moving somewhere, or does it stay in one place?",
    help: "Does it travel from one emotional state to another, or live inside a single feeling the whole time?",
    options: [
      { text: "Moving: it goes from A to B", keep: ["P", "N", "LR", "A", "V", "PR", "W"], drop: ["LD", "M", "G"] },
      { text: "Staying: it lives in one place", keep: ["LD", "M", "G", "V"], drop: ["N", "PR", "A"] },
      { text: "Both: it circles back transformed", keep: ["P", "LR", "W", "V", "M"], drop: ["N", "LD"] },
    ],
  },
  {
    id: "Q2", label: "Payload",
    question: "What does this song primarily ask the listener to do?",
    help: "Not what it says: what it asks the listener's body or mind to do while they're inside it.",
    options: [
      { text: "Feel something specific: grief, longing, heartbreak, wonder", name: ["LR", "LD", "V", "M"] },
      { text: "Hold two things at once: two truths in tension", name: ["P"] },
      { text: "Follow a story", name: ["N"] },
      { text: "Move the body", name: ["G"] },
      { text: "Declare something together", name: ["A"] },
      { text: "Speak to God, or be addressed by something larger", name: ["W", "PR"] },
      { text: "Slow down and arrive at stillness", name: ["M"] },
    ],
  },
  {
    id: "Q3", label: "Subject",
    question: "Is this song about one specific person or situation, or about something larger?",
    help: "One person, one event, one grief, one moment, or a community, a pattern, a reality that affects many?",
    options: [
      { text: "One specific person, event, or moment", keep: ["V", "N", "LR", "LD"] },
      { text: "A shared experience: many people, a community", keep: ["A", "PR", "W", "LR", "G"] },
      { text: "Something universal that a specific detail represents", keep: ["P", "N", "LR", "V"] },
      { text: "Something inside the singer: a private interior state", keep: ["M", "V", "LD", "P"] },
    ],
  },
  {
    id: "Q4", label: "Resolution",
    question: "Does this song need to resolve, or is the tension the point?",
    help: "Does it arrive somewhere by the end, or stay open, stay in the question, stay in the grief?",
    options: [
      { text: "It resolves: it arrives somewhere", keep: ["LR", "V", "A", "W", "N", "PR"], drop: ["P", "LD"] },
      { text: "It stays open: the tension is the point", name: ["P", "LD"], keep: ["V", "M"], drop: ["A"] },
      { text: "It arrives somewhere, but incompletely", keep: ["LR", "V", "PR"] },
      { text: "It ends on an image or question, not an answer", keep: ["N", "P", "PR"] },
    ],
  },
  {
    id: "Q5", label: "Address",
    question: "Who is this song speaking to?",
    help: "Not who wrote it: who does the voice in the song address?",
    options: [
      { text: "God or a transcendent reality", name: ["W"], keep: ["PR", "LR", "LD"] },
      { text: "A specific other person", name: ["V"], keep: ["N", "LR"] },
      { text: "A community or room", name: ["A"], keep: ["PR", "G"] },
      { text: "The singer themselves", keep: ["M", "P", "LD", "V"] },
      { text: "No one: it observes or describes", keep: ["N", "M", "PR"] },
    ],
  },
  {
    id: "Q6", label: "Time",
    question: "Where does this song live in time?",
    help: "Past, present, future, or outside time altogether?",
    options: [
      { text: "Past: this already happened", keep: ["N", "V", "LR", "LD"] },
      { text: "Present: this is happening now", keep: ["LR", "LD", "V", "PR", "G"] },
      { text: "Future: this is coming, or could come", keep: ["PR", "A", "W"] },
      { text: "No time: it is always true", keep: ["W", "P", "M", "A"] },
    ],
  },
  {
    id: "Q7", label: "Body",
    question: "Where does this song land in the body?",
    help: "Chest. Throat. Gut. The legs. Or is it primarily in the mind?",
    options: [
      { text: "Chest: it opens or tightens there", keep: ["LR", "LD", "W", "V"] },
      { text: "Throat: it catches or lifts there", keep: ["P", "V", "PR", "W"] },
      { text: "Gut: weight, dread, or certainty", keep: ["PR", "LD", "P"] },
      { text: "Legs and hips: the urge to move", name: ["G"], keep: ["A"] },
      { text: "Head: a thought or observation", keep: ["N", "M", "P"] },
    ],
  },
  {
    id: "Q8", label: "Cost",
    question: "Is there something in this song that costs something to say?",
    help: "A truth that might offend. A grief too raw to perform. A love that exposes the singer.",
    options: [
      { text: "Yes: someone might object to this", name: ["PR"] },
      { text: "Yes: it exposes the singer", keep: ["LD", "V", "P"] },
      { text: "Yes: it says something uncomfortable to God", keep: ["LR", "LD", "W", "PR"] },
      { text: "Not particularly: it is true but not risky", keep: ["A", "W", "G", "N"], drop: ["PR"] },
    ],
  },
  {
    id: "Q9", label: "Singability",
    question: "Can the whole room sing this, or does it belong to one voice?",
    help: "Designed to be sung by everyone, or performed for an audience?",
    options: [
      { text: "The whole room: everyone should sing this", name: ["A"], keep: ["W", "G", "LR"] },
      { text: "One voice: it belongs to a specific singer", keep: ["V", "LD", "N", "M", "P"], drop: ["A"] },
      { text: "Both: one voice leads, the room joins at the chorus", keep: ["A", "PR", "W", "LR"] },
    ],
  },
];

// answers: { Q1: optionIndex, ... }
export function scoreTriage(answers) {
  const score = Object.fromEntries(ALL.map((t) => [t, 0]));
  const dropped = new Set();
  for (const q of QUESTIONS) {
    const i = answers[q.id];
    if (i === undefined || i === null) continue;
    const o = q.options[i];
    if (!o) continue;
    (o.keep || []).forEach((t) => { score[t] += 1; });
    (o.name || []).forEach((t) => { score[t] += 2; });
    (o.drop || []).forEach((t) => dropped.add(t));
  }
  const ranked = ALL.filter((t) => !dropped.has(t)).map((t) => ({ type: t, score: score[t] }))
    .sort((a, b) => b.score - a.score);
  const answered = QUESTIONS.filter((q) => answers[q.id] !== undefined).length;
  const [first, second] = ranked;
  // Clear when the leader is ahead by 3 or more after Q4, or always after Q9.
  const margin = first ? first.score - (second ? second.score : 0) : 0;
  const clear = Boolean(first) && ((answered >= 4 && margin >= 3) || answered >= QUESTIONS.length);
  // A genuine hybrid: two types with roughly equal force.
  const hybrid = first && second && second.score >= 3 && first.score - second.score <= 1 ? `${first.type}/${second.type}` : null;
  return { ranked, dropped: [...dropped], clear, hybrid, answered, margin };
}

export function typeLabel(code) {
  if (!code) return "";
  return code.split("/").map((c) => TYPES[c] ? `${TYPES[c].name}` : c).join(" / ");
}

export function typeShort(code) {
  return code ? code.split("/").map((c) => (c === "LR" ? "L/R" : c === "LD" ? "L/D" : c)).join("/") : "";
}
