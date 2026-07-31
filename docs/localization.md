# Localization

Two language axes, deliberately separate.

## 1. App language — `APP_LANG`

The web interface, and the default content language for new trainings. `en` or `de` today.

Strings live in `apps/web/src/locales/<lang>.json`, keyed by dotted names
(`project.approve`, `production.step.films`). Never inline a user-visible string in a component.

**Adding a locale:**

1. Copy `en.json` to `<lang>.json` and translate the values.
2. Register it in `apps/web/src/lib/i18n.ts` (import plus one entry in the `dicts` map).
3. Set `APP_LANG=<lang>`.

`getLang()` falls back to `en` for an unknown value, so a typo degrades rather than crashes.

## 2. Training content language

Chosen per project in the briefing; defaults to `APP_LANG` but can differ — an English UI can
produce a German training. It drives:

- **Learner-facing text** — voiceover scripts, on-screen text, quizzes, feedback, the summary.
- **The voice** — `VENICE_TTS_MODEL_DE` / `_EN` and their voices are selected by language.
- **The `lang` attribute** and the UI string table inside the generated HTML file.

Adding a content language means adding a string table in
`apps/web/src/lib/production/steps/template.ts` and a TTS model/voice pair in
`apps/web/src/lib/production/media-client.ts`. Validate the voice with a test sample before
committing to it — provider language coverage is not always documented.

## Rules that hold for every language

- **Image and video prompts are always English.** The models are trained on it. Every prompt ends
  with the no-readable-text clause so no wrong-language lettering ends up in a frame.
- **Text a learner must read belongs in an animation**, not in generated video. Locally rendered
  scenes give sharp text in any script; generative video cannot.
- **Check the layout per language.** German and Finnish compounds break single-line titles;
  Spanish and French need more lines. The animation template keeps titles on one line, so a long
  compound is a real risk.
- **Use the target language's typographic quotation marks** (German „…", English "…"). Straight
  quotes inside generated JS strings break them.

## The knowledge base has no language dimension

Cortex stores no language field and offers no language filter — an instance is German or English
by what was ingested. So a deployment pairs one instance with one `APP_LANG`; two languages means
two instances (or collections) and two configurations, not a query parameter.

If you point a German `APP_LANG` at an English instance it will still work — the agent reads
English sources and writes German output — but sources cited in the curriculum will be in the
other language, which reviewers notice.
