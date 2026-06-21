export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json'; // 'json' => response_format json_object
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CompletionResponse {
  text: string;
  usage?: Usage;
  raw?: unknown;
}

export type ProviderId = 'openrouter' | 'gemini' | 'ollama';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface LLMProvider {
  readonly id: ProviderId;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): AsyncIterable<string>; // yields text deltas
}

export class ProviderError extends Error {
  readonly providerId: ProviderId;
  readonly status?: number;

  constructor(
    providerId: ProviderId,
    status: number | undefined,
    message: string,
  ) {
    super(`ProviderError (${providerId}): ${message}`);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.status = status;
  }
}
