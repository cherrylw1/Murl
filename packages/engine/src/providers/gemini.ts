import { OpenAICompatProvider } from './openai-compat.js';
import { ProviderConfig } from './types.js';

export class GeminiProvider extends OpenAICompatProvider {
  constructor(config: ProviderConfig) {
    super(
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      config,
    );
  }
}
