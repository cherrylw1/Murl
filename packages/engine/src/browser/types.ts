export interface InteractiveElement {
  ref: number; // value of injected data-murl-ref attribute
  tag: string; // 'a' | 'button' | 'input' | 'select' | 'textarea' ...
  type?: string; // for inputs
  label: string; // accessible name (see extraction rules)
  href?: string; // for links
}

export interface PageState {
  url: string;
  title: string;
  text: string; // visible innerText, whitespace-collapsed, truncated
  elements: InteractiveElement[];
}

export interface PageStateOptions {
  maxTextChars?: number; // default 5000
  maxElements?: number; // default 100
}

export interface LaunchOptions {
  headless?: boolean; // default true
}
