import { createServiceToken, type JsonValue } from "@memorall/agent-harness-core";

export type WebCapability =
  | "session.open"
  | "session.multiple"
  | "content.read"
  | "content.search"
  | "dom.query"
  | "dom.action"
  | "wait.render"
  | "wait.selector";

export interface WebCapabilities {
  supported: readonly (WebCapability | string)[];
  presentations?: readonly string[];
  extensions?: Readonly<Record<string, JsonValue>>;
}

export interface WebSession {
  id: string;
  requestedUrl: string;
  currentUrl: string;
  title: string;
  html: string;
  text: string;
  domAccessible: boolean;
  presentation?: string;
}

export interface WebElement {
  index?: number;
  tagName?: string;
  label?: string;
  text: string;
  value?: string;
  href?: string;
  visible?: boolean;
  disabled?: boolean;
  attributes?: Readonly<Record<string, string>>;
}

export interface WebBrowserService {
  capabilities(): Promise<WebCapabilities> | WebCapabilities;
  open(request: { url: string; presentation?: string; persist?: boolean; signal?: AbortSignal }): Promise<{ session: WebSession; disposable: boolean }>;
  get(sessionId: string, signal?: AbortSignal): Promise<WebSession>;
  close(sessionId: string): Promise<void>;
  list(): Promise<readonly WebSession[]>;
  search(request: { sessionId: string; pattern: string; regex?: boolean; caseSensitive?: boolean; maxResults?: number }): Promise<readonly { text: string; context?: string; index?: number }[]>;
  query(request: { sessionId: string; selector: string; maxResults?: number }): Promise<readonly WebElement[]>;
  action(request: { sessionId: string; selector: string; action: string; value?: string; index?: number }): Promise<JsonValue>;
  wait(request: { sessionId: string; kind: "render" | "selector"; selector?: string; state?: "present" | "absent"; timeoutMs?: number }): Promise<JsonValue>;
}

export interface HtmlContentProcessor {
  extract(request: {
    html: string;
    text: string;
    selector?: string;
    mode: "text" | "html" | "clean_html";
    maxChars: number;
  }): Promise<{ content: string; matchCount?: number }> | { content: string; matchCount?: number };
}

export const WEB_BROWSER_SERVICE = createServiceToken<WebBrowserService>("webBrowser", {
  description: "Provider-neutral web session service",
});

export const HTML_CONTENT_PROCESSOR = createServiceToken<HtmlContentProcessor>("htmlContentProcessor", {
  description: "Runtime-specific HTML content extraction",
  optional: true,
});
