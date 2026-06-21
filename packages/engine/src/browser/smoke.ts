import { BrowserSession } from './session.js';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const url = process.argv[2] || 'https://example.com';
  console.log(`Launching browser and navigating to: ${url}`);

  const session = await BrowserSession.launch({ headless: true });
  try {
    await session.goto(url);
    const state = await session.getPageState();
    console.log('Page State:');
    console.log(JSON.stringify(state, null, 2));

    console.log('Taking screenshot...');
    const buffer = await session.screenshot();
    const screenshotPath = path.resolve('murl-smoke.png');
    fs.writeFileSync(screenshotPath, buffer);
    console.log(`Screenshot saved to: ${screenshotPath}`);
  } catch (error) {
    console.error('Error during smoke test:', error);
  } finally {
    await session.close();
  }
}

main().catch(console.error);
