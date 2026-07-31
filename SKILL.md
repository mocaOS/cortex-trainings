---
name: trainings
description: >
  Create an interactive training, lesson, or course module as a single offline-capable HTML
  file — with cinematic AI videos (Higgsfield/Seedance 2.0), beat-synced explainer
  animations (HyperFrames), voiceover in any language (ElevenLabs via Higgsfield), AI
  images, gamification, and quiz interactions. For companies (employee training,
  compliance, onboarding), coaches (course modules, client material), teachers (lesson
  units), and course creators (e-learning, self-paced courses). Use for: "interactive
  training", "training video", "e-learning", etc.
---

# /trainings — Interactive Learning Unit with Higgsfield + HyperFrames + Claude

Creates a story-driven, interactive learning journey as **a single HTML file**:
level structure, videos with voiceover, explainer animations synced to the voice, games and
decision scenarios, knowledge check, progress in localStorage. Runs offline via double-click,
shareable via mail/Drive/LMS.

**Prerequisites:** Higgsfield MCP connected (credits!), HyperFrames skills installed
(`npx skills add heygen-com/hyperframes`), ffmpeg, Node 22+, Whisper (`pip install openai-whisper`).

## The workflow has two parts — never mix them

| | **PART 1 — Curriculum** | **PART 2 — Production** |
|---|---|---|
| Result | `curriculum.md` — the complete content as text | the finished HTML file |
| Cost | 0 credits | ~110–1000 credits |
| Duration | minutes | ~1 hour |
| In between | **Approval gate: wait for the user's explicit "Go"** | |

**Why separate:** A text change in Part 1 is free — the same change after production costs a
new voiceover, a new render, and possibly a new film (at 9 credits per video second, that
quickly reaches three digits). Also, the content often has to be approved by third parties
(legal, compliance, client, subject-matter department) — they read a document, not a finished video.

**If the user already brings material** (script, course concept, slide deck, policy), Part 1
becomes reviewing and restructuring: map the content onto the level structure, name gaps, add
a media plan and interactions. Don't reinvent what's already there.

---

# PART 1 — CURRICULUM (no credits)

## Phase 0 — Briefing (via AskUserQuestion, all four questions at once)

Don't start without this information — it determines scope, tone, and production cost.

1. **Topic & learning objectives** — What is it about, and what should learners be able to do
   or do differently afterwards? Is there existing material to build on?
2. **Audience & prior knowledge** — employees / coaching clients / school students /
   university students / course buyers; beginners, advanced, or mixed?
3. **Language** — language of all texts, voices, and on-screen text. Do not assume.
4. **Duration** — determines the number of levels (table below).

**"State, don't ask":** Form of address derives from the audience — casual/informal for
coaching, courses, and trainings; formal for compliance and regulated industries. Likewise:
16:9 videos, dark design with an accent color, XP + level badges. Make these visible in the
curriculum so the user can object.

### Duration → structure (level = 1 video/animation + 1 interaction)

| Desired duration | Levels | Voiceover per scene |
|---|---|---|
| ~10–15 min (compact lesson) | 3–4 | ~25–35 s |
| ~20–30 min (standard module) | 5–6 | ~30–40 s |
| ~30–45 min (full training) | 7–8 | ~35–45 s |
| 60+ min (course) | split into modules of 6–8 levels, one HTML file each | — |

Rule of thumb: One level takes learners ~4–6 minutes. For 60+ min, do NOT build one giant
file — build multiple module files plus a start screen with a module overview.

### Language rules (the same for every language)

- **Learner-facing texts** (voiceover, on-screen texts, quizzes, feedback) in the target language.
- **Image and video prompts ALWAYS in English** — the models are trained on it. Add
  "no readable text, no captions" to the prompt so no wrong-language text ends up in the image.
- **The voice must match the language:** `list_voices` → pick a preset voice for the target
  language, generate a test sample and transcribe it with Whisper in that language (`--language <code>`).
- **Check layout per language:** German/Finnish have long compound words that break titles;
  Spanish/French need more lines.

## Phase 1 — Research & content gathering

- For technical, legal, and compliance topics: **research the current state** (WebSearch).
  Laws and standards change; note sources with dates.
- Review the user's existing material and treat it as the primary source.
- Cut ruthlessly: What is truly action-relevant for this audience? Better 5 things that
  stick than 15 to be forgotten.

## Phase 2 — Write the curriculum document

Create it as `curriculum.md` in the project folder — it is a standalone document that makes
sense even without the later HTML file and can be passed around.

**Story frame with a guide character:** choose an abstract object (glowing orb, crystal,
robot cube) — NEVER a human, because abstract objects stay consistent across all AI
generations. The character addresses the learners directly.

