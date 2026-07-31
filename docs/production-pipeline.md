# Production pipeline

Eight steps, run in order, each persisted so a failure resumes rather than restarts. Two steps
park for human judgement, and the last one refuses to let a broken training reach anyone.

## 1. Plan

`claude-fable-5` converts `curriculum.md` into a structured JSON plan (forced through a JSON
schema, so it either validates or retries). Per level: voiceover script verbatim, medium, film
shot prompts, animation beats, image prompt, and the interaction mapped to a supported type.

Also extracted once for the whole training: a precise **English** description of the guide
character, and a shared style block ending in the no-readable-text clause.

**Uploaded reference images override both.** If the project carries character references,
their vision-extracted description becomes `guideCharacter` and the character keeps its own
colors (the accent backstop is skipped). If it carries style references, their extracted
aesthetic becomes the basis of `styleBlock` instead of the preset visual style. The analyses
were made at upload time and live in the project's `refs.json`.

The accent colour is overwritten with `ACCENT_COLOR` after extraction — design is
configuration, not a model decision.

The step fails loudly if a film level has no shots, an animation level has no beats, or any
level has an empty voiceover. Better to stop here than to produce something broken.

**Watch for:** the extractor may deviate from the curriculum's stated shot lengths to cover the
voiceover, because those two instructions can conflict. It is usually right to do so — but it
changes cost, which is why the quote comes before spending.

## 2. Reference image — *pauses for you*

Two candidates of the guide character (`gpt-image-2`, 16:9, 1K, high). **Pick the one without
baked-in text**: this image conditions every video, so lettering in it bleeds into all of them.
GPT Image 2 renders text well and therefore likes writing the character's name into the frame.

With **uploaded character references** the candidates are generated differently: two
`/image/multi-edit` calls (`gpt-image-2-edit`) conditioned on the uploaded images themselves —
plus the style references, if any — so the anchor carries the real design rather than a textual
description of it. The pick flow is identical.

Both candidates stay on disk (`media/ref-candidates/`) and remain viewable in the panel
afterwards, so you can compare the finished videos against what you chose.

Cost: ~$0.55 for the pair.

## 3. Voiceovers

**One synthesis call per sentence**, not per level. Each chunk is then sped up with ffmpeg
`atempo` and re-encoded to 128 kbps mono.

Per-sentence synthesis is the design decision that matters here: concatenating chunks of known
duration produces an **exact sentence timeline**, which is what the animation beats are placed
against. The alternative — one long audio file plus transcription to recover timings — proved
both unreliable and coarse (see [venice-notes.md](venice-notes.md)).

Re-encoding matters too: the provider returns ~768 kbps MP3s, roughly 4 MB for 40 seconds of
speech. At 128 kbps mono the same audio is ~0.6 MB, which is the difference between a 25 MB and
a 12 MB deliverable.

Chunks are cached in `media/vo/chunks/`, so a retry after a provider hiccup re-synthesizes only
what's missing. Concurrency is capped (`TTS_CONCURRENCY`, default 3).

Cost: cents for a whole training.

## 4. Films — *pauses for you*

Only for levels the curriculum marks as FILM. This is where essentially all the money goes.

Chaining is **scene-aware**, because the two cases need opposite handling:

- A shot that **continues the previous scene** is generated from its last frame (extracted with
  ffmpeg), prompt prefixed to continue the camera and action. The cut becomes invisible.
- A shot that **opens a new scene** is generated from references instead, so it cuts cleanly.
  Chaining across a location change forces the model to morph one setting into another inside a
  single clip — an early run turned a forest into a furniture showroom mid-shot, which looks like
  a glitch rather than an edit.

The plan declares this per shot (`continuesPreviousScene`). Either way it is a chain, never a
boomerang loop — those look broken because the subject disappears and reappears.

**The storyboard decides whether the guide appears at all.** Each shot also carries
`featuresCharacter`, and a shot marked `false` receives *no* character references — so
establishing shots, object details and concept imagery are free of it. This exists because
conditioning every shot on the character produced a mascot parade: the guide turned up in shots
written without it, and because the reference image is a hero portrait, every film opened on that
same portrait. Roughly half the shots of a film should be character-free, and the opening shot
almost always should be.

A character-free shot still keeps the look. It is generated from the uploaded **style**
references when the project has them, and otherwise from the text-to-video sibling of the
reference model with the style block in the prompt. Losing the character must never mean losing
the aesthetic. Four modes result, logged per shot:

| Mode | When | Generated from |
|---|---|---|
| `chain` | continues the previous scene | previous last frame |
| `character` | a cut where the guide serves the shot | anchor + uploaded character images |
| `styled` | a cut with no guide, style uploads exist | uploaded style images only |
| `plain` | a cut with no guide, no style uploads | prompt + style block |

Prompts state explicitly what a reference may contribute — identity only, or palette and
lighting only — because reference images otherwise dictate framing and subjects too (see
[venice-notes.md](venice-notes.md)).

Shot durations are clamped to what each model supports (reference-to-video: 5s or 10s; chaining:
5s, 10s, 15s) and then **grown until the chain covers the voiceover**, because every uncovered
second becomes a frozen last frame. The step logs the shortfall when it cannot fully cover it.

