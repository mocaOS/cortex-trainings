# Configuration

All configuration is environment variables. Copy `.env.example` to `.env` at the repo root.

> **`.env` lives at the repo root**, but Next.js only auto-loads from `apps/web/`. The repo
> ships `apps/web/.env` as a symlink to the root file. Restart the dev server after any change —
> these are read server-side.

> **Quote values containing `#`.** In dotenv an unquoted `#` starts a comment, so
> `ACCENT_COLOR=#3b82f6` silently parses as empty. Write `ACCENT_COLOR="#3b82f6"`.

## Venice

| Variable | Default | Notes |
|---|---|---|
| `VENICE_API_KEY` | — | required |
| `VENICE_BASE_URL` | `https://api.venice.ai/api/v1` | OpenAI-compatible |
| `VENICE_AGENT_MODEL` | `claude-fable-5` | 1M context, function calling. Switch to a Venice-hosted model (e.g. `zai-org-glm-4.7`) if inference must stay private |
| `VENICE_MAX_OUTPUT_TOKENS` | `64000` | A whole curriculum travels inside one tool call's arguments. Too low truncates it mid-JSON — see [troubleshooting.md](troubleshooting.md) |
| `VENICE_IMAGE_MODEL` | `gpt-image-2` | 16:9, 1K, quality high/medium |
| `VENICE_IMAGE_EDIT_MODEL` | `gpt-image-2-edit` | Renders the guide character from **uploaded reference images** via `/image/multi-edit`. Only used when a project has character refs |
| `VENICE_VISION_MODEL` | = `VENICE_AGENT_MODEL` | Analyzes uploaded character/style reference images into prompt text. Must carry `supportsVision` in the catalog (`claude-fable-5` does) |
| `VENICE_VIDEO_MODEL` | `wan-2-7-reference-to-video` | first shot of a sequence; keeps the guide character consistent. **5s/10s only** |
| `VENICE_VIDEO_CHAIN_MODEL` | `wan-2-7-image-to-video` | follow-up shots, chained from the previous last frame. 5s/10s/15s |
| `VENICE_VIDEO_TEXT_MODEL` | text-to-video sibling of `VENICE_VIDEO_MODEL` | shots the storyboard marks character-free, when the project has no style references. The default swaps `-reference-to-video` for `-text-to-video` so the family never changes mid-film — a Wan clip beside a MiniMax clip differs in resolution, frame rate and grade, and the cut is visible |
| `VENICE_VIDEO_RESOLUTION` | `1080p` | |
| `VENICE_TTS_MODEL_DE` | `tts-gradium-v1` | German confirmed |
| `VENICE_TTS_VOICE_DE` | `Maximilian` | |
| `VENICE_TTS_MODEL_EN` | `tts-elevenlabs-turbo-v2-5` | |
| `VENICE_TTS_VOICE_EN` | `Rachel` | |
| `TTS_TEMPO` | `1.15` | Applied with ffmpeg `atempo`, **not** the API's `speed` — some models ignore `speed` entirely |
| `TTS_CONCURRENCY` | `3` | Higher values draw HTTP 500s from the speech endpoint |
| `VENICE_STT_MODEL` | `openai/whisper-large-v3` | Currently unused: timing comes from per-sentence synthesis instead |

Model IDs are not stable forever — verify against the live catalog
(`GET /api/v1/models?type=video`, no auth needed) before trusting one. A wrong ID fails at the
free quote step rather than costing anything.

## Cortex

| Variable | Notes |
|---|---|
| `CORTEX_BASE_URL` | e.g. `https://cortex.example.com` |
| `CORTEX_API_KEY` | A plain read-only key (`cortex_ro_…`), ideally scoped to one collection. **Not** a monetized `cortex_pub_` key — those are restricted to a handful of endpoints behind a payment flow |

Deep research requires `ENABLE_AGENTIC_RAG` and `ENABLE_AGENT_RESEARCH` on the instance.

## Application

| Variable | Default | Notes |
|---|---|---|
| `APP_LANG` | `en` | `en` \| `de`. UI language and the default content language. See [localization.md](localization.md) |
| `ACCENT_COLOR` | `oklch(0.79 0.18 70.67)` | The single chromatic colour, in the app UI **and** in generated trainings and animations. Any CSS colour; quote hex values |
| `STORAGE_PATH` | `./data` | Resolved relative to `apps/web/`. **Set an absolute path in production** |

## Runtime dependencies

- **Node 22+**
- **ffmpeg + ffprobe** on PATH — tempo, concatenation, muxing, trimming, compression
- **Playwright Chromium** (`npx playwright install chromium`) — animation rendering and QA

No Python, no Redis, no local speech model.
