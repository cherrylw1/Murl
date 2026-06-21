import { OpenAICompatProvider } from './openai-compat.js';
import { ProviderConfig } from './types.js';

export class OpenRouterProvider extends OpenAICompatProvider {
  constructor(config: ProviderConfig) {
    super('openrouter', 'https://openrouter.ai/api/v1', config);
  }
}
