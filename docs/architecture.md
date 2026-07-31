# Architecture

```
┌───────────────────────────────────────────────────────────────┐
│ Browser — Next.js app (dark Cortex design tokens, EN/DE)      │
│  dashboard · briefing form · curriculum + revision chat        │
│  approval gate · production panel (live steps) · download      │
└───────────▲───────────────────────────────────┬───────────────┘
            │ SSE (agent + production events)   │ REST
┌───────────┴───────────────────────────────────▼───────────────┐
│ Next.js server (all secrets, all provider calls)              │
│  lib/agent.ts        curriculum agent loop (tool calling)      │
│  lib/tools.ts        knowledge-base tools + save_curriculum    │
│  lib/store.ts        file-based project store                  │
│  lib/refs.ts         vision analysis of uploaded ref images    │
│  lib/production/     runner (state machine) + steps/           │
│  api/…/asset,download  proxied media, never a raw file path     │
└───────┬───────────────────────────────────┬───────────────────┘
        │ ffmpeg · Playwright (local)        │ HTTPS
┌───────▼───────────────┐   ┌────────────────▼──────────────────┐
│ Local tools           │   │ Providers                          │
│  ffmpeg/ffprobe       │   │  Venice — agent LLM, image, TTS,   │
│  Chromium (rendering, │   │    async video, (transcription)    │
│  QA)                  │   │  Cortex — read-only knowledge base │
└───────────────────────┘   └────────────────────────────────────┘
```

Everything runs in one process. There is no queue and no second service: production is an
in-process state machine whose progress is persisted after every transition, which is what
makes it resumable without external infrastructure.

## Workspaces

```
packages/shared     Cortex client, Venice clients, plan/state types (no server deps)
apps/web            the application — UI, API routes, agent, production pipeline
apps/worker         placeholder for extracting production into its own process
scripts/            qa-training.mjs — automated browser QA
```

`packages/shared` is deliberately free of `server-only` imports so its types can be used in
client components; the clients inside it are still only ever constructed server-side.

## State on disk

`STORAGE_PATH` (default `apps/web/data`) holds everything. No database.

```
projects/<uuid>/
  project.json        status, briefing, curriculum version, approval timestamp
  curriculum.md       current version
  versions/v<n>.md    every version ever saved
  chat.json           the conversation with the agent
  plan.json           structured production plan
  production.json     per-step status, quotes, human-input results
  refs.json           vision analysis of uploaded character/style reference images
  media/
    ref.jpg              chosen guide-character reference
    ref-candidates/      all candidates, kept for later review
    refs/                uploaded character/style reference images (character-<n>, style-<n>)
    vo/level<n>.mp3      voiceover per level
    vo/level<n>.json     exact sentence timeline
    vo/chunks/           per-sentence audio (cache — a retry re-pays nothing)
    films/               shots, plus the final voiced sequence
    anim/                rendered animations
    img/                 interaction-screen images
  training.html       the deliverable
```

Plain files were chosen over a database because the artefacts are the point: a curriculum can
be diffed, a version can be recovered, media can be inspected, and a failed run can be
resumed by editing one JSON file.

## Production runner

`lib/production/runner.ts` walks a fixed step order, and for each step:

1. marks it `running` and persists,
2. executes it,
3. marks it `completed` (or `failed` with the error message) and persists.

Consequences worth knowing:

- **Completed steps are skipped on resume.** Restarting after a failure re-runs only the
  failed step onwards.
- **Artefacts are cached per file.** Even within a step, existing media is reused — a
  half-finished film sequence resumes at the missing shot.
- **The run object lives in `globalThis`** so hot-reload during development doesn't lose an
  in-flight pipeline. After a real restart, `production.json` is authoritative.
- **Human input is a first-class state.** A step can enter `waiting_input`, which parks the
  pipeline until the UI posts the answer — used for the reference-image pick and the video
  cost confirmation.

## Why the knowledge base is proxied

The Cortex API key never reaches the browser, and it never appears in a URL. All reads go
through server routes, which also means:

- the app's origin doesn't need to be on the instance's CORS allowlist,
- `Retry-After` on rate limits and transient failures can actually be read and honoured,
- source files (PDFs and the like) can be served, since they need an auth header and so can't
  be an `<img>` or `<iframe>` source.

Produced media is likewise served through an asset route that confines paths to the project's
own media directory.
