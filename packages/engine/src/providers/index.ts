import { ProviderId, ProviderConfig, LLMProvider } from './types.js';
import { OpenRouterProvider } from './openrouter.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';

export * from './types.js';
export * from './openai-compat.js';
export * from './openrouter.js';
export * from './gemini.js';
export * from './ollama.js';

export function createProvider(
  name: ProviderId,
  config: ProviderConfig,
): LLMProvider {
  switch (name) {
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    default: {
      const exhaustiveCheck: never = name;
      throw new Error(`Unsupported provider: ${exhaustiveCheck}`);
    }
  }
}
