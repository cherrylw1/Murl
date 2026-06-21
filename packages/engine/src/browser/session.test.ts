import { describe, it, expect, afterEach } from 'vitest';
import { BrowserSession } from './session.js';

describe('BrowserSession', () => {
  let session: BrowserSession | null = null;

  afterEach(async () => {
    if (session) {
      await session.close();
      session = null;
    }
  });

  it('correctly extracts elements and text from an HTML snippet', async () => {
    session = await BrowserSession.launch({ headless: true });

    const testHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page</title>
        </head>
        <body>
          <h1>Welcome to the Test Page</h1>
          <p>This is a paragraph with some description text.</p>
          <a href="https://example.com/link">Click Here</a>
          <button aria-label="Submit Form">Save</button>
          <input type="text" placeholder="Enter name" value="John Doe" />
          <div style="display: none;"><button>Hidden Button</button></div>
        </body>
      </html>
    `;

    await session.setContent(testHtml);
    const state = await session.getPageState();

    expect(state.title).toBe('Test Page');
    expect(state.text).toContain('Welcome to the Test Page');
    expect(state.text).toContain(
      'This is a paragraph with some description text.',
    );

    // We expect exactly 3 visible interactive elements: link, button, input
    expect(state.elements).toHaveLength(3);

    // 1st element: link
    expect(state.elements[0]).toEqual({
      ref: 0,
      tag: 'a',
      type: undefined,
      label: 'Click Here',
      href: 'https://example.com/link',
    });

    // 2nd element: button
    expect(state.elements[1]).toEqual({
      ref: 1,
      tag: 'button',
      type: undefined,
      label: 'Save', // innerText takes precedence: innerText || ariaLabel || ...
      href: undefined,
    });

    // 3rd element: input
    expect(state.elements[2]).toEqual({
      ref: 2,
      tag: 'input',
      type: 'text',
      label: 'Enter name', // innerText and ariaLabel empty, placeholder is 'Enter name'
      href: undefined,
    });
  });

  it('screenshot() returns a PNG Buffer with the correct magic bytes', async () => {
    session = await BrowserSession.launch({ headless: true });
    await session.setContent('<html><body><h1>Hello World</h1></body></html>');

    const screenshotBuffer = await session.screenshot();

    expect(Buffer.isBuffer(screenshotBuffer)).toBe(true);
    expect(screenshotBuffer.length).toBeGreaterThan(0);

    // Verify PNG magic bytes: 0x89 'P' 'N' 'G' 0x0D 0x0A 0x1A 0x0A
    const pngMagic = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const firstEightBytes = screenshotBuffer.subarray(0, 8);
    expect(firstEightBytes).toEqual(pngMagic);
  });
});
