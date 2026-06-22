import { OpenAICompatProvider } from './openai-compat.js';
import { ProviderConfig } from './types.js';

export class TogetherProvider extends OpenAICompatProvider {
  constructor(config: ProviderConfig) {
    super('together', 'https://api.together.xyz/v1', config);
  }
}
