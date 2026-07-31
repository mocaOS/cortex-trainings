# Cortex Trainings — Services Overview & Architecture

**Goal:** A standalone web application that implements the `/trainings` skill (SKILL.md) end-to-end:
interactive, offline-capable HTML training units — driven from a web interface, powered by
**Venice.ai** (replacing Higgsfield), with domain content fetched from a **Cortex** instance
(read-only key), UI/content in **English and German** (via env, more locales later).

Research basis: SKILL.md analysis, Venice live model catalog (`GET /api/v1/models?type=all`,
verified 2026-07-31) + OpenAPI spec, Cortex docs (`docs.cortex.eco/llms-full.txt`) cross-checked
against the actual codebase in `~/coding/cortex-app`.

---

## 1. What the skill needs (capability inventory)

The skill's pipeline has two parts — Part 1 (curriculum, free) and Part 2 (production, costly) —
separated by an explicit approval gate. These are the external capabilities it consumes:

| # | Capability | Skill's current provider | Phase |
|---|---|---|---|
| 1 | Orchestrator / agent LLM | Claude (runs the skill interactively) | all |
| 2 | Cinematic video (16:9, 1080p, 4–15 s, start-image chaining, reference-image character consistency) | Higgsfield MCP → Seedance 2.0 | 5 |
| 3 | Image generation (reference character + quiz illustrations, 16:9) | Higgsfield → GPT Image 2 | 3, 7 |
| 4 | TTS voiceover (DE + EN, commercial license) | ElevenLabs via Higgsfield `text2speech_v2` | 4 |
| 5 | Speech-to-text with segment timestamps (beat sync + scene lengths) | local `openai-whisper` | 4, 6 |
| 6 | Explainer animations (HTML/CSS/GSAP → MP4) | HyperFrames (local, free) | 6 |
| 7 | Media processing (atempo, concat, trim, mux, scale) | ffmpeg (local) | 4–8 |
| 8 | HTML assembly (Base64-embed media into single file) | Python script (local) | 9 |
| 9 | Browser QA | local HTTP server + manual click-through | 10 |
| 10 | Research / content source | WebSearch | 1 |

**New requirements from the project goal:**
- #10 is replaced/augmented by a **Cortex instance** as the primary domain-knowledge source.
- #1 becomes an API-driven agent model **from Venice**, set via env.
- Everything is driven from a **web interface** instead of the Claude Code CLI.
- **i18n:** EN + DE via env; architecture must allow more locales later.

---

## 2. Higgsfield → Venice: model-by-model verdict

Venice API: base URL `https://api.venice.ai/api/v1`, auth `Authorization: Bearer <key>`,
OpenAI-compatible endpoints (`/chat/completions`, `/images/generations`, `/audio/speech`,
`/audio/transcriptions`, `/embeddings`) plus native endpoints (`/image/generate`,
`/video/quote|queue|retrieve|complete`, `/audio/voices`). Pricing in USD credits or DIEM staking;
insufficient balance → HTTP 402.

### ✅ Verdict: Venice can replace Higgsfield entirely. One model swap needed (video).

| Skill requirement | Higgsfield | Venice equivalent | Status |
|---|---|---|---|
| Agent LLM | — (Claude CLI) | **`claude-fable-5`** — 1M context, 128K output, function calling, response schema, vision, adaptive thinking. $12/$60 per 1M tok. | ✅ **"fable" exists on Venice.** Set as `VENICE_AGENT_MODEL=claude-fable-5`. |
| Cinematic video | Seedance 2.0, 1080p, 4–15 s, 9 credits/s | **Kling v3 pro / kling-2.6-pro** (5–15 s, 1080p–4K, audio, image-to-video), **Veo 3.1**, **Sora 2 Pro**, **Wan 2.7** (incl. reference-to-video), **LTX-2** (up to 2160p/20 s). 91 video models total. | ⚠️ Seedance is mentioned in Venice's changelog (May 2026) but is **not in the live catalog** — treat as unavailable and default to Kling. Everything the skill needs (start-image chaining, image references, 16:9 1080p, 4–15 s) is covered. |
| Image generation | GPT Image 2 | **`gpt-image-2`** — same model, natively on Venice ($0.27/img at 1K). Cheaper options: `qwen-image` ($0.03, "highest_quality" trait), `nano-banana-2` ($0.10). | ✅ **1:1 identical.** Skill prompts work unchanged. |
| TTS (DE + EN) | ElevenLabs via `text2speech_v2` | **`tts-elevenlabs-turbo-v2-5`** ($62.50/M chars, 21 stock voices + raw ElevenLabs voice IDs, multilingual) or **`tts-gradium-v1`** ($47.50/M, German explicitly confirmed, incl. voice "Maximilian"). `speed` param 0.25–4.0 may replace the ffmpeg `atempo=1.15` step (verify pitch neutrality). | ✅ Same ElevenLabs stack, direct. German: gradium confirmed; ElevenLabs DE supported by the underlying model (Venice publishes no per-language matrix — verify with a test sample, as the skill already mandates). |
| STT with timestamps | local Whisper install | **`openai/whisper-large-v3`** via `/audio/transcriptions` — `timestamps: true` returns word-, segment-, AND character-level times. $0.36/hour of audio. | ✅ **Better than local:** no Python/Whisper install needed in the app. Note: JSON output only (no srt/vtt — irrelevant here, we consume JSON anyway). 25 MB file cap (VO clips are far below). |
| Cost preflight (`get_cost`) | Higgsfield credits | **`POST /video/quote`** — per-request price quote before queuing | ✅ Direct analog. Video pricing is dynamic (no static price list), so the curriculum's cost estimate must be quote-driven. |
| Voice discovery (`list_voices`) | Higgsfield | Voice lists per TTS model + `POST /audio/voices` (voice cloning → `vv_<id>`) | ✅ |
| — (bonus) | — | Music/SFX (14 models: elevenlabs-music, lyria-3-pro, sonilo…), embeddings (bge-m3, e5-multilingual), image edit/upscale/bg-remove | 🎁 Optional: background music per level, semantic caching of Cortex content |

