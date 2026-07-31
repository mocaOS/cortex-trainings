# Cortex Trainings

Standalone web application that turns domain knowledge from a [Cortex](https://docs.cortex.eco)
instance into interactive, offline-capable HTML training units — implementing the `/trainings`
skill (see `SKILL.md`) with [Venice.ai](https://docs.venice.ai) as the AI provider.

- **Architecture & service analysis:** `OVERVIEW.md`
- **The skill this app implements:** `SKILL.md` (English) / `SKILL-german.md`

## Status

**Milestone 1 (current): Part 1 end-to-end** — briefing → agent research against Cortex
(deep-research fan-out, always `use_agentic`) → `curriculum.md` generation → revision chat →
approval gate. No media spend.

**Milestone 2 (next): Part 2 production** — the `apps/worker` job DAG: Venice video/image/TTS/STT,
HyperFrames renders, ffmpeg muxing, single-file HTML assembly, Playwright QA.

## Layout

```
apps/web        Next.js app — UI (EN/DE via APP_LANG), API routes, agent loop
apps/worker     production worker (milestone 2 stub)
packages/shared types + Cortex client (read-only, SSE deep research) + Venice client
```

## Setup

```bash
cp .env.example .env    # fill in VENICE_API_KEY, CORTEX_BASE_URL, CORTEX_API_KEY
npm install
npm run dev             # → http://localhost:3000
```

Requirements: Node 22+. The Cortex key must be a plain read-only key (`cortex_ro_…`),
ideally collection-scoped. Deep research requires `ENABLE_AGENTIC_RAG` + `ENABLE_AGENT_RESEARCH`
on the Cortex instance.

## Language

`APP_LANG` (`en` | `de`) sets the UI language and the default training content language.
Adding a locale = add `apps/web/src/locales/<lang>.json` and register it in
`apps/web/src/lib/i18n.ts`. The per-training content language is chosen in the briefing
and can differ from the UI language.

## Data

Projects are stored on disk under `STORAGE_PATH` (default `./data`):
`projects/<id>/{project.json, curriculum.md, versions/, chat.json}` — transparent,
versioned, no database required for milestone 1.
