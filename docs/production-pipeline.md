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
baked-in text** — GPT Image 2 renders text well and therefore likes writing the character's name
into the frame.

What the pick actually governs depends on whether the project has character uploads. Without them
the anchor *is* the character definition: every start frame that features the guide is conditioned
on it, so lettering or a bad likeness propagates into every shot. With uploads, the start frames
use those directly and the anchor is only the training's title-screen hero plus a fallback — still
worth choosing well, but no longer the thing that decides how the guide looks on film.

With **uploaded character references** the candidates are generated differently: two
`/image/multi-edit` calls (`gpt-image-2-edit`) conditioned on the uploaded images themselves —
plus the style references, if any — so the anchor carries the real design rather than a textual
description of it. The pick flow is identical.

Both candidates stay on disk (`media/ref-candidates/`) and remain viewable in the panel
afterwards, so you can compare the finished videos against what you chose.

**If neither candidate fits, the pick screen can regenerate**: a button below the pair generates a
fresh one and waits again, as many rounds as needed. Each round is an explicit user action rather
than an automatic retry, because each round costs real money. The latest pair replaces the
previous one on disk.

Cost: ~$0.55 per pair.

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

A character-free shot still keeps the look, because its start frame is built from the uploaded
**style** references. Losing the character must never mean losing the aesthetic.

### Every shot starts from a frame

**No shot is generated from reference images any more.** Each one starts from a still, and the
video model only animates it. Three sources:

| Source | When | Start frame is |
|---|---|---|
| `chain` | continues the scene, guide presence unchanged | the previous clip's last frame (ffmpeg) |
| `continuation` | continues the scene, but the guide arrives or leaves | built from that last frame **plus** the references |
| `startframe` | opens a new scene | built by the image model for this shot |

**Chain only when the cast is unchanged.** Plain chaining is blind to the character: it is the one
path that injects no identity. A shot marked `featuresCharacter` that also continued its scene used
to take it anyway, and the result was measured on a finished film — the guide was absent for seven
of ten seconds and then materialised from prompt text alone, never having been shown the upload;
in the other film it was a distant speck until the last second. The shot *after* it, marked
character-**free**, then chained off that final frame and inherited the guide for its whole
duration. The flag was effectively inverted for both. Worse, across that entire run every generated
frame logged `0 character + 1 style reference(s)` — the uploaded character reference influenced
nothing but the anchor.

So a shot that adds or drops the guide relative to its predecessor gets a `continuation` frame
instead: the previous last frame as the multi-edit base, with the character and style references
alongside it, so the scene carries over *and* the cast is right, rather than trading one for the
other. These frames are built lazily inside the generation loop rather than up front, because their
base image does not exist until the previous clip does.

The start frames are built by `steps/startframes.ts` with `/image/multi-edit`, before any video
for that level is queued, and cached at `media/films/level<N>_shot<M>_start.jpg` — so they are
inspectable while the clips are still rendering, and a resumed run never pays for one twice. A
shot that features the guide is conditioned on the character uploads (or the picked anchor, for
projects without uploads) **plus** the style uploads; a character-free shot gets the style uploads
only, because handing the character to a frame written without one simply puts it back in. With no
uploads at all, the frame comes from `/image/generate` with the style block.

This replaced four conditioning modes (`character`, `styled`, `plain` and chaining) that fed three
different video models. Reference-to-video was being asked to hold the character's identity, adopt
an uploaded aesthetic *and* compose the storyboard's shot, all at once, and it lost all three
often enough to make films the weakest part of a training:

- **Identity drifted.** A character's eyepatch — the single most identifying thing about him —
  was simply absent in one shot of a finished film, and the crisp cel-shaded look of the upload
  was replaced by generic dark painterly rendering in every clip.
- **Framing bled out of the references.** The anchor is a hero portrait, so cuts came back as
  centred, symmetrical, camera-facing portraits despite a prompt clause and a negative prompt
  both forbidding exactly that.
- **Style uploads were reproduced *as artworks*.** One `styled` shot came back as a framed
  picture with a grey mat and a drop shadow, wrapped around a pillarboxed near-portrait canvas.
  Style references are flat artworks, and the model reasonably concluded that was the brief.

An image-edit model does all three markedly better, a start-frame video model takes its aspect
ratio from the frame it is given (`gpt-image-2-edit` returns an exact 16:9 at 1536×864, which is
also why the baked-bar problem mostly disappears), and a wrong frame costs a fraction of a wrong
clip — so it can just be regenerated. Because one model now generates every shot, resolution,
frame rate and grade cannot drift between cuts either.

The frame is a strong steer, not a lock: measured across finished projects, image-to-video
sometimes invented bars from a clean start frame and sometimes healed bars in a dirty one. So the
negative prompt still names the framings we never want, and the padding detection and crop stay.

Shot durations are clamped to what the start-frame model supports and then **grown until the
chain covers the voiceover**, because every uncovered second becomes a frozen last frame. The step
logs the shortfall when it cannot fully cover it.

