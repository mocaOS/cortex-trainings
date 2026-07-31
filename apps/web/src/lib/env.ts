import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env variable: ${name}`);
  return v;
}

export const env = {
  get veniceApiKey() {
    return required('VENICE_API_KEY');
  },
  veniceBaseUrl: process.env.VENICE_BASE_URL ?? 'https://api.venice.ai/api/v1',
  veniceAgentModel: process.env.VENICE_AGENT_MODEL ?? 'claude-fable-5',
  /** Analyzes uploaded reference images; must carry `supportsVision` in the catalog. */
  veniceVisionModel:
    process.env.VENICE_VISION_MODEL ?? process.env.VENICE_AGENT_MODEL ?? 'claude-fable-5',
  get cortexBaseUrl() {
    return required('CORTEX_BASE_URL');
  },
  get cortexApiKey() {
    return required('CORTEX_API_KEY');
  },
  appLang: (process.env.APP_LANG ?? 'en') as string,
  storagePath: process.env.STORAGE_PATH ?? './data',
  /** The single chromatic accent — app UI and generated trainings alike. */
  accentColor: process.env.ACCENT_COLOR?.trim() || 'oklch(0.79 0.18 70.67)',
};
