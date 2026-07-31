---
description: Headlessly click through a produced training and report what actually works
argument-hint: "<project-id>"
---

Run the browser QA harness against the training produced for project `$1`:

```bash
node scripts/qa-training.mjs $1
```

The harness drives every interaction's success path using the correct answers from
`plan.json`, probes that each embedded video decodes, walks through to the summary screen,
and collects console errors.

Then report:

- Which screens were visited, in order.
- Video decode results (duration, dimensions).
- Final XP, final-check score, cheat-sheet item count.
- Any console errors, verbatim.
- **What the harness did NOT cover** — name it explicitly rather than implying full coverage.

If it fails or gets stuck, find the cause in
`apps/web/src/lib/production/steps/template.ts` (the generated training's JS) and say which
code path is broken. Re-generating after a template fix only needs the `assemble` step:
reset it in `production.json` and POST to the production route — no media is regenerated and
nothing is re-paid.
