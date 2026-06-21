import { Message } from '../providers/types.js';
import { PageState } from '../browser/types.js';

export const SYSTEM_PROMPT = `You are Murl, an autonomous web agent. Each turn you get the current page state. Choose exactly ONE action and reply with a SINGLE JSON object — no prose, no markdown fences.

Your response must conform to one of the following JSON schemas:
1. Click an element:
{"action": "click", "ref": <number>, "thought": "<short explanation>"}

2. Type text into an input:
{"action": "type", "ref": <number>, "text": "<text to type>", "thought": "<short explanation>"}

3. Scroll the page:
{"action": "scroll", "direction": "up"|"down", "thought": "<short explanation>"}

4. Extract data from the page:
{"action": "extract", "data": <any JSON value>, "thought": "<short explanation>"}

5. Complete the goal:
{"action": "complete", "result": <any JSON value>, "thought": "<short explanation>"}

Instructions:
- Use 'extract' to capture target data you find.
- Use 'complete' with a result when the overall goal has been achieved.
- Always include a short 'thought' explaining your reasoning.`;

export function buildMessages(goal: string, page: PageState): Message[] {
  const elementsStr = page.elements
    .map((el) => {
      const hrefPart = el.href ? ` ${el.href}` : '';
      return `[${el.ref}] ${el.tag} "${el.label}"${hrefPart}`;
    })
    .join('\n');

  const userContent = `Goal: ${goal}

Current Page:
URL: ${page.url}
Title: ${page.title}

Visible Text:
${page.text}

Interactive Elements:
${elementsStr}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