### Structure of `curriculum.md`

1. **Fact sheet** — topic, audience, language, duration, form of address, guide character, state/date
2. **Learning objectives** — overarching plus one per level, phrased as "Learners can …"
3. **Level overview** as a table: Level | Learning objective | Key takeaway | Medium | Interaction
4. **Per level in detail:**
   - Learning objective and **key takeaway** (the one sentence that should stick)
   - **Teaching text** — the actual subject-matter substance in prose. This is the core of
     the document and the basis for voiceover and on-screen texts.
   - **Voiceover script** in the target language (word count for the target duration: ~2.5 words/second)
   - **Media plan** — exactly one choice per level:
     - `FILM` → Seedance prompt (English) + planned shot lengths
     - `ANIMATION` → HyperFrames beat plan (which element appears at which statement)
     - optional `IMAGE` → GPT-Image-2 prompt (English) for the interaction screen
   - **Interaction fully written out** — questions, options, resolutions, feedback texts, XP
5. **Final check** — all questions with the correct answer and distractors
6. **Summary / cheat sheet** — all key takeaways for the final screen
7. **Sources & date** — mandatory for subject-matter topics
8. **Production estimate** — credits according to the table below

**Choose the medium correctly** (determines cost and quality):
| Content | Medium |
|---|---|
| Story moment, emotion, people in situations | FILM (Seedance) — expensive, use sparingly |
| Concepts, lists, models, rules, processes, numbers | ANIMATION (HyperFrames) — free, crisp text |
| Context for an interaction screen | IMAGE (GPT Image 2) — nearly free |

Guideline: 2–3 films per training, everything else animation.

### Interaction toolbox (a DIFFERENT form per level — variety is the point)

| Interaction | Use for |
|---|---|
| Self-assessment (slider) | Onboarding, gauging prior knowledge, personalization |
| Prediction game with probability bars | Aha moments, intuition vs. reality |
| Myth-or-fact cards (flip) | Facts vs. common misconceptions |
| "Find the N mistakes" (click sentences/elements) | Critical review, error hunting |
| Drag & drop into categories | Classifications, hierarchies, assignments |
| Scenario quiz with 2 buttons | Binary distinctions |
| Clickable timeline | Sequences, dates, milestones |
| Branching story (3 options, consequence feedback) | Everyday decisions, behavior |
| Rapid fire with timer | Do's & don'ts, quick judgment |
| Sorting/ordering task | Processes, step-by-step sequences |
| Final check (8–10 questions, mixed) | Knowledge consolidation at the end |

**Finale:** summary screen with the key takeaways of all levels, XP earned, and the result of
the final check — plus a printable cheat sheet (print CSS). (A certificate is NOT part of the
training by default; only build one if the user explicitly requests it.)

## ⛔ Approval gate

Deliver `curriculum.md` to the user and **wait for an explicit "Go"**. Not a single credit is
spent before that. When handing it over, name these points for review:

- Do the levels cover the learning objectives — is anything action-relevant missing?
- Are facts and legal status correct (sources named)?
- Do the tone and examples fit the audience?
- Is the estimated duration realistic?
- Is the credit estimate acceptable?

Incorporate change requests into the document and resubmit. Only after the "Go" → Part 2.

---

# PART 2 — PRODUCTION (consumes credits)

From here on, `curriculum.md` is the binding source. Don't improvise, don't rephrase — what
gets produced is what's in the document. If a content error does surface during production:
fix the curriculum first, then produce.

## Phase 3 — Reference image of the guide character (consistency anchor!)

```
generate_image: model "gpt_image_2", 16:9, resolution "1k", quality "high", count 2
```
- Describe the character precisely (colors, shape, details, environment) + "no text, no captions".
- **Inspect the candidates and pick the one WITHOUT baked-in text** — GPT Image 2 is strong at
  text rendering and therefore particularly likes writing the name into the image; it would
  bleed through into all videos via `image_references`.
- Pass the **job ID** of this image as `image_references` into EVERY video call.

## Phase 4 — Voiceover (ElevenLabs VIA Higgsfield)

**Why via Higgsfield:** Direct ElevenLabs free accounts block library voices via API and don't
allow commercial use. Higgsfield's `text2speech_v2` with `variant: "elevenlabs"` is the same
stack, runs on Higgsfield credits (~0.3 credits/text) with a commercial license.

```
generate_audio: model "text2speech_v2", variant "elevenlabs",
                voice_type "preset", voice_id <from list_voices>
```
- Proven for German: **"Ines"** (`023ebf5e-1970-40d8-825c-a5ef6a1dd4ff`) — calm, clear;
  "Elena" (`ca83ca7f-c186-493d-bd69-0d765fa861b2`) speaks faster by default.
  For other languages, query `list_voices` and verify via a test sample.
