import 'server-only';
import { CortexClient, VeniceClient } from '@cortex-trainings/shared';
import { env } from './env';

let cortex: CortexClient | null = null;
let venice: VeniceClient | null = null;
let vision: VeniceClient | null = null;

export function getCortex(): CortexClient {
  cortex ??= new CortexClient({ baseUrl: env.cortexBaseUrl, apiKey: env.cortexApiKey });
  return cortex;
}

export function getVenice(): VeniceClient {
  venice ??= new VeniceClient({
    apiKey: env.veniceApiKey,
    baseUrl: env.veniceBaseUrl,
    model: env.veniceAgentModel,
  });
  return venice;
}

/** Vision-capable client for analyzing uploaded reference images. */
export function getVisionVenice(): VeniceClient {
  vision ??= new VeniceClient({
    apiKey: env.veniceApiKey,
    baseUrl: env.veniceBaseUrl,
    model: env.veniceVisionModel,
  });
  return vision;
}