### What Venice does NOT replace (stays local in the app's worker)

- **HyperFrames** animation rendering (Node 22+, `npx hyperframes lint/check/render`) — free, local.
- **ffmpeg** — concat, trim, mux, freeze-frame, compression.
- **HTML assembly** — Base64 embedding into the single-file template.
- **Browser QA** — automate with Playwright (headless) instead of manual click-through.

### Venice caveats to design around

1. **Async video workflow:** quote → queue → poll `retrieve` → `complete`. Download URLs expire ≤24 h — the worker must persist clips immediately.
2. **No static video pricing** — budget display in the curriculum must call `/video/quote` live.
3. **Privacy classes:** `claude-fable-5` is an `anonymized` proxy (Venice anonymizes traffic to Anthropic). If a customer requires fully private inference, fall back to Venice-hosted `zai-org-glm-4.7` (trait `most_intelligent` + `function_calling_default`) — keep the model env-switchable for exactly this reason.
4. **TTS input cap 4,096 chars/request** — fine per scene (~35–45 s ≈ ~700 chars), but chunk defensively.
5. **Rate limits:** image 20 req/min, audio 60/min, video queue 40/min, text L-class 20 req/min & 500K tok/min. Headers `x-ratelimit-remaining-*`; live limits via `GET /api_keys/rate_limits`.

---

## 3. Cortex as the domain-content source

Verified against both `docs.cortex.eco` and the codebase (`cortex-app/backend/app/main.py`, ~150 routes).

**Connection:** `CORTEX_BASE_URL` + read-only API key (`cortex_ro_<64hex>`), header **`X-API-Key`**
(the codebase trusts only this header; `Authorization: Bearer` also appears in docs — use `X-API-Key`).
Ask the operator for a **plain `cortex_ro_` key**, not a monetized `cortex_pub_` one (those are
restricted to 4 endpoints + x402 payment flow). Keys can be **collection-scoped** — recommended.

**Data model:** `Collection → Document → Chunk (markdown text + embedding) → Entity (10 types) → Relationships (14 types)`, plus LLM-summarized **Communities** (topic clusters). Not a CMS — no templates/field types; chunk content is plain markdown.

### Endpoints the app will use (all READ-scope, quota notes inline)

