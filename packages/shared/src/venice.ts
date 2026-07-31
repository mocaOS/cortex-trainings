export interface VeniceClientOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Multimodal user-message parts (OpenAI-compatible). Image URLs may be data URLs. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** OpenAI-compatible Venice chat client (server-side only). */
export class VeniceClient {
  private apiKey: string;
  private baseUrl: string;
  readonly model: string;

  constructor(opts: VeniceClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.venice.ai/api/v1').replace(/\/$/, '');
    this.model = opts.model;
  }


  /**
   * Retries transient failures. A single `fetch failed` (a network blip, a reset connection)
   * once threw away a multi-minute research run, and 429/5xx are worth waiting out rather
   * than losing the conversation.
   */
  private async post(path: string, body: string, what: string, tries = 4): Promise<Response> {
    let lastError = '';
    for (let n = 0; n < tries; n++) {
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
        });
        if (res.ok || !(res.status === 429 || res.status >= 500)) return res;
        lastError = `status ${res.status}`;
        const retryAfter = Number(res.headers.get('Retry-After') ?? '0');
        await this.wait(retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** n, 20000));
      } catch (err) {
        // Network-level failure: no response at all.
        lastError = err instanceof Error ? err.message : String(err);
        if (n === tries - 1) break;
        await this.wait(Math.min(2000 * 2 ** n, 20000));
      }
    }
    throw new Error(`Venice ${what}: ${lastError} (after ${tries} attempts)`);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Chat completion forced into a JSON schema; returns the parsed object. */
  async chatJson<T>(
    messages: AgentMessage[],
    schema: { name: string; schema: Record<string, unknown> },
    opts?: { maxTokens?: number },
  ): Promise<T> {
    const res = await this.post(
      '/chat/completions',
      JSON.stringify({
        model: this.model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: { name: schema.name, strict: true, schema: schema.schema },
        },
        max_tokens: opts?.maxTokens ?? 32768,
        stream: false,
      }),
      'chatJson',
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Venice chatJson → ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as any;
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('Venice chatJson returned no content');
    try {
      return JSON.parse(content) as T;
    } catch {
      throw new Error(`Venice chatJson returned non-JSON content: ${String(content).slice(0, 300)}`);
    }
  }

  async chat(
    messages: AgentMessage[],
    opts?: { tools?: ToolDefinition[]; maxTokens?: number; temperature?: number },
  ): Promise<ChatCompletionResult> {
    const res = await this.post(
      '/chat/completions',
      JSON.stringify({
        model: this.model,
        messages,
        ...(opts?.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
        max_tokens: opts?.maxTokens ?? 16384,
        ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
        stream: false,
      }),
      'chat/completions',
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 402) {
        throw new Error('Venice: insufficient balance (HTTP 402). Top up USD credits or DIEM.');
      }
      throw new Error(`Venice chat/completions → ${res.status}: ${body.slice(0, 500)}`);
    }
    const json = (await res.json()) as any;
    const choice = json.choices?.[0];
    if (!choice) throw new Error('Venice returned no choices');
    return {
      content: choice.message?.content ?? null,
      toolCalls: choice.message?.tool_calls ?? [],
      finishReason: choice.finish_reason ?? 'stop',
      usage: json.usage,
    };
  }
}
