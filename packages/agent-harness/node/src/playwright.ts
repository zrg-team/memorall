import type { Browser, Page } from "playwright-core";
import type { JsonValue } from "@memorall/agent-harness-core";
import type { WebBrowserService, WebElement, WebSession } from "@memorall/agent-harness-standard/web";

export const PLAYWRIGHT_ADAPTER_ID = "node.playwright";

export class PlaywrightWebBrowserService implements WebBrowserService {
  readonly #pages = new Map<string, Page>();
  #sequence = 0;
  constructor(private readonly browser: Browser) {}
  capabilities() { return { supported: ["session.open", "session.multiple", "content.read", "content.search", "dom.query", "dom.action", "wait.render", "wait.selector"] }; }
  async #session(id: string, requestedUrl?: string): Promise<WebSession> {
    const page = this.#pages.get(id);
    if (!page) throw new Error(`Unknown web session: ${id}`);
    return { id, requestedUrl: requestedUrl ?? page.url(), currentUrl: page.url(), title: await page.title(), html: await page.content(), text: await page.locator("body").innerText(), domAccessible: true };
  }
  async open(request: { url: string; signal?: AbortSignal }): Promise<{ session: WebSession; disposable: boolean }> {
    const page = await this.browser.newPage();
    const id = `playwright:${++this.#sequence}`;
    this.#pages.set(id, page);
    try { await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 30_000 }); }
    catch (error) { await page.close(); this.#pages.delete(id); throw error; }
    return { session: await this.#session(id, request.url), disposable: true };
  }
  get(sessionId: string): Promise<WebSession> { return this.#session(sessionId); }
  async close(sessionId: string): Promise<void> { await this.#pages.get(sessionId)?.close(); this.#pages.delete(sessionId); }
  async list(): Promise<readonly WebSession[]> { return Promise.all([...this.#pages.keys()].map((id) => this.#session(id))); }
  async search(request: { sessionId: string; pattern: string; regex?: boolean; caseSensitive?: boolean; maxResults?: number }) {
    const text = (await this.#session(request.sessionId)).text;
    const expression = request.regex ? new RegExp(request.pattern, request.caseSensitive ? "g" : "gi") : new RegExp(request.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), request.caseSensitive ? "g" : "gi");
    return [...text.matchAll(expression)].slice(0, request.maxResults ?? 50).map((match) => ({ text: match[0], index: match.index }));
  }
  async query(request: { sessionId: string; selector: string; maxResults?: number }): Promise<readonly WebElement[]> {
    const page = this.#pages.get(request.sessionId);
    if (!page) throw new Error(`Unknown web session: ${request.sessionId}`);
    return page.locator(request.selector).evaluateAll((elements, max) => elements.slice(0, max).map((element, index) => ({ index, tagName: element.tagName.toLowerCase(), text: element.textContent ?? "", visible: Boolean((element as HTMLElement).offsetParent), disabled: (element as HTMLButtonElement).disabled, value: (element as HTMLInputElement).value, href: (element as HTMLAnchorElement).href })), request.maxResults ?? 50);
  }
  async action(request: { sessionId: string; selector: string; action: string; value?: string; index?: number }): Promise<JsonValue> {
    const page = this.#pages.get(request.sessionId);
    if (!page) throw new Error(`Unknown web session: ${request.sessionId}`);
    const locator = page.locator(request.selector).nth(request.index ?? 0);
    if (request.action === "click") await locator.click();
    else if (request.action === "fill") await locator.fill(request.value ?? "");
    else if (request.action === "press") await locator.press(request.value ?? "Enter");
    else throw new Error(`Unsupported Playwright action: ${request.action}`);
    return { performed: request.action };
  }
  async wait(request: { sessionId: string; kind: "render" | "selector"; selector?: string; state?: "present" | "absent"; timeoutMs?: number }): Promise<JsonValue> {
    const page = this.#pages.get(request.sessionId);
    if (!page) throw new Error(`Unknown web session: ${request.sessionId}`);
    if (request.kind === "render") await page.waitForLoadState("domcontentloaded", { timeout: request.timeoutMs });
    else await page.locator(request.selector ?? "body").waitFor({ state: request.state === "absent" ? "detached" : "attached", timeout: request.timeoutMs });
    return { ready: true };
  }
}