- **⚠ TEMPO RULE:** TTS narrator voices are too slow for learning. ALWAYS speed them up:
  ```bash
  ffmpeg -i vo.mp3 -filter:a "atempo=1.15" -b:a 128k vo_fast.mp3
  ```
  1.15x sounds natural (pitch-neutral); the target is normal speaking pace, not audiobook calm.
  Verify the factor on the test sample — depending on voice and language, 1.1 or 1.2 may fit too.
- Then transcribe the **sped-up** MP3s with Whisper (`--output_format json`) — the segment
  timestamps are the choreography basis for Phase 6 and set the final scene lengths.

## Phase 5 — Cinematic videos (Seedance 2.0) — only for the `FILM` levels

**Always Seedance 2.0, always 1080p, always 16:9** — length is the only variable parameter
and is chosen per shot as needed.

```
generate_video: model "seedance_2_0", aspect_ratio "16:9", resolution "1080p",
                mode "std", duration <4–15 s>, generate_audio false,
                medias: [reference image as image_references]
```
- `mode: "std"` is mandatory — 1080p and 4k don't work with `"fast"`.
- **Choose the length per shot deliberately** (4–15 s allowed, costs 9 credits/second):

  | Shot type | Duration |
  |---|---|
  | Short beat, transition, mood shot | 4–6 s |
  | Standard scene with one action | 8–10 s |
  | Expressive scene with a story arc | 12–15 s |

  For sequences, plan the shot lengths so their **sum is just above the voiceover length** —
  every excess second gets cut and is paid for. Example: 38 s of voiceover → 15 + 15 + 9 s
  instead of 15 + 15 + 15 s (saves 54 credits).
