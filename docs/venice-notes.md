# Venice provider notes

Behaviour verified against the live API. **Read this before changing TTS, transcription, or
video code** — each item below cost real debugging time.

Base URL `https://api.venice.ai/api/v1`, auth `Authorization: Bearer <key>`, OpenAI-compatible
for chat, images, embeddings, speech and transcription, with native endpoints for image editing
and async video/audio.

## Text — `claude-fable-5`

1M context, 128k max output, function calling and JSON-schema responses, always-on adaptive
thinking. Classed as an anonymized proxy: Venice forwards to the upstream provider while
anonymizing traffic. If a deployment requires inference to stay on Venice's own hardware, switch
`VENICE_AGENT_MODEL` to a Venice-hosted model (`zai-org-glm-4.7` carries their
`most_intelligent` and `function_calling_default` traits).

**A whole curriculum travels inside one tool call's `arguments` string.** If generation hits the
output limit mid-string, the JSON is truncated and unparseable. Keep
`VENICE_MAX_OUTPUT_TOKENS` generous (default 64000), check `finish_reason === 'length'`, and
never let a parse failure reach a tool as an undefined value.

## Speech — `/audio/speech`

**The `speed` parameter is ignored by `tts-gradium-v1`.** Measured: identical text at speed
1.0 / 1.15 / 1.4 returned 6.72s / 7.04s / 6.88s — variation without scaling. Tempo must be done
with ffmpeg `atempo`, which is pitch-neutral and what the skill prescribes anyway.

**Output is ~768 kbps MP3** — about 4 MB for 40 seconds of speech. Always re-encode; 128 kbps
mono is transparent for narration and six times smaller.

**Concurrency draws HTTP 500s.** Thirty simultaneous requests failed; the same thirty at
concurrency 3 completed in 28 seconds with zero retries. Cap concurrency and retry 5xx with
backoff.

Input limit is 4096 characters per request — never a constraint when synthesizing per sentence.

German is confirmed on `tts-gradium-v1` (voice `Maximilian`). ElevenLabs models are multilingual
but Venice publishes no per-language matrix, so validate a voice with a test sample before
committing to it.

## Transcription — `/audio/transcriptions`

Currently unused, and this is why:

| Model | On a 41s German file |
|---|---|
| `openai/whisper-large-v3` | **HTTP 500 after ~120s.** Failed at 3.9 MB and again at 0.66 MB, so not a size limit |
| `fal-ai/wizper` | 200 in 4.4s, but only **2 coarse segments** for 41 seconds |
| `nvidia/parakeet-tdt-0.6b-v3` | 200 in 3.9s, clean text, **no timestamps at all** despite `timestamps: true` |
| `elevenlabs/scribe-v2` | 200 in 2.8s, no timestamps |

Also note the response nests timestamps under `timestamps.segment` — **singular** — not
`segments`.

Rather than depend on any of this, the pipeline synthesizes one sentence at a time and derives
the timeline from chunk durations. That is exact, needs no round-trip, and cannot fail
independently. Transcription would only be needed for audio we did not generate ourselves.

## Video — async, quote first

Flow: `POST /video/quote` (free) → `/video/queue` → poll `/video/retrieve` → `/video/complete`.
Retrieve answers either JSON (`{status: 'PROCESSING'}` with an average execution estimate) or the
finished MP4. **Download URLs expire within 24 hours**, so persist immediately.

Pricing is dynamic — there is no static price list, which is why the pipeline quotes every shot
and asks before spending. Reference: **$0.14 per second at 1080p** on Wan 2.7 (10s = $1.40).

Model IDs must be checked against the live catalog. `GET /api/v1/models?type=video` needs no
auth and returns per-model constraints under `model_spec.constraints` — `durations`,
`resolutions`, `aspect_ratios`, `prompt_character_limit`, whether audio is generated and whether
it is configurable. Guessing an ID from documentation or a changelog does not work; one such
guess (`kling-v3-pro`) does not exist and failed the run at the quote step.

**The films step reads those constraints rather than assuming them.** Shot durations are clamped
to the executing model's own `durations`, the resolution is resolved against its `resolutions`,
and `aspect_ratio` is sent as 16:9 when the model offers a choice and omitted when it lists none.
`VENICE_VIDEO_RESOLUTION` is a *preference* that is honoured when the model offers it and
otherwise replaced by the model's own option, with the substitution logged. The catalog is
fetched once per process and an unknown model id fails immediately with the id named.

**`/video/quote` and `/video/queue` do not validate the same fields.** MiniMax quoted happily
without `aspect_ratio` and then rejected the queue call with `aspect_ratio: Required`. So a clean
quote does not prove a queue will be accepted; the two calls are now given identical parameters
so the price quoted is the price of what actually gets queued.

This exists because the tiers used to be constants — and they were Wan 2.7's exact durations.
Pointing the pipeline at MiniMax H3 failed at the quote step with
`resolution: Invalid enum value. Expected '2K', received '1080p'`, since a global default cannot
be right for every model. It failed before spending anything, which is the one thing that went
well.

Two model families verified against the live catalog:

- `wan-2-7-reference-to-video` — 1080p/720p, **5s or 10s only**, takes `reference_image_urls`
  (up to 9, http/https or data URLs). Generates audio, not configurable.
