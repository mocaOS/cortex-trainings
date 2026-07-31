# Knowledge-base integration

The Cortex instance is the primary domain source. Everything the curriculum asserts should be
traceable to a document in it, and the curriculum cites those documents by name with a date.

## Connection

`CORTEX_BASE_URL` plus a **plain read-only key** (`cortex_ro_…`), sent as `X-API-Key`. Prefer a
key scoped to specific collections — the exposure of a leaked key is then bounded to content you
already chose to make available.

The docs describe this exact pattern (a standalone app connecting via the REST API with scoped
keys) as supported. All calls are proxied through our server; see
[architecture.md](architecture.md#why-the-knowledge-base-is-proxied) for why.

Deep research needs `ENABLE_AGENTIC_RAG` and `ENABLE_AGENT_RESEARCH` enabled on the instance.

## Data model

```
Collection ─▶ Document ─▶ Chunk (markdown + embedding) ─▶ Entity ─▶ Relationship
                                                            └▶ Community (topic cluster,
                                                                LLM-summarized)
```

It is not a CMS: no templates, no typed fields. Chunk content is plain markdown. Entities are
typed from a fixed set (Person, Organization, Location, Concept, Technology, Event, Product,
Document, System, Process) and relationships from a fixed set of kinds.

**There is no localization in the model.** No language field on documents, chunks or entities,
and no `?lang=` parameter. An instance is German or English by what was ingested, which is why
language is app configuration here rather than a query. See [localization.md](localization.md).

## What the agent can call

| Tool | Endpoint | Purpose |
|---|---|---|
| `cortex_deep_research` | `POST /api/ask/stream` with `use_agentic: true` | The workhorse. Synthesized answer with sources, 15–30s per call |
| `cortex_search` | `POST /api/search` | Fast hybrid retrieval (vector + keyword + graph), raw chunks with filenames |
| `cortex_list_communities` | `GET /api/graph/communities` | Map the domain; clusters double as training-topic candidates |
| `cortex_get_document` | `GET /api/documents/{id}/content` | Read a primary source in full |
| `save_curriculum` | — | Writes the finished document (validated: refuses anything implausibly short) |

Deep research is **always** agentic — there is no configuration toggle. Streaming is used rather
than the blocking variant because the latter carries a server-side deadline of ~28 seconds.

## The research strategy

Deliberately generous, because of a cost asymmetry: a knowledge-base query costs a fraction of
what the agent's own tokens cost, and both are trivial next to a second of generated video. A
well-informed agent writes a better curriculum in fewer expensive iterations.

So the agent is instructed to:

1. **Fan out first.** Issue several deep-research calls in parallel before writing anything — one
   per candidate level, learning objective, or open question.
2. **Keep asking while writing.** Any gap noticed mid-document becomes another call rather than a
   guess.
3. **Read primary sources.** Fetch whole documents when a work instruction or checklist matters,
   instead of relying on retrieved fragments.
4. **Cite, with dates.** Mandatory for subject-matter, legal, and compliance topics.

Do not economize here. Instance quota (`MAX_QUERIES_PER_MONTH`) defaults to unlimited; if a
deployment sets it, size it for research-heavy use rather than rationing calls.

## What good output looks like

The strongest signal of a healthy run is the agent **naming its own gaps**. A real example: asked
for a training on electronic data interchange, it reported that the knowledge base contained
nothing on message-type standards, transfer protocols, or converters, deliberately scoped the
training to the documented operational process, and asked whether to add general domain knowledge
or be given sources.

That is the behaviour to preserve. A curriculum that silently fills gaps with plausible general
knowledge is worse than one that admits the boundary, because nobody can tell which parts came
from your organization's documented reality.

## Operational notes

- **429 and 503 are distinct.** 429 is rate limiting or quota (honour `Retry-After`); 503 is a
  fail-closed auth infrastructure hiccup and is worth retrying. 401/403 are not.
- **`/api/documents` and `/api/collections` are unpaginated** — they return everything. Cache
  client-side on a large instance.
- **Entities are keyed by name**, URL-encoded, not by an opaque id.
- **Metadata and graph reads are quota-free**; search and ask draw on the instance's LLM quota.
- **Source files need the auth header**, so they cannot be an `<img>` or `<iframe>` src — proxy
  them if you ever surface them in the UI.