- Identical style block in every prompt (look, lighting, "no readable text, no captions,
  no speech, nobody talking") — Seedance cannot render clean text.
- `get_cost: true` as a preflight before commissioning an entire sequence.
- If the server suggests a preset: generate verbatim with `declined_preset_id`.

**⚠ LENGTH RULE: Voiceover longer than 15 s → CHAIN shots, NEVER loop.**
Boomerang loops (forward/backward) look broken — the character disappears and reappears.
Instead, build a seamless sequence:
1. Extract the last frame: `ffmpeg -sseof -0.1 -i clip.mp4 -frames:v 1 last.jpg`
2. `media_upload` → curl PUT → `media_confirm`
3. Generate the next shot with `start_image: <media_id>`, prompt starting with
   "SHOT: continuing seamlessly from the start frame — …" (continue the camera/action)
4. Concat shots via ffmpeg (normalize to uniform fps/resolution first), trim to
   VO length + 1 s; if < 1.5 s is missing: freeze the last frame (`tpad=stop_mode=clone`).
   This is how e.g. a 38-s intro is built from 3 shots (15+15+9).
- Use dramaturgy: the sequence may tell an arc (warning → hesitation → all-clear).

## Phase 6 — Explainer animations (HyperFrames) — for all `ANIMATION` levels

Concepts, lists, models, rules, processes: build as an HTML/CSS/GSAP composition and render
to MP4 — razor-sharp text in ANY language (Seedance can't do that), beat-precise to the voice.

- One folder per scene with `index.html` following the HyperFrames contract (`/hyperframes-core`):
  root with `data-composition-id/-width/-height/-duration` (**1920×1080** so the animations
  match the 1080p Seedance clips; duration = VO_fast + 1 s), at least one `class="clip"`,
  ONE paused GSAP timeline on `window.__timelines["<id>"]`. Scale font sizes and spacing up
  by a factor of 1.5 compared to a 720p layout.
- **Design = the training's look:** dark background, one accent color, guide character as a
  CSS element (circle with radial-gradient + glow + ring) in every scene → brand bracket.
- **Beats from the Whisper timestamps** of the sped-up voiceovers: when the voice names
  point 3, point 3 appears EXACTLY THEN. Place elements via `tl.to/from` at the segment start times.
- Pitfalls (saves lint rounds):
  - initial states with `gsap.set(...)` BEFORE the timeline, never `tl.set(..., 0)`
  - no `repeat: -1` (finite repeats), no clock, no randomness
  - keep titles single-line (`white-space: nowrap`) — line breaks collide with content
  - don't let elements overlap — `npx hyperframes check` verifies layout + WCAG contrast
- Loop: `npx hyperframes lint` → fix → `npx hyperframes check` → `render --quality draft`
  (extract frames and look at them!) → `render --quality high --output final.mp4`
- The result weighs ~4–8 MB per 40-s scene in 1080p and costs no credits.

## Phase 7 — Images (GPT Image 2) for the interactive screens

```
generate_image: model "gpt_image_2", 16:9, resolution "1k", quality "high"
```
Images bring the quiz screens to life — same visual world as the videos:
- start-screen hero (reuse the reference image — free)
- one illustration PER decision scenario
- comparison panels for juxtapositions
- header image for search games, closing image for the summary screen
- Always: the videos' style block + "no readable text, no faces" — especially important with
  GPT Image 2, otherwise (often wrong-language) labels end up in the image
- `quality: "high"` for hero and scenario images, `"medium"` suffices for background decoration
- Compress: `ffmpeg -i in.png -vf "scale=1024:-2" -q:v 4 out.jpg` → ~80 KB/image

## Phase 8 — Muxing (ffmpeg)

- Animations (exactly VO+1 s long): copy the video, pad the audio:
  `-filter_complex "[1:a]apad[a]" -map 0:v -map "[a]" -t <videoduration> -c:v copy -c:a aac -b:a 96k -ac 1 -movflags +faststart`
- Film sequences: concat → trim to VO+1 s → `-c:v libx264 -crf 27 -pix_fmt yuv420p`
- **Manage size:** Keep the 1080p masters as an archive (reusable for social, LMS,
  presentations). For embedding into the HTML file: the player shows the videos at
  ~800–900 px wide — if the total file exceeds ~50 MB, downscale the embed copies with
  `-vf "scale=1280:-2"`. No visible difference, and the file size halves.
- Target: ≤ 5 MB per embedded clip, total file ≤ 50 MB.

## Phase 9 — The HTML learning unit (one file, vanilla JS)

Build a template with placeholders (`{{VIDEO_V0}}`, `{{IMG_SZ1}}` …), then insert all media
as Base64 data URIs via a Python script at the end. Architecture:
- SPA with screens (`.screen.active`), header with level badges + XP, progress bar
- reusable video screen (one `<video>` element, src gets swapped; "Continue" button pulses
  after `ended`; "Sound on!" hint in the target language)
- XP economy: correct answer full points, second attempt half, level completion +25
- Level lock: the interaction must be completed, videos are skippable
- Name entry optional (only for personalizing the feedback), don't force it
- Final check: shuffle questions AND answer order, evaluation with topic hints for wrong
  answers, retry possible
- summary screen: all key takeaways from the curriculum, XP total, print CSS for the cheat sheet
- localStorage: save progress, "Resume" button, reset function
- set the `lang` attribute to the target language
- ⚠ In JS strings, use the target language's typographic quotation marks (German „…“,
  English “…”) — straight `"` break the strings

## Phase 10 — Browser test (mandatory, complete)

Serve locally (`python3 -m http.server`), then click through everything:
1. All videos decode (probe element per VIDEOS key, check duration) + images embedded
2. Every interaction incl. FAILURE paths (wrong answers, let timers run out)
3. Deliberately fail the final check → verify evaluation and retry
4. Reload → "Resume" works; console: zero errors
5. Check file size; stop the server, deliver the file

---

## Cost guidelines (Higgsfield credits)

| Item | Credits |
|---|---|
| **Seedance video 1080p** | **9 credits per second** (5 s = 45, 10 s = 90, 15 s = 135) |
| Image (gpt_image_2, 1k) | ~4 at `high`, ~2 at `medium` |
| Reference image (2 candidates) | ~8 |
| Voiceover per scene | ~0.4 |
| HyperFrames renders | 0 (local) |

**Sample calculation:** compact lesson (4 levels, 1 story video of 10 s, 3 animations,
3 images) ≈ 110 credits · full training (8 levels, 3 story sequences with ~105 s of footage
in total, 5 animations, 7 images) ≈ 980 credits.

Video seconds dominate the costs at over 95% — images, voices, and the HyperFrames
animations barely matter. Two levers: consistently solve concepts as (free) HyperFrames
animations instead of film, and cut shot lengths exactly to the voiceovers. The estimate
belongs in the curriculum; check `balance` before production.

## Example prompt (this is what the user gives you)

> /trainings — Create an interactive learning unit on the topic **[TOPIC]** as a single
> offline-capable HTML file. Audience: **[e.g. new employees / my coaching clients /
> 10th grade]**, language: **[e.g. German]**, duration: **[e.g. ~20 min]**.
> Content should cover: **[bullet points or existing material]**.
> Create the curriculum as a document first — only produce after my approval.

If one of the four core inputs is missing (topic, audience, language, duration) — ask, don't guess.
