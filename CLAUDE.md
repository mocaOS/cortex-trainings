# Cortex Trainings — repo guide

Web app that turns knowledge-base content into interactive, offline-capable HTML training
units, with Venice.ai as the sole AI provider and a Cortex instance as the domain-knowledge
source.

**`docs/` is the spec of record.** [docs/workflow.md](docs/workflow.md),
[docs/production-pipeline.md](docs/production-pipeline.md) and
[docs/training-format.md](docs/training-format.md) describe what this app actually does; when
behaviour and docs disagree, fix one of them deliberately.

The *idea* comes from Julian Ivanov's `/trainings` skill (see Credits in the README) — but that
skill describes a different toolchain (Higgsfield/Seedance, HyperFrames, local Whisper) than
this app uses, so do not treat it as a specification for this code.

## Commands

```bash
npm install                 # workspaces: apps/web, apps/worker, packages/shared
npm run dev                 # Next.js dev server on :3000
npm run build               # typecheck shared + production build
npm run typecheck           # all workspaces
node scripts/qa-training.mjs <project-id>   # click through a produced training headlessly
```

Runtime needs: Node 22+, ffmpeg/ffprobe on PATH, Playwright Chromium
(`npx playwright install chromium`).

## Layout

```
apps/web/src/lib/            server-only core
  agent.ts                   curriculum agent loop (tool calling)
  tools.ts                   the agent's tools + their executors
  store.ts                   file-based project store (incl. uploaded reference images)
  refs.ts                    vision analysis of uploaded character/style reference images
  production/runner.ts       production state machine, SSE, resume
  production/steps/          one file per pipeline step
  production/steps/template.ts   the generated training's HTML/CSS/JS
packages/shared/src/         Cortex + Venice clients, plan/state types
docs/                        architecture, configuration, pipeline, provider notes
```

## Non-obvious things that will bite you

- **Env changes need a dev-server restart.** `.env` lives at the repo root; Next only
  auto-loads from `apps/web/`, so `apps/web/.env` is a symlink to it.
- **An unquoted `#` in `.env` starts a comment.** `ACCENT_COLOR=#3b82f6` parses as empty —
  quote it.
- **Never edit `production/**` while a pipeline is running.** HMR invalidates modules
  mid-run. Wait for the run to stop, or you will debug ghosts.
- **Stop the dev server before `npm run build`.** They share `apps/web/.next`; running both
  breaks the dev server with manifest ENOENTs and fails the build on `/404` prerendering.
  Neither error means your code is broken — `rm -rf apps/web/.next` and restart dev.
- **Never `pkill -f <pattern>` when the pattern appears in your own command line** — the shell
  kills itself mid-script (exit 144). Kill by port (`lsof -ti:3000`) or by explicit PID.
- **A disconnected client aborts an agent run.** The SSE route drives the agent loop, so if the
  browser (or curl) goes away mid-run, the next event throws on a closed stream and the run ends
  without saving. Long revisions should be started somewhere that won't be interrupted.
- **`STORAGE_PATH` defaults to `./data`, resolved relative to `apps/web/`.** Set an absolute
  path in production.
- **The production runner lives in `globalThis`** so HMR doesn't lose an in-flight run; disk
  state (`production.json`) is authoritative after a restart.
- **Completed steps are skipped on resume** and media files are cached per artefact, so a
  retry never re-pays for finished work. Reset a step by editing `production.json`.
- **Tool-call arguments carry whole documents.** Keep `VENICE_MAX_OUTPUT_TOKENS` generous;
  a truncated tool call is the failure mode (see docs/troubleshooting.md).

Provider quirks that cost real debugging time are documented in `docs/venice-notes.md` —
read it before touching TTS, transcription, or video code.

## Conventions

- Server-only modules import `'server-only'`. API keys never reach the browser; Cortex is
  always proxied through our routes.
- Learner-facing text is in the training's target language; **image and video prompts are
  always English** and end with the no-readable-text clause.
- UI strings live in `apps/web/src/locales/<lang>.json` — never inline. Adding a locale is
  one file plus one line in `lib/i18n.ts`.
- The single chromatic accent comes from `ACCENT_COLOR`; everything else is monochrome
  (Cortex design tokens). Don't introduce a second hue.
- Failures should be loud. `catch {}` that swallows a provider error has already shipped two
  bugs here; report it to the model or fail the step with the message.
