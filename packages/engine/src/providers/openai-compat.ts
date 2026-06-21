import {
  LLMProvider,
  ProviderId,
  ProviderConfig,
  CompletionRequest,
  CompletionResponse,
  ProviderError,
  Usage,
} from './types.js';

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly id: ProviderId;
  protected readonly apiKey?: string;
  protected readonly baseUrl: string;

  constructor(id: ProviderId, defaultBaseUrl: string, config: ProviderConfig) {
    this.id = id;
    this.apiKey = config.apiKey;
    // Fallback order: explicitly passed baseUrl -> default base URL
    this.baseUrl = (config.baseUrl || defaultBaseUrl).replace(/\/+$/, '');
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  protected buildRequestBody(
    req: CompletionRequest,
    stream = false,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };
    if (req.temperature !== undefined) {
      body.temperature = req.temperature;
    }
    if (req.maxTokens !== undefined) {
      body.max_tokens = req.maxTokens;
    }
    if (req.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }
    if (stream) {
      body.stream = true;
    }
    return body;
  }

  protected async handleResponseError(res: Response): Promise<never> {
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      bodyText = res.statusText;
    }
    throw new ProviderError(this.id, res.status, bodyText);
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.buildRequestBody(req, false)),
    });

    if (!res.ok) {
      await this.handleResponseError(res);
    }

    const data = (await res.json()) as unknown;

    if (!isRecord(data)) {
      throw new ProviderError(this.id, res.status, 'Invalid response format');
    }

    let text = '';
    if (Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      if (
        isRecord(choice) &&
        isRecord(choice.message) &&
        typeof choice.message.content === 'string'
      ) {
        text = choice.message.content;
      }
    }

    const usage: Usage = {};
    if (isRecord(data.usage)) {
      const u = data.usage;
      if (typeof u.prompt_tokens === 'number') {
        usage.promptTokens = u.prompt_tokens;
      }
      if (typeof u.completion_tokens === 'number') {
        usage.completionTokens = u.completion_tokens;
      }
    }

    return {
      text,
      usage: Object.keys(usage).length > 0 ? usage : undefined,
      raw: data,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(this.buildRequestBody(req, true)),
    });

    if (!res.ok) {
      await this.handleResponseError(res);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new ProviderError(
        this.id,
        res.status,
        'Response body is not readable',
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          if (trimmed === 'data: [DONE]') {
            return;
          }

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              const json = JSON.parse(dataStr) as unknown;
              if (
                isRecord(json) &&
                Array.isArray(json.choices) &&
                json.choices.length > 0
              ) {
                const choice = json.choices[0];
                if (isRecord(choice) && isRecord(choice.delta)) {
                  const content = choice.delta.content;
                  if (typeof content === 'string') {
                    yield content;
                  }
                }
              }
            } catch {
              // Ignore chunk parsing errors for non-JSON content or intermediate blocks
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