| Purpose | Endpoint | Notes |
|---|---|---|
| Topic discovery for trainings | `GET /api/graph/communities` (+ `/{id}`, `/search`) | Communities = ready-made "training topic" candidates with LLM summaries. Quota-free. |
| Browse structure | `GET /api/collections`, `GET /api/documents?collection_id=` | Unpaginated — cache client-side. Quota-free. |
| Entity/concept map per topic | `GET /api/graph/entities?search=&type=`, `GET /api/graph/entity/{name}` (URL-encode!), `POST /api/graph/subgraph` | Great for level structure / key-takeaway extraction. Quota-free. |
| Retrieval for curriculum writing | `POST /api/search` `{query, top_k, filters}` — hybrid RRF (vector+keyword+graph) | Cheap relative to fable tokens — use freely. |
| Deep Q&A during curriculum authoring | `POST /api/ask/stream` (SSE; sources, graph_context, thinking events) — **always with `use_agentic: true`** (deep research is the app's standard mode, no config toggle) | **The workhorse.** Fire multiple deep-research calls — per level, per learning objective, per open question — both upfront and mid-flow. Prefer streaming (non-stream has a 28 s deadline). |
| Full document content | `GET /api/documents/{id}/content` → chunks + `full_content` | The primary-source fetch. Quota-free. |
| Source files (PDFs etc.) | `GET /api/documents/{id}/file` | Auth-gated binary — must be proxied server-side (can't go in `<img src>`). |

### Integration rules

- **Always proxy Cortex through our backend.** Reasons: the key must never reach the browser; production instances set a CORS allowlist we're not on; `Retry-After` on 429/503 isn't CORS-exposed; file fetches need the header injected.
- Handle **503 + Retry-After** (infra hiccup, fail-closed auth) distinctly from 401/403.
- Respect **429 + Retry-After** (rate limit and monthly quota share the status code).
- **No localization in Cortex:** documents/chunks/entities carry no language field. A cortex is DE *or* EN by what was ingested. → The app treats the Cortex instance's language as configuration (see env), not data.
- The docs explicitly bless our pattern: *"standalone apps — full applications with their own deployment that connect via the REST API with scoped keys."*

---

## 4. Web application architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Frontend (Next.js, i18n EN/DE)                              │
│  • Project dashboard      • Curriculum editor + chat          │
│  • Approval gate UI       • Production monitor (SSE progress) │
│  • Preview & download of finished HTML training               │
└───────────────▲──────────────────────────────────────────────┘
                │ REST + SSE
┌───────────────┴──────────────────────────────────────────────┐
│  Backend API (Node/TS)                                        │
│  • Agent loop: Venice /chat/completions (claude-fable-5)      │
│    with tools: cortex_search, cortex_ask, cortex_get_doc,     │
│    cortex_communities, venice_quote, …                        │
│  • Cortex proxy (X-API-Key injection, retry/quota handling)   │
│  • Job orchestration + approval-gate state machine            │
└───────┬───────────────────────────────┬──────────────────────┘
        │ enqueue                       │ HTTPS
┌───────▼───────────────┐   ┌───────────▼──────────────────────┐
│ Worker (queue: BullMQ │   │ External services                │
│ + Redis)              │   │ • Venice: video (async queue),   │
│ • ffmpeg              │   │   image, TTS, STT, agent LLM     │
│ • HyperFrames render  │   │ • Cortex: read-only content      │
│ • HTML assembler      │   └──────────────────────────────────┘
│ • Playwright QA       │
└───────┬───────────────┘
        ▼
  Object storage / volume: 1080p masters, VO mp3s, renders,
  project state (curriculum.md versions), final HTML files
```

### The two-part workflow, mapped to the app

**Part 1 — Curriculum (no media spend)**
1. **Briefing form** = the skill's Phase-0 AskUserQuestion: topic (suggested from Cortex communities), audience, language, duration.
2. **Research:** agent (`claude-fable-5`) queries Cortex via tools — communities for structure, `/api/search` + `/api/ask/stream` for substance, `/documents/{id}/content` for primary sources. **Strategy: front-load context with a fan-out of deep-research calls** (one per candidate level / learning objective / audience angle) before the agent writes anything, and keep issuing them mid-flow whenever a gap appears — Cortex research is cheap compared to fable's token spend, so there is no reason to economize on it. A well-fed agent writes a better curriculum in fewer expensive iterations. Sources & dates recorded (skill mandate).
3. **Curriculum document** generated per the skill's structure (fact sheet, level table, teaching text, VO scripts, media plan, interactions, final check, cheat sheet, **cost estimate via `/video/quote`**).
4. **⛔ Approval gate as a first-class app state:** curriculum is versioned, shareable (review link), commentable; nothing in Part 2 is reachable until an explicit "Go" click. Edit requests loop back through the agent.

**Part 2 — Production (spends Venice credits)** — a deterministic job DAG per level:
1. Reference image (`gpt-image-2`, 2 candidates, human picks the text-free one in the UI — skill mandate).
2. Voiceovers (TTS → tempo adjust → STT `timestamps:true` → segment JSON).
3. FILM levels: quote → queue Kling shots (start-image chaining for >15 s VOs, last-frame extract via ffmpeg) → concat/trim.
4. ANIMATION levels: HyperFrames scene scaffolds from beat plan + Whisper segments → lint → check → render.
5. Images for interaction screens → compress.
6. Mux, size budget (≤5 MB/clip, ≤50 MB total, downscale embeds to 1280 if needed).
7. Assemble single HTML (template + Base64) → **Playwright QA** (videos decode, interactions incl. failure paths, resume, zero console errors) → deliver download.

Progress streams to the UI via SSE; every media job is resumable/retryable (video jobs especially, given the async queue + 24 h URL expiry).

### i18n design (env-driven, extensible)

Two distinct language axes — keep them separate:
- **`APP_LANG`** (`en` | `de`) — UI language of the web app AND the default content language, matching the connected Cortex instance's language. Locale files (`locales/en.json`, `locales/de.json`) so future locales are a file-drop (e.g. next-intl/i18next).
- **Per-training target language** — the skill already handles this: learner-facing text in target language, **image/video prompts always in English**, TTS voice validated per language (test sample → STT round-trip in that language), layout checks for long German compounds. Defaults to `APP_LANG`, overridable per project.

### Environment specification

```bash
# Venice
VENICE_API_KEY=...
VENICE_BASE_URL=https://api.venice.ai/api/v1
VENICE_AGENT_MODEL=claude-fable-5          # swap to zai-org-glm-4.7 for fully-private inference
VENICE_VIDEO_MODEL=kling-v3-pro            # Seedance not in live catalog; Kling is the default
VENICE_IMAGE_MODEL=gpt-image-2             # identical to the skill's model
VENICE_TTS_MODEL_EN=tts-elevenlabs-turbo-v2-5
VENICE_TTS_MODEL_DE=tts-gradium-v1         # German explicitly confirmed; or elevenlabs after voice test
VENICE_STT_MODEL=openai/whisper-large-v3

# Cortex (read-only production instance)
CORTEX_BASE_URL=https://cortex.example.com
CORTEX_API_KEY=cortex_ro_...               # plain read-only key, ideally collection-scoped

# App
APP_LANG=de                                # en | de (more locales later)
REDIS_URL=redis://...
STORAGE_PATH=/data/projects                # or S3-compatible bucket
```

### Runtime dependencies (worker image)

ffmpeg · Node 22+ (HyperFrames + app) · Playwright + Chromium (QA) · Redis (queue).
**No longer needed vs the skill:** local Whisper/Python (→ Venice STT), Higgsfield MCP, Claude Code CLI.

---

## 5. Cost model (replaces the skill's credit table)

Video dominates (>95% in the skill's Higgsfield math) and Venice prices video **dynamically** —
so the app quotes live: for each FILM level, `POST /video/quote` per planned shot, summed into the
curriculum's production estimate before the approval gate. Static parts:

| Item | Venice price |
|---|---|
| Agent LLM (claude-fable-5) | $12 in / $60 out per 1M tokens |
| Image (gpt-image-2, 1K) | ~$0.27/image (qwen-image alt: $0.03) |
| TTS | $47.50–62.50 per 1M chars (a full training's VO ≈ 5–8K chars → cents) |
| STT | ~$0.36 per audio-hour |
| Video | **quote per request** (duration × resolution × audio) |
| HyperFrames renders | $0 (local) |

Cortex side: effectively free — `MAX_QUERIES_PER_MONTH` defaults to 0 (unlimited), and per call
`/api/search`/`/api/ask` are cheap compared to fable tokens. The curriculum phase researches
generously (multiple deep-research calls upfront and along the way) and caches results per
project so repeated questions don't re-query.

---

## 6. Open items & risks

1. **Seedance on Venice** — changelog says available, live catalog says no. Decide the default video model after a bake-off (Kling v3 pro vs Veo 3.1 vs Wan 2.7) with the skill's style block; keep it env-switchable. Wan 2.7's *reference-to-video* mode is the best structural match for the guide-character consistency requirement.
2. **ElevenLabs German via Venice** — supported by the underlying model but unverified in Venice docs; run the skill's mandated voice test (sample → STT round-trip) during setup, fall back to `tts-gradium-v1`.
3. **TTS `speed` vs ffmpeg atempo** — if Venice's `speed=1.15` is pitch-neutral, one pipeline step disappears; verify on a sample.
4. **Cortex deep-research flags** — deep research (`use_agentic: true`) is always on in the app; the target instance must have `ENABLE_AGENTIC_RAG` + `ENABLE_AGENT_RESEARCH` enabled server-side. Quota is a non-issue (`MAX_QUERIES_PER_MONTH` defaults to 0 = unlimited).
5. **CORS/ops with the Cortex operator** — none needed if we proxy (recommended); just the read-only, ideally collection-scoped key.
6. **`claude-fable-5` is an anonymized proxy** — acceptable per current goal ("set fable in the env"); the env switch to a Venice-private model is the escape hatch if requirements change.
