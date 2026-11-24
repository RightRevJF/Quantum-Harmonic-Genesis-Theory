# Luthier: the songwriting engine as an app

A phone-first web app built from **Luthier v45** (Song Engine MAX) by Jason Bryant. You give it a seed, and it runs the engine's session from start to finish:

1. **Seed:** one line. An emotion, an image, a title, or a lyric tension.
2. **Q0, the Sovereignty Question:** "What do you think this song is about?" Your answer is kept word for word as the anchor.
3. **Triage, Q1 to Q9:** one question at a time. The answers route the song to a type (Paradox, Narrative, Lament, Groove, Anthem, Love Song, Prophetic, Worship, Meditative, Blues, Gospel), or to a hybrid.
4. **Type intake:** Claude asks the routed type's own intake questions (N1–N5, V1–V6 and so on) from that module's text. Each question comes with three options, A, B and C, plus a recommendation.
5. **Checkpoint (a):** the tension, three hooks and a form.
6. **The contract (Protocol 0b):** title, never-say list, objects, your own phrases, voice, key, tempo and form. The writing room stays closed until the required inputs are filled in.
7. **Checkpoint (b), the harmonic skeleton:**
   - The app proposes three chord plans, one loop per section, measured in departure units (Window 19.9): borrowed chord 1, secondary dominant or deceptive cadence 2, modulation 3.
   - Each plan is checked against the type's total budget and per-moment ceiling, with the schema discount (19.10). It also follows Window 28's tendencies: the chorus changes the loop and usually starts off the tonic. Each plan carries the harmonic-expectation score (Window 46).
   - Your own chords are used unchanged and measured the same way.
8. **Checkpoint (c), the lyric:** Claude drafts from your answers, or you write it yourself. The readings update as you type. You can coach any flagged line (three alternatives, each measured before you see it) or revise with a note.
9. **Lock and completion check:** the song is checked against your Q0. Then you save the song record, which holds the lyric, the readings, the full intake log and any lines you kept on purpose.

10. **Checkpoint (d), the melody search (Module 27):**
   - The engine writes 3,000 candidates from the locked lyric. The hook is written title-first: stressed syllables go on the beat, the high note falls on the first strong syllable, and the last strong syllable is held on a stable degree.
   - Each candidate is filtered against the type's Table A row (tessitura, passaggio, leaps, range, density, syncopation and monotony), rejected against Table B, then ranked with the Table C weights.
   - The order is fingerprinted before anything is played. The top three can be heard with chords and bass and seen as piano rolls.
   - Choosing anything other than #1 needs a sentence of reason. The chosen melody can be saved as a MIDI file.

   - Each candidate shows its departure map: the harmonic, melodic and rhythmic DU of every phrase against the ceiling. The spec's practical test is that the hook reaches the ceiling and the verse stays below it.

11. **The floor on the finished song (Table G):** this is measured on every melody candidate and on the chosen song. It covers:
    - alignment (stressed syllables on strong beats, with a floor of 0.444);
    - breath (phrases past the real 95th percentile are a floor);
    - melisma, cadence, rhyme, tempo and form (first chorus at bar 13–28, two to four choruses, bridge against verse length);
    - each line's speed on the melody's own notes (Window 36);
    - tessitura fatigue over the whole form (11.13).

    A song under the alignment or breath floor is marked not finished.

The app also has a **lyric-first path** (Module 29): paste a finished lyric and the app measures it.

## What is measured (app/js/engine/lyric.js)

Every number below comes from the spec. They are readings, not verdicts (Principle 10).

| Reading | Source |
|---|---|
| Weak line endings (conjunction, preposition, article, dangling "it"). This is a floor; it doesn't apply to a line marked `>` | Window 32 |
| Rule V1: a picture in every verse line, read across the couplet | Module 10.2 |
| Syllables a second at your tempo. Past 6.4 is over the articulation ceiling | Window 36 |
| Friction (syllables a second × (1 + consonant load)): past 8.12 is dense, past 9.43 is crowded | Window 36 |
| Consonant clusters where words join: 4 or more is reported, 5 or more is a tongue-twister | 10.7 |
| Vowels on held notes; the convergence word ends on an open vowel or L/R | 10.7, Rule C2 |
| Rare words (Zipf under 2.75), ladder lines, the never-say list | 10.9, Protocol 0b |
| Verse lines 6–9 syllables; chorus lines shorter and mirrored; chorus entropy; rhyme floor | Rules V2, C1, Window 27 |
| Title count (2–9), title in the hook position, hook 4–9 syllables | Window 27, checklist 5 |
| Bridge four lines at most; final chorus singable on the same melody; the POV contract | 10.5, 10.6, Rule C3 |

## Running it

The app is published as a private claude.ai artifact. There, Claude does the writing on the viewer's own account, and songs are saved privately to the viewer's account. Without Claude the app still works in measure-only mode, and songs are saved in the browser.

To run it locally, serve `app/` with any static server and open `index.html`.

Tests: `npm test` (Node 20 or later).

## Data

- `app/data/lexicon.json`: 53,108 words. It combines the CMU Pronouncing Dictionary (phones and stress), wordfreq Zipf frequencies (Speer et al., CC BY-SA 4.0) and the Brysbaert, Warriner & Kuperman (2014) concreteness norms. To rebuild it: `python3 tools/build_lexicon.py <Brysbaert file>`.
- `app/data/spec.json`: the parts of Luthier v45 the app hands to Claude: the Lite Edition, the principles, Module 0 and its triage, Module 10, Module 23, Module 25, and the type templates, Modules 13–22. To rebuild it from a new version of the spec: `pandoc Luthier_vNN.docx -t markdown -o luthier.md && python3 tools/extract_spec.py luthier.md app/data/spec.json`. The original .docx is not committed.

## What the melody search does not have yet

- **Realness (27.8, 0.25 of the rank).** It needs the reference set of 3,310 real choruses. The expectation term (0.05) needs the harmony search. Both are left out, and the other weights are kept in proportion.
- **The interval model.** It is a hand-set stand-in for the POP909-trained model. Surprisal is read under a fixed reference interval model, so every candidate is judged by the same listener and not by the generator that wrote it.
- **Chords without a chosen harmony.** If you skip checkpoint (b), the melody search draws from eight common loops.
- **The harmony model.** It is a first-order chord model over the loops Window 28 lists, not the spec's corpus-trained model, so the expectation medians are this model's own. The total budget counts each section's design once (repeats are not recharged), plus melodic and rhythmic events of 2 DU or more. One-DU melodic and rhythmic moves count only against the per-moment ceiling. This is the app's reading of 19.9.
- **Meditative songs.** Table A has no Meditative row, so these are read against W-contemplative.
- **Rhythm.** Each line's rhythm is chosen by a small optimiser that puts stressed syllables on beats 1 and 3 and keeps unstressed ones off them. Lines of the same shape in a section share a rhythm. It aligns more tightly than real songs do (about 0.9 against the real median of 0.78).
- **Melisma.** None is written yet: one note per syllable. The floor reports it.
- **Line lengths.** A line gets more bars when its syllables would crowd the type's density ceiling.

## What comes next

This is stage 4: the session through to a harmonic skeleton, a locked lyric and a chosen melody, with the departure map and the floor on the finished song. Still to come:

- (e) the production notes;
- the lead sheet, the Nashville chart, the songbook and the demo.

Luthier © Jason Bryant 2026.
