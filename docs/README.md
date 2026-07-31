# Cortex Trainings — documentation

Cortex Trainings turns the knowledge already sitting in a Cortex instance into interactive
training units: story-driven, gamified, voiced, and delivered as **a single HTML file** that
runs offline on double-click and can be mailed, dropped in Drive, or uploaded to an LMS.

It uses [Venice.ai](https://docs.venice.ai) as its sole AI provider. The idea originates in
Julian Ivanov's `/trainings` skill (see Credits in the [README](../README.md)); these documents
describe what this application does, which differs from that skill's toolchain.

## Read in this order

| Document | What it answers |
|---|---|
| [workflow.md](workflow.md) | How a training gets made, and why the approval gate exists |
| [architecture.md](architecture.md) | What runs where, and how state is stored |
| [configuration.md](configuration.md) | Every environment variable, with the tested values |
| [production-pipeline.md](production-pipeline.md) | The seven production steps in detail, with costs |
| [cortex-integration.md](cortex-integration.md) | Which knowledge-base endpoints are used, and the research strategy |
| [venice-notes.md](venice-notes.md) | Verified provider behaviour — **read before touching media code** |
| [training-format.md](training-format.md) | What the generated HTML file contains and how it behaves |
| [localization.md](localization.md) | The two language axes, and how to add a locale |
| [troubleshooting.md](troubleshooting.md) | Failures we have actually hit, with their signatures |

For repo conventions and development gotchas, see [`../CLAUDE.md`](../CLAUDE.md).
[`../OVERVIEW.md`](../OVERVIEW.md) is the original service analysis that led to this design —
kept as a record of why Venice replaced the skill's original provider.

## The shape of it in one page

```
Briefing form ─▶ fable agent ──▶ curriculum.md ──▶ ⛔ approval ──▶ production ──▶ training.html
  4 inputs        deep research     versioned,        gate           7 steps       single file,
                  over Cortex       reviewable                       resumable     runs offline
                  (cheap)                                            (costs money)
```

Two properties are load-bearing:

**Part 1 is free, Part 2 is not.** Text changes before approval cost nothing. The same change
after production means a new voiceover, a new render, and possibly a new film. So the
curriculum is finished and signed off as a document first — which is also what a legal,
compliance, or subject-matter reviewer can actually read.

**Research is abundant, generation is scarce.** Knowledge-base queries are cheap next to
agent tokens, and agent tokens are cheap next to video seconds. The pipeline spends
accordingly: research generously, generate once.
