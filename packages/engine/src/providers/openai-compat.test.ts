import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProvider, ProviderError } from './index.js';

describe('OpenAICompatProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('complete() builds correct POST body and parses response and usage', async () => {
    const mockResponseData = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello, this is a response!',
          },
        },
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const provider = createProvider('openrouter', {
      apiKey: 'test-api-key',
    });

    const response = await provider.complete({
      model: 'meta-llama/llama-3-8b-instruct',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.7,
      maxTokens: 100,
      responseFormat: 'json',
    });

    expect(response.text).toBe('Hello, this is a response!');
    expect(response.usage).toEqual({
      promptTokens: 15,
      completionTokens: 25,
    });
    expect(response.raw).toEqual(mockResponseData);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    });
    const parsedBody = JSON.parse(calledInit.body as string) as Record<
      string,
      unknown
    >;
    expect(parsedBody).toEqual({
      model: 'meta-llama/llama-3-8b-instruct',
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.7,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });
  });

  it('complete() throws ProviderError on a 401 response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized error message',
      statusText: 'Unauthorized',
    } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const provider = createProvider('gemini', {
      apiKey: 'invalid-key',
    });

    await expect(
      provider.complete({
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toThrow(ProviderError);

    try {
      await provider.complete({
        model: 'gemini-1.5-pro',
        messages: [{ role: 'user', content: 'Hi' }],
      });
    } catch (err) {
      const error = err as ProviderError;
      expect(error.providerId).toBe('gemini');
      expect(error.status).toBe(401);
      expect(error.message).toContain('Unauthorized error message');
    }
  });

  it('stream() yields expected deltas from faked SSE body', async () => {
    const mockSSEChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":","}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
      'data: [DONE]\n',
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of mockSSEChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const provider = createProvider('ollama', {
      baseUrl: 'http://localhost:11434/v1',
    });

    const deltas: string[] = [];
    for await (const delta of provider.stream({
      model: 'llama3',
      messages: [{ role: 'user', content: 'Say hello' }],
    })) {
      deltas.push(delta);
    }

    expect(deltas).toEqual(['Hello', ',', ' world']);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('http://localhost:11434/v1/chat/completions');
    expect(calledInit.method).toBe('POST');
    // Ollama has no API key in default config
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
    });
    const parsedBody = JSON.parse(calledInit.body as string) as Record<
      string,
      unknown
    >;
    expect(parsedBody.stream).toBe(true);
  });
});