Then: **every shot is quoted and the pipeline stops** with the total. Nothing is generated until
you confirm. The quote covers the start frames too, priced from the live catalog like everything
else — they are a real line item, not a rounding error. Measured on a 10-shot, 2-film training:
$13.02 of video plus $3.26 of start frames, so frames are roughly a quarter on top. That is the
right trade. The video half is unchanged by this design (the same shots at the same durations and
resolution quoted at exactly $13.02 before), so the $3.26 buys correct composition, a consistent
character and a matching aesthetic on top of video that used to have none of the three — and it
moves the retry unit from ~$1.60 per clip to ~$0.36 per frame.

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
beats — timed off the sentence timeline. This is where concepts, lists, rules, processes and
numbers belong: the text is razor-sharp in any language, which generative video cannot do, and it
costs nothing.

Two renderers exist, switched by `ANIMATION_RENDERER`:

**`hyperframes`** — a [HyperFrames](https://hyperframes.heygen.com) composition (Apache-2.0,
renders locally, no per-render fees) rendered by *seeking* every frame: a paused GSAP timeline is
positioned at `floor(frame)/fps` and captured atomically, so the same input yields the same video
— unlike realtime recording, where frame timing depends on machine load. Audio is mixed in-render
(no separate mux), and a 35s scene renders in ~13s instead of ≥35s. The pinned `hyperframes`
package and a vendored GSAP (`apps/web/anim-assets/`) make renders fully offline; `--crf 29` keeps
a level at ~1.5 MB (the default preset produced ~5 MB, and every megabyte lands base64-inflated in
the training file). Generated projects live in `media/anim/hf/level<N>/` for inspection and are
never embedded.

Levels get one of three **layout archetypes** over one shared design system, because one layout
repeated across adjacent levels reads as a template, not a design:

| Variant | Staging | Assigned to |
|---|---|---|
| `focal-rail` | beat text stages large right-of-centre, docks into a left checklist rail | rotation |
| `kinetic-center` | beat text slams full-centre, shrinks into a pill row under the title | rotation |
| `step-flow` | node path across the lower third; each beat lights the next node | `sort_order` levels always, else rotation |

Assignment is deterministic — interaction kind first, then rotation by position among the
animation levels — never random: a re-render must produce the same video, and two adjacent levels
must not share a layout by accident.

Two GSAP-under-seek rules the compositions obey, both found the hard way: selectors bind when a
tween is *created*, so all beat blocks are pre-built before the timeline is constructed (content
injected mid-timeline never animates); and a `tl.set(...)` at position 0 does not render at frame
0, so initial hidden states use `gsap.set(...)` outside the timeline.

**legacy** (default until HyperFrames has soaked) — Chromium records the scene in realtime via
Playwright, converts webm→MP4, then muxes the voiceover. One fixed layout. ~45 seconds per scene.

Cost: zero either way. A 40-second animation is ~1.5 MB (hyperframes) / ~1.1 MB (legacy) versus
~20 MB for film.

## 6. Images

Interaction-screen visuals for levels that plan one. Prompts carry the shared style block plus
"no readable text, no faces".

When the project has uploaded **style** references these are built with `/image/multi-edit`
against those images rather than from the style block as text, at the same quality as a film's
start frames. The style block is a written description of an aesthetic, and a written description
is a lossy way to hit one — it left the interaction screens in a slightly different world than the
films, which are conditioned on the uploads themselves. Same references, same look. Projects
without style uploads still use `/image/generate` with the style block.

The prompt also **forces compositional variety**, because these are generated independently but
land next to each other: conditioned on one style upload, the first run returned five images that
were all a vast symmetrical hall shot dead-on. They matched the aesthetic perfectly and gave the
five levels no visual distinctness at all. Matching the look is the goal; repeating one composition
five times is not.

## 5b. Animation beat timing

Beats appear at times derived from the synthesis timeline, and the cue is matched *within* a
segment rather than to it. This matters because a segment is not always one sentence: the TTS
chunker merges a sentence into its predecessor when that predecessor is short, so a stray fragment
is never synthesized alone. Two cues can therefore share one segment.

An earlier version consumed each matched segment — `searchFrom = best + 1` — which starved every
later beat whose cue shared a segment with an earlier one. Measured on a finished training: three
of five beats unresolved, the one that did resolve landed at 31.8s of a 38.3s clip for a line the
narrator speaks at 3s, and the fallback pass bunched the rest into the final five seconds. The
animation showed a title and one line for 30 of 40 seconds. Nothing logged it and QA passed it,
because the video decodes perfectly.

Cues are now located by sliding a window across the segment's words, giving a fraction that
interpolates a time inside it, and segments are no longer excluded once matched — order is kept by
refusing to place a beat earlier than the previous one within the same segment.

Cost: ~$0.34 each with style references, ~$0.26 without (1K, high). This is deliberately no longer
the medium-quality tier: these are full-screen, learner-facing visuals, and the few cents saved
were visible.

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
