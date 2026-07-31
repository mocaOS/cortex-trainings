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
auth and returns per-model constraints — `durations`, `resolutions`, `aspect_ratios`, whether
audio is generated and whether it is configurable. Guessing an ID from documentation or a
changelog does not work; one such guess (`kling-v3-pro`) does not exist and failed the run at
the quote step.

Wan 2.7 specifics as used here:

- `wan-2-7-reference-to-video` — **5s or 10s only**, takes `reference_image_urls` (up to 9,
  http/https or data URLs). Generates audio, not configurable.
- `wan-2-7-image-to-video` — 5s/10s/15s, takes `image_url` as the start frame. This is what
  chaining uses.

Data URLs work for both reference and start-frame images; a ~240 KB base64 image was accepted
without trouble. Generated clips arrive at ~13–15 MB per 10 seconds of 1080p, with an AAC track
we discard.

The negative prompt reduces but does not eliminate text: expect illegible document-like
lettering on props. Since it is unreadable rather than wrong-language, it is the tolerable
failure mode — but do not rely on generative video for any text a learner must read. That is
what the locally rendered animations are for.

## Images — `gpt-image-2`

Same model the skill originally used, available natively. 16:9 with `aspect_ratio`, 1K via
`resolution`, `quality` high/medium, and up to 4 variants per request. Roughly $0.27 per image
at high quality; `qwen-image` is $0.03 if budget matters more than text fidelity.

It renders text *well*, which is precisely the hazard for a reference image — hence generating
two candidates and having a human pick the clean one.

## Rate limits and billing

Per-tier limits are exposed at `GET /api_keys/rate_limits`, with `x-ratelimit-remaining-*`
response headers. Roughly: images 20/min, audio 60/min, video queue 40/min. Insufficient balance
surfaces as **HTTP 402** — worth distinguishing from a transient error, since retrying it is
pointless.
