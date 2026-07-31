# Workflow

A training is made in two parts, separated by an explicit approval gate. Never mix them.

| | **Part 1 — Curriculum** | **Part 2 — Production** |
|---|---|---|
| Result | `curriculum.md` — the complete content as text | the finished HTML file |
| Cost | knowledge-base queries + agent tokens (cents) | video, images, speech (dollars) |
| Duration | minutes | ~20–40 minutes |
| In between | **approval gate: an explicit click** | |

**Why separated:** a text change in Part 1 is free. The same change after production costs a
new voiceover, a new render, and possibly a new film. Content also often needs sign-off from
people who read documents, not finished videos — legal, compliance, a client, a subject-matter
department.

## Part 1 — Curriculum

### 1. Briefing

Four inputs, collected as a form because the skill forbids guessing them:

- **Topic & learning objectives** — what it is about, and what learners should be able to do
  differently afterwards.
- **Audience & prior knowledge** — employees, coaching clients, students; beginners or advanced.
- **Content language** — the language of all learner-facing text and voice.
- **Duration** — determines the level count (3–4 / 5–6 / 7–8 levels).

Optional: existing material to build on, and a collection to scope research to.

Some things are stated rather than asked, and appear in the curriculum's fact sheet so they can
be objected to: 16:9 video, dark design with one accent colour, XP and level badges, and form
of address derived from the audience (informal for coaching and courses, formal for compliance
and regulated industries).

### 2. Research and writing

Triggered explicitly — nothing runs on its own. The agent (`claude-fable-5`) researches the
Cortex instance and writes the curriculum in one run, typically 3–6 minutes.

The strategy is deliberately research-heavy: a broad fan-out of deep-research calls up front
(one per candidate level, learning objective, or open question), then gap-filling calls while
writing. See [cortex-integration.md](cortex-integration.md).

The resulting `curriculum.md` contains a fact sheet, learning objectives, a level table, then
per level: teaching text, the voiceover script, a media plan, and the fully written-out
interaction — plus a final check, a cheat sheet, cited sources with dates, and a production
estimate.

### 3. Revision

Free-form requests in the chat ("make level 3 about X", "more casual", "add a phishing
scenario"). Each revision saves a new version; history is kept.

### 4. The approval gate

Production is unreachable until approval. Worth checking before you click:

- Do the levels cover the objectives — is anything action-relevant missing?
- Are the facts and legal status correct, with sources named?
- Do tone and examples fit the audience?
- Is the estimated duration realistic?
- Is the production cost acceptable?

Approving locks revisions and starts production.

## Part 2 — Production

From here `curriculum.md` is binding: what gets produced is what the document says. If a
content error surfaces during production, fix the curriculum first, then produce.

Seven steps, streamed live to the UI, resumable, with two pauses for human judgement:

1. **Plan** — the curriculum is converted into a structured production plan.
2. **Reference image** — two candidates of the guide character; **you pick** the one without
   baked-in text, because it anchors the look of every video.
3. **Voiceovers** — one synthesis call per sentence, giving an exact timeline.
4. **Films** — **pauses with a live cost quote** before anything is generated.
5. **Animations** — rendered locally, free.
6. **Images** — interaction-screen visuals.
7. **Assemble** — everything embedded into one HTML file.

Details and costs: [production-pipeline.md](production-pipeline.md).

## Guide character

Every training has a guide that addresses learners directly, and it is always an **abstract
object** — a glowing orb, a crystal, a data cube — never a human. Abstract objects stay
consistent across AI generations in a way people do not; a human character drifts between
shots and breaks the illusion.
