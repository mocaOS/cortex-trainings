import type {
  CortexAskResult,
  CortexCollection,
  CortexCommunity,
  CortexDocumentContent,
  CortexSearchResult,
} from './types';

export interface CortexClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Max automatic retries on 429/503 (honors Retry-After, capped). */
  maxRetries?: number;
}

/**
 * Read-only client for a Cortex instance. Server-side only — the API key
 * must never reach the browser.
 */
export class CortexClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;

  constructor(opts: CortexClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  private async request(path: string, init?: RequestInit, attempt = 0): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    // 503 = fail-closed auth infra hiccup, 429 = rate limit / monthly quota.
    if ((res.status === 429 || res.status === 503) && attempt < this.maxRetries) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '2');
      const waitMs = Math.min(Math.max(retryAfter, 1), 30) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
      return this.request(path, init, attempt + 1);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Cortex ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`);
    }
    return res;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async collections(): Promise<CortexCollection[]> {
    const res = await this.request('/api/collections');
    const json = (await res.json()) as any;
    return json.collections ?? [];
  }

  async communities(search?: string, limit = 25): Promise<CortexCommunity[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (search) params.set('search', search);
    const res = await this.request(`/api/graph/communities?${params}`);
    const json = (await res.json()) as any;
    return json.communities ?? [];
  }

  async community(id: string): Promise<CortexCommunity> {
    const res = await this.request(`/api/graph/communities/${encodeURIComponent(id)}`);
    return (await res.json()) as any;
  }

  async documents(collectionId?: string): Promise<Array<Record<string, unknown>>> {
    const qs = collectionId ? `?collection_id=${encodeURIComponent(collectionId)}` : '';
    const res = await this.request(`/api/documents${qs}`);
    const json = (await res.json()) as any;
    return json.documents ?? [];
  }

  async documentContent(id: string): Promise<CortexDocumentContent> {
    const res = await this.request(`/api/documents/${encodeURIComponent(id)}/content`);
    return (await res.json()) as any;
  }

  async search(query: string, topK = 10, collectionId?: string): Promise<CortexSearchResult[]> {
    const body: Record<string, unknown> = { query, top_k: topK };
    if (collectionId) body.collection_id = collectionId;
    const res = await this.request('/api/search', { method: 'POST', body: JSON.stringify(body) });
    const json = (await res.json()) as any;
    return json.results ?? [];
  }

  async entity(name: string, maxHops = 1): Promise<Record<string, unknown>> {
    const res = await this.request(
      `/api/graph/entity/${encodeURIComponent(name)}?max_hops=${maxHops}`,
    );
    return (await res.json()) as any;
  }

  /**
   * Deep research via /api/ask/stream with use_agentic always on (app-wide policy).
   * Consumes the SSE stream server-side and returns the accumulated answer + sources.
   */
  async deepResearch(
    question: string,
    opts?: { collectionId?: string; topK?: number; onToken?: (t: string) => void },
  ): Promise<CortexAskResult> {
    const body: Record<string, unknown> = {
      question,
      use_agentic: true,
      use_graph: true,
      use_reranking: true,
      top_k: opts?.topK ?? 8,
    };
    if (opts?.collectionId) body.collection_id = opts.collectionId;

    const res = await this.request('/api/ask/stream', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Accept: 'text/event-stream' },
    });
    if (!res.body) throw new Error('Cortex /api/ask/stream returned no body');

    let answer = '';
    const sources: CortexAskResult['sources'] = [];
    let eventName = '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleData = (data: string) => {
      if (!data) return;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        payload = data;
      }
      const ev = eventName || 'message';
      if (ev === 'content') {
        const token =
          typeof payload === 'string'
            ? payload
            : ((payload as Record<string, unknown>)?.content as string) ?? '';
        answer += token;
        opts?.onToken?.(token);
      } else if (ev === 'sources') {
        const arr = Array.isArray(payload)
          ? payload
          : ((payload as Record<string, unknown>)?.sources as unknown[]) ?? [];
        for (const s of arr) sources.push(s as CortexAskResult['sources'][number]);
      } else if (ev === 'error') {
        throw new Error(`Cortex ask stream error: ${data.slice(0, 500)}`);
      }
      // status / thinking / retrieval / graph_context / memory_update are ignored here.
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '');
        if (line.startsWith(':')) continue; // ping keep-alive
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          handleData(line.slice(5).trim());
        } else if (line === '') {
          eventName = '';
        }
      }
    }

    return { answer, sources };
  }
}
