import { OpenAICompatProvider } from './openai-compat.js';
import { ProviderConfig } from './types.js';

export class OllamaProvider extends OpenAICompatProvider {
  constructor(config: ProviderConfig) {
    super('ollama', 'http://localhost:11434/v1', config);
  }
}