- `wan-2-7-image-to-video` — 1080p/720p, 5s/10s/15s, takes `image_url` as the start frame. This
  is what chaining uses.
- `minimax-h3-reference-to-video` — **2K only**, every whole second from 5s to 15s, and
  `aspect_ratio` is **required** (16:9 · 21:9 · 4:3 · 1:1 · 3:4 · 9:16). Prompts cap at 2500
  characters.
- `minimax-h3-image-to-video` — same 2K and durations, but lists no aspect ratios, because a
  start-frame model takes the ratio from its input image.

MiniMax's per-second durations let shot lengths fit a voiceover far more closely than Wan's
5/10/15 tiers, and reference shots are no longer capped at 10s — that limit was Wan's, not a
general one.

Data URLs work for both reference and start-frame images; a ~240 KB base64 image was accepted
without trouble. Generated clips arrive at ~13–15 MB per 10 seconds of 1080p, with an AAC track
we discard.

The negative prompt reduces but does not eliminate text: expect illegible document-like
lettering on props. Since it is unreadable rather than wrong-language, it is the tolerable
failure mode — but do not rely on generative video for any text a learner must read. That is
what the locally rendered animations are for.

### MiniMax H3 bakes near-white padding into the frame

Verified across eight shots: MiniMax composes at roughly **2:1** and pads to its mandatory 16:9
with **near-white bars** (measured mean 203–255), inside the returned 2560×1440 video. It is not
a container flag — it is pixels, so it survives into anything downstream.

Details that cost debugging time:

- **The padding is not constant within a clip.** A bar present at 4s was gone by the one-third
  mark, so detecting it from a single frame leaves a bar in the frames that were not sampled.
  `detectPadding` samples five timestamps and takes the widest band per side.
- **Chaining propagates it.** A shot generated from the previous shot's last frame inherits that
  frame's bars, which is why one clip showed a four-sided border while its siblings had only
  top/bottom ones.
- **The boundary row is a blend** (around mean 145), so a brightness test alone leaves a visible
  hairline. Hence the trailing inset.
- **An off-ratio reference image appears to trigger it.** The bars showed up once portrait
  uploads (982×1242) were passed alongside the 16:9 anchor; reference images are now letterboxed
  to 16:9 before being sent. Not proven — one shot came back clean — but the mechanism fits and
  the inputs themselves have no borders.
- **Do not "fix" it by fitting to 1920×1080.** `force_original_aspect_ratio=decrease` plus `pad`
  re-letterboxes de-padded ~2:1 content with *black* bars, trading the model's white bars for
  your own. Scale to fill (`increase` + `crop`) instead; it costs ~11% off the sides.
- **Dark padding is not auto-detected.** In near-black footage a genuine edge column is often
  flat black too: a flatness test cropped 283px off a shot that had no padding at all.

### Reference images are read as instructions about everything

`reference_image_urls` conditions far more than identity. A hero-framed character reference makes
reference-to-video reproduce that *framing*, so every clip opens on the same centered portrait of
the character regardless of the shot's own described composition. Style references likewise bleed
their subjects. Both need the prompt to say explicitly what to take from them — identity only, or
palette/lighting/texture only — and the negative prompt to name the portrait framing.

## Images — `gpt-image-2`

Same model the skill originally used, available natively. 16:9 with `aspect_ratio`, 1K via
`resolution`, `quality` high/medium, and up to 4 variants per request. Roughly $0.27 per image
at high quality; `qwen-image` is $0.03 if budget matters more than text fidelity.

It renders text *well*, which is precisely the hazard for a reference image — hence generating
two candidates and having a human pick the clean one.

## Image editing — `/image/multi-edit`

Used to render an **uploaded** guide character into the training's world (only when a project
has character reference images). Verified live (2026-07-31, `gpt-image-2-edit`):

- The model field is **`modelId`** — the multi-edit request schema never adopted the newer
  `model` field that `/image/edit` uses, and `additionalProperties: false` means sending
  `model` is a 400, not a synonym.
- JSON body takes `images` as base64 strings, data URLs or http(s) URLs; the **first image is
  the base**, the rest are references/layers. The per-model maximum is not exposed in the
  catalog — keep the list small (we send ≤6).
- The 200 response is the **raw image binary** (`image/jpeg` or `image/png`), not JSON with a
  base64 field like `/image/generate`. One image per call — two candidates = two calls.
- `aspect_ratio: "16:9"`, `resolution: "1K"`, `quality: "high"`, `output_format: "jpeg"` all
  behave as documented for `gpt-image-2-edit`.

## Vision — multimodal chat

`claude-fable-5` carries `supportsVision` and `supportsMultipleImages` and accepts
OpenAI-style `image_url` content parts (data URLs work), **including together with
`response_format: json_schema`** — verified live. One trap: a vision model given zero images
does not error, it answers with a polite non-answer that parses fine. The analysis code
refuses an empty image list for exactly that reason.

## Rate limits and billing

Per-tier limits are exposed at `GET /api_keys/rate_limits`, with `x-ratelimit-remaining-*`
response headers. Roughly: images 20/min, audio 60/min, video queue 40/min. Insufficient balance
surfaces as **HTTP 402** — worth distinguishing from a transient error, since retrying it is
pointless.