Then: **every shot is quoted and the pipeline stops** with the total. Nothing is generated until
you confirm.

Finally the shots are concatenated, trimmed to voiceover + 1s, and the voiceover is laid
underneath (video padded by cloning the last frame if it's short, audio padded with silence if
it's long).

Before concat, each clip is checked for **padding the model baked into the frame** and cropped.
MiniMax H3 composes at ~2:1 and pads to 16:9 with near-white bars; left uncropped they reach the
learner as what looks like a rendering bug. Clips are then scaled to **fill** 1920×1080 rather
than fitted — fitting de-padded 2:1 content re-letterboxes it with black bars, which is trading
the model's white bars for your own. Filling costs ~11% off the sides of a wide composition.
Every crop is logged. See [venice-notes.md](venice-notes.md) for the measurements.

**Everything is normalised to 1920×1080 at 25 fps during concat and mux**, whatever the model
produced — MiniMax H3 delivers 2560×1440 at 24 fps and is downscaled. This is deliberate, not an
oversight: the training is one self-contained HTML file with every clip inlined as base64, so
master resolution translates directly into download size for a video that plays in a card on a
learner's screen. A 2K master buys a slightly better downscale source and nothing else. If a
model's native resolution is ever worth keeping, it is the two `scale=1920:1080…,fps=25` filters
in `lib/production/ffmpeg.ts` that decide it.

Cost: quoted live, because video pricing is dynamic. Reference: ~$0.14 per second at 1080p on
Wan 2.7, so a 40-second sequence is ~$5.60; MiniMax H3 at its mandatory 2K came out about 16%
higher for the same eight shots. Generation takes 2–3 minutes per shot on Wan, ~7 on MiniMax.

**Guideline: 2–3 films per training, everything else animation.** Video seconds dominate the
budget by an order of magnitude.

## 5. Animations

For levels marked ANIMATION. A 1920×1080 scene — dark background, accent colour, title, and the
beats — is rendered by Chromium with CSS animation delays taken from the sentence timeline, then
converted to MP4 and muxed with the voiceover.

This is where concepts, lists, rules, processes and numbers belong: the text is razor-sharp in
any language, which generative video cannot do, and it costs nothing. A 40-second animation is
~1.1 MB versus ~20 MB for film.

Cost: zero. About 45 seconds per scene.

## 6. Images

Interaction-screen visuals for levels that plan one (`gpt-image-2`, medium quality, ~90 KB
each after compression). Prompts carry the shared style block plus "no readable text, no faces".

Cost: ~$0.15 each.

## 7. Assemble

Everything is embedded as Base64 data URIs into a single HTML file. Clips over ~5.5 MB get a
downscaled embed copy (1280 wide) while the 1080p masters stay on disk for social, LMS, or
presentation reuse. The step warns if the result exceeds 50 MB.

Cost: zero, seconds to run.

## 8. Browser QA

The produced file is opened in a headless browser and clicked through: every interaction is
solved using the correct answers from the plan, every embedded video is probed for decode, the
walk must reach the summary screen, and the console must be clean. **A failure fails the run**,
with the offending screen named in the log.

This exists because two broken trainings reached a finished file when this was a step a human
remembered to do — one had an interaction with no way to continue, the other a sorting task that
could not be completed. Both were invisible until someone clicked.

The step reports what it did **not** cover (failure paths, audio playback, print styling, mobile
layout) rather than implying total coverage. `scripts/qa-training.mjs` is the single
implementation; the pipeline spawns it, so the CLI and the pipeline can never disagree.

Cost: zero.

## Revisions after production

Changing a curriculum after media exists is allowed, but not on the author's word. On save, the
new curriculum is compared against the plan the media was built from, per level:

- **narration changed** → that level's audio, film and animation are discarded
- **title changed** → that level's animation is discarded
- **film prompts changed** → that level's footage is discarded

Whatever is stale is deleted so the next run regenerates it, and the agent is told which levels
were affected and that video regeneration costs money. This exists because a revision asked to
touch "only the interactions" rewrote every voiceover script and renamed every level while
reporting that nothing had changed — which would have shipped a training whose voice track
contradicted its own document.

## Cost shape

For a compact four-level training (1 film of ~40s, 2 animations, 2 images, 4 voiceovers):

| Item | Cost |
|---|---|
| Film (~40s at 1080p) | ~$5.60 |
| Reference image pair | ~$0.55 |
| Interaction images | ~$0.30 |
| Voiceovers (30 sentences) | cents |
| Animations | $0 |
| Plan extraction | cents |
| **Total** | **~$7** |

Video is >80% of it. The two levers are the ones the skill names: solve concepts as animations
instead of film, and cut shot lengths to the voiceover.

## Verifying the result

```bash
node scripts/qa-training.mjs <project-id>
```

Drives every interaction's success path using the correct answers from `plan.json`, checks each
embedded video decodes, walks to the summary, and reports console errors — then prints what it
did **not** cover. Run it before sending a training to anyone.
