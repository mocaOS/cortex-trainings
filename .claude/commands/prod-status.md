---
description: Show the production pipeline state of a training project
argument-hint: "[project-id or omit for all]"
---

Inspect production state for training projects under `STORAGE_PATH` (default
`apps/web/data/projects`).

For `$1` (or every project when no id is given), report concisely:

1. From `project.json`: status, curriculum version, briefing topic (shortened), language.
2. From `production.json` (if present): overall status plus one line per step with its
   status, `detail`, and `error`.
3. From `plan.json` (if present): level count with each level's medium and interaction kind.
4. Media on disk: sizes of `media/vo`, `media/films`, `media/anim`, `media/img`, and whether
   `training.html` exists (with its size).
5. If a step failed, quote the error and say what a resume would re-run versus skip.

Read the files directly — do not start the dev server. Finish with a one-line verdict:
what state the project is in and what the next action would be.
