import { describe, it, expect, vi, afterEach } from 'vitest';
import { createProvider } from './index.js';

describe('TogetherProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('complete() builds correct POST body and parses response and usage', async () => {
    const mockResponseData = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello from Together AI!',
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
      },
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponseData,
    } as Response);

    vi.stubGlobal('fetch', mockFetch);

    const provider = createProvider('together', {
      apiKey: 'together-test-key',
    });

    const response = await provider.complete({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.8,
      maxTokens: 50,
    });

    expect(response.text).toBe('Hello from Together AI!');
    expect(response.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
    });
    expect(response.raw).toEqual(mockResponseData);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('https://api.together.xyz/v1/chat/completions');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer together-test-key',
    });
    const parsedBody = JSON.parse(calledInit.body as string) as Record<
      string,
      unknown
    >;
    expect(parsedBody).toEqual({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.8,
      max_tokens: 50,
    });
  });
});
