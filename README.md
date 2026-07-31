# Cortex Trainings

Standalone web application that turns domain knowledge from a [Cortex](https://docs.cortex.eco)
instance into interactive, offline-capable HTML training units — implementing the `/trainings`
skill (see `SKILL.md`) with [Venice.ai](https://docs.venice.ai) as the AI provider.

- **Documentation:** [`docs/`](docs/) — start with [docs/README.md](docs/README.md)
- **The skill this app implements:** `SKILL.md` (English) / `SKILL-german.md`
- **Original service analysis:** `OVERVIEW.md`
- **Repo guide for Claude Code:** `CLAUDE.md`

## How it works

```
Briefing ─▶ fable agent ──▶ curriculum.md ──▶ ⛔ approval ──▶ production ──▶ training.html
 4 inputs   deep research    versioned,        gate           7 steps       single file,
             over Cortex     reviewable                       resumable     runs offline
             (cheap)                                          (costs money)
```

Part 1 is free, so content gets finished and signed off as a document before any media is
generated. Part 2 pauses twice for human judgement: picking the guide-character reference
image, and confirming the live video cost quote. See [docs/workflow.md](docs/workflow.md).

## Setup

```bash
cp .env.example .env    # VENICE_API_KEY, CORTEX_BASE_URL, CORTEX_API_KEY
npm install
npx playwright install chromium
npm run dev             # → http://localhost:3000
```

Requirements: Node 22+, ffmpeg and ffprobe on PATH, Playwright Chromium. The Cortex key must
be a plain read-only key (`cortex_ro_…`), ideally collection-scoped, and the instance needs
`ENABLE_AGENTIC_RAG` + `ENABLE_AGENT_RESEARCH` for deep research.

Full reference: [docs/configuration.md](docs/configuration.md).

## Layout

```
apps/web         Next.js app — UI, API routes, agent loop, production pipeline
apps/worker      placeholder for extracting production into its own process
packages/shared  Cortex + Venice clients, plan/state types
scripts/         qa-training.mjs — automated browser QA of a produced training
docs/            architecture, pipeline, provider notes, troubleshooting
```

## Commands

```bash
npm run dev                                  # dev server
npm run build                                # typecheck + production build
npm run typecheck                            # all workspaces
node scripts/qa-training.mjs <project-id>    # click through a produced training
```

## Data

Everything lives on disk under `STORAGE_PATH` (default `apps/web/data`) — project metadata,
every curriculum version, the production plan, per-step state, and all media. No database:
the artefacts are the point, so they stay diffable, recoverable, and inspectable. Layout in
[docs/architecture.md](docs/architecture.md#state-on-disk).

## Credits

The idea for this comes from **Julian Ivanov**, whose skill and video
[demonstrated the approach](https://youtu.be/gz0PBC2P9eg) — building a complete interactive
learning unit as a single offline HTML file, with a curriculum written and approved before any
expensive media is generated. `SKILL.md` is that skill; this repo turns it into a web app that
sources its content from a knowledge base. Thanks, Julian.
