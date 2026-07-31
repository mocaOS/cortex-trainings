/**
 * Production worker — MILESTONE 2 (Part 2 of the workflow, unlocked by curriculum approval).
 *
 * Planned job DAG per level (see OVERVIEW.md §4):
 *  1. Reference image (Venice gpt-image-2, 2 candidates, human pick)
 *  2. Voiceover: Venice TTS → tempo adjust → Venice STT (timestamps) → segment JSON
 *  3. FILM levels: /video/quote → queue → poll retrieve → persist (URLs expire ≤24h)
 *  4. ANIMATION levels: HyperFrames scaffold → lint → check → render
 *  5. Interaction images → compress
 *  6. ffmpeg mux, size budget
 *  7. HTML assembly (Base64) → Playwright QA → deliverable
 *
 * Runtime deps: ffmpeg, HyperFrames (npx), Playwright, Redis (BullMQ).
 */
console.log('cortex-trainings worker: milestone 2 — not yet implemented');
