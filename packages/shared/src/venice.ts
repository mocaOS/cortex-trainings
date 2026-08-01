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
        // Network-level failure: no response at all. Surface undici's cause code —
        // a bare "fetch failed" hid a 300s headers timeout behind four silent retries.
        const cause = (err as { cause?: { code?: string } })?.cause?.code;
        const message = err instanceof Error ? err.message : String(err);
        lastError = cause ? `${message} (${cause})` : message;
        // A headers/body timeout is not a transient blip — the request already ran
        // for five minutes. Retrying it three more times just burns twenty of them.
        if (cause === 'UND_ERR_HEADERS_TIMEOUT' || cause === 'UND_ERR_BODY_TIMEOUT') {
          throw new Error(
            `Venice ${what}: ${lastError}. The response did not start within Node's 300s ` +
              'fetch timeout — non-streaming completions this large need stream:true.',
          );
        }
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

  /**
   * Streamed chat completion. Streaming is not a nicety here: Node's fetch aborts a
   * request whose response has not STARTED within 300s, and writing a whole curriculum
   * into one tool-call argument routinely takes longer than that. Non-streaming meant
   * the response began only when the model was finished, so the big save_curriculum turn
   * died on the timeout and took the run with it. Streamed, the headers arrive at once
   * and every delta resets the idle clock, so only a genuinely stalled model fails.
   *
   * `onToken` exists so callers can show progress during a multi-minute completion —
   * the silence in between was indistinguishable from a hang.
   */
  async chat(
    messages: AgentMessage[],
    opts?: {
      tools?: ToolDefinition[];
      maxTokens?: number;
      temperature?: number;
      onToken?: (delta: string) => void;
    },
  ): Promise<ChatCompletionResult> {
    const res = await this.post(
      '/chat/completions',
      JSON.stringify({
        model: this.model,
        messages,
        ...(opts?.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
        max_tokens: opts?.maxTokens ?? 16384,
        ...(opts?.temperature != null ? { temperature: opts.temperature } : {}),
        stream: true,
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
    if (!res.body) throw new Error('Venice chat/completions returned no body');

    let content = '';
    let finishReason = 'stop';
    let usage: ChatCompletionResult['usage'];
    // Sparse: tool-call deltas are addressed by `index`, and only the first delta of
    // each carries id/name — the arguments arrive as fragments that must be concatenated
    // in order. Reassembling these wrong is how a tool call turns into unparseable JSON.
    const partials: Array<ToolCall | undefined> = [];
    let sawChunk = false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '').trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        sawChunk = true;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.error) {
          throw new Error(
            `Venice chat/completions stream error: ${JSON.stringify(chunk.error).slice(0, 500)}`,
          );
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta;
        if (!delta) continue;
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          opts?.onToken?.(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const i: number = tc.index ?? 0;
          const slot = (partials[i] ??= {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.function.name = tc.function.name;
          if (tc.function?.arguments) slot.function.arguments += tc.function.arguments;
        }
      }
    }

    if (!sawChunk) throw new Error('Venice chat/completions stream produced no chunks');

    return {
      content: content || null,
      toolCalls: partials.filter((c): c is ToolCall => Boolean(c)),
      finishReason,
      usage,
    };
  }
}
