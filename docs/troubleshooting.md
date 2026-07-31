# Troubleshooting

Failures actually hit during development, with the signature to recognize them by. Provider
quirks behind several of these are documented in [venice-notes.md](venice-notes.md).

## The curriculum saved as the literal text `undefined`

**Signature:** curriculum version increments, the document is ~9 bytes, no assistant reply.

The whole curriculum travels inside one tool call's `arguments` JSON string. Generation hit the
output token limit mid-string, the JSON no longer parsed, and a swallowed parse error passed empty
arguments to the tool, where a missing value stringified to `"undefined"`.

Fixed on four fronts, since any one alone leaves the failure possible: a generous
`VENICE_MAX_OUTPUT_TOKENS` (64000), `finish_reason === 'length'` surfaced as a warning, parse
failures reported back to the model with a "retry more concisely" hint instead of being swallowed,
and `save_curriculum` refusing anything under 800 characters so a bad call cannot overwrite a good
version.

**Lesson:** never let a `catch {}` convert a provider failure into corrupted state.

## An interaction has no continue button

**Signature:** you answer correctly, the feedback appears, and there is no way forward.

A helper called by one interaction renderer was never defined, so resolving that interaction threw
a `ReferenceError`. It shipped because the first QA pass only exercised one of four interaction
types and stopped at level 2.

**Prevention:** `node scripts/qa-training.mjs <project-id>` drives every interaction's success path
using the correct answers from `plan.json` and walks through to the summary. Run it before sending
a training to anyone.

Fixing the template needs no media regeneration: reset only the `assemble` step in
`production.json` and start production again. Nothing is re-paid.

## Video step fails immediately with a 404 on the model name

**Signature:** `video/quote → 404: Specified model not found: …` with a "did you mean" list.

The model ID does not exist. IDs from documentation or changelogs are not reliable — check the
live catalog (`GET /api/v1/models?type=video`, no auth) which also returns each model's supported
durations and resolutions.

This one is cheap: quoting is free, so a wrong ID costs nothing but a restart.

## Voiceovers are far longer than planned

**Signature:** a script written for ~30 seconds comes back at 41 seconds.

The API's `speed` parameter is ignored by some speech models. Tempo is applied with ffmpeg
`atempo` (`TTS_TEMPO`, default 1.15) instead. If pacing is still off, adjust that — and verify on
a sample, since the right factor varies by voice and language.

## Speech synthesis returns HTTP 500

**Signature:** a run fails partway through voiceover generation, with an internal server error.

Concurrency. Thirty simultaneous requests failed; the same thirty at concurrency 3 succeeded in 28
seconds. `TTS_CONCURRENCY` caps it and 5xx responses are retried with backoff. Per-sentence audio
is cached, so a retry re-synthesizes only the gaps.

## A film ends with a long frozen frame

**Signature:** the video freezes for several seconds while narration continues.

The shot chain is shorter than the voiceover. Shot durations are grown automatically to cover it,
but model tiers are coarse (5/10/15s) and reference-to-video caps at 10s, so a shortfall can
remain — the step logs it explicitly when it does. Either accept it, or shorten that level's
voiceover in the curriculum and re-run.

## Transcription hangs then fails

**Signature:** ~120 seconds of nothing, then a 500.

Whisper on Venice is unreliable for real-length audio. The pipeline no longer transcribes at all —
timings come from per-sentence synthesis. If you reintroduce transcription for foreign audio, note
the response nests timestamps under `timestamps.segment`, singular.

## `ACCENT_COLOR` has no effect

An unquoted `#` starts a comment in dotenv, so `ACCENT_COLOR=#3b82f6` parses as empty. Quote it,
and restart the dev server — it is read server-side.

## Strange behaviour after editing code mid-run

Hot-reload invalidates modules while a pipeline is executing. Never edit `production/**` during a
run; stop it first, or wait. Symptoms are non-deterministic and not worth debugging.

## The resume button is missing

The panel offers a start/resume action whenever a run is stopped — idle or failed. If a run is
`waiting_input` it is not stopped, it is waiting for you: look for the reference-image picker or
the video cost confirmation.

## A step keeps re-running work you already paid for

It should not — completed steps are skipped and artefacts are cached per file. If it does, check
that `STORAGE_PATH` is stable and absolute. A relative default resolving differently between
invocations makes every run look fresh.
