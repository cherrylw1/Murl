// RUN WITH:
// $env:GEMINI_API_KEY="your-api-key"
// pnpm --filter @murl/engine exec tsx src/agent/agent-smoke.ts "Find the 'More information' link, click it, and complete" "https://example.com" "gemini" "gemini-1.5-flash"

import { createProvider, ProviderId } from '../providers/index.js';
import { runAgent } from './loop.js';
import { BrowserSession } from '../browser/session.js';

async function main() {
  const goal =
    process.argv[2] ||
    'Find the "More information" link, click it, and complete';
  const url = process.argv[3] || 'https://example.com';
  const providerName = (process.argv[4] || 'gemini') as ProviderId;
  const model = process.argv[5] || 'gemini-1.5-flash';

  console.log('--- Murl Autonomous Agent Smoke Test ---');
  console.log(`Goal: "${goal}"`);
  console.log(`URL: ${url}`);
  console.log(`Provider: ${providerName}`);
  console.log(`Model: ${model}`);

  let apiKey: string | undefined = undefined;
  let baseUrl: string | undefined = undefined;

  if (providerName === 'gemini') {
    apiKey = process.env.GEMINI_API_KEY;
  } else if (providerName === 'openrouter') {
    apiKey = process.env.OPENROUTER_API_KEY;
  } else if (providerName === 'ollama') {
    baseUrl = process.env.OLLAMA_BASE_URL;
  }

  if (providerName !== 'ollama' && !apiKey) {
    console.warn(
      `Warning: No API key found in environment for provider ${providerName}.`,
    );
  }

  const provider = createProvider(providerName, { apiKey, baseUrl });

  console.log('Launching browser with headless: false...');
  const session = await BrowserSession.launch({ headless: false });

  try {
    const result = await runAgent({
      goal,
      url,
      provider,
      model,
      session,
      maxTurns: 5,
    });

    console.log('--- Run Result ---');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('E2E run failed:', error);
  } finally {
    await session.close();
  }
}

main().catch(console.error);
