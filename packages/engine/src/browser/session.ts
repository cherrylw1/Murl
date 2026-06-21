import { chromium, Browser, BrowserContext, Page } from 'playwright';
import {
  PageState,
  PageStateOptions,
  LaunchOptions,
  InteractiveElement,
} from './types.js';

export class BrowserSession {
  private readonly browser: Browser;
  private readonly context: BrowserContext;
  readonly page: Page;

  private constructor(browser: Browser, context: BrowserContext, page: Page) {
    this.browser = browser;
    this.context = context;
    this.page = page;
  }

  static async launch(opts?: LaunchOptions): Promise<BrowserSession> {
    const headless = opts?.headless ?? true;
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    return new BrowserSession(browser, context, page);
  }

  async goto(url: string): Promise<void> {
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    try {
      // Short network settle
      await this.page.waitForLoadState('networkidle', { timeout: 2000 });
    } catch {
      // Ignore networkidle timeout to handle pages that stream indefinitely
    }
  }

  async setContent(html: string): Promise<void> {
    await this.page.setContent(html);
  }

  async getPageState(opts?: PageStateOptions): Promise<PageState> {
    const maxTextChars = opts?.maxTextChars ?? 5000;
    const maxElements = opts?.maxElements ?? 100;

    return this.page.evaluate(
      ({ maxTextChars, maxElements }) => {
        // 1. Remove existing data-murl-ref attributes to clear stale refs
        const existingRefs = document.querySelectorAll('[data-murl-ref]');
        existingRefs.forEach((el) => el.removeAttribute('data-murl-ref'));

        // 2. Select potential interactive elements in document order
        const selector =
          'a[href], button, input, textarea, select, [role="button"], [role="link"], [onclick]';
        const allElements = Array.from(document.querySelectorAll(selector));

        const elements: InteractiveElement[] = [];
        let refCount = 0;

        for (const el of allElements) {
          if (refCount >= maxElements) {
            break;
          }

          // Check visibility (bounding box dimensions > 0 and style check)
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          const isVisible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none';

          if (!isVisible) {
            continue;
          }

          // Assign ref attribute
          const ref = refCount++;
          el.setAttribute('data-murl-ref', String(ref));

          // Get tag
          const tag = el.tagName.toLowerCase();

          // Get type for inputs only
          let type: string | undefined = undefined;
          if (tag === 'input') {
            type = el.getAttribute('type') || 'text';
          }

          // Get label: first non-empty of innerText, aria-label, placeholder, value, title, alt
          const innerText = el.textContent?.trim() || '';
          const ariaLabel = el.getAttribute('aria-label')?.trim() || '';
          const placeholder = el.getAttribute('placeholder')?.trim() || '';
          const value = (el as HTMLInputElement).value?.trim() || '';
          const title = el.getAttribute('title')?.trim() || '';
          const alt = el.getAttribute('alt')?.trim() || '';

          let label =
            innerText ||
            ariaLabel ||
            placeholder ||
            value ||
            title ||
            alt ||
            '';
          if (label.length > 120) {
            label = label.slice(0, 120);
          }

          // Get href for links
          let href: string | undefined = undefined;
          if (tag === 'a' || el.getAttribute('role') === 'link') {
            href = el.getAttribute('href') || undefined;
          }

          elements.push({
            ref,
            tag,
            type,
            label,
            href,
          });
        }

        // 4. Extract body inner text, collapse whitespace, truncate
        let text = document.body ? document.body.innerText : '';
        text = text.replace(/\s+/g, ' ').trim();
        if (text.length > maxTextChars) {
          text = text.slice(0, maxTextChars);
        }

        return {
          url: window.location.href,
          title: document.title,
          text,
          elements,
        };
      },
      { maxTextChars, maxElements },
    );
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ fullPage: true });
  }

  async close(): Promise<void> {
    await this.page.close().catch(() => {});
    await this.context.close().catch(() => {});
    await this.browser.close().catch(() => {});
  }
}
