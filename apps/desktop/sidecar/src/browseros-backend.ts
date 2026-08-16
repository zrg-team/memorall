import type { BackendSession, BrowserBackend } from "./browser-backend";
import { BackendOpenError } from "./browser-backend";
import {
	BrowserAutomationError,
	checkedHttpUrl,
	pngDimensions,
	requiredNumber,
	requiredString,
	type BrowserCommand,
	type BrowserMode,
	type BrowserSettings,
	type BrowserSnapshot,
	type EngineStatus,
	withTimeoutSignal,
} from "./browser-runtime-types";
import {
	StreamableHttpMcpClient,
	mcpImage,
	type McpToolResult,
} from "./mcp-client";
import { ManagedBrowserOsRuntime } from "./managed-browseros-runtime";

const browserSnapshotCode = (maxHtmlChars: number): string => `(() => {
  const clone = document.cloneNode(true);
  clone.querySelectorAll('script, style, noscript, link, template').forEach((node) => node.remove());
  return {
    url: location.href,
    title: document.title || '',
    html: (document.documentElement?.outerHTML || document.body?.innerHTML || '').slice(0, ${Math.max(0, maxHtmlChars)}),
    text: (clone.body?.innerText || clone.documentElement?.textContent || '').trim(),
    domAccessible: true
  };
})()`;

const evaluateValue = <T>(result: McpToolResult): T => {
	const value = result.structuredContent?.value;
	if (value !== undefined) return value as T;
	const rawText =
		result.content?.find((block) => block.type === "text")?.text ?? "";
	const wrapped =
		/^\[UNTRUSTED_PAGE_CONTENT[^\]]*\][^\n]*\n([\s\S]*)\n\[END_UNTRUSTED_PAGE_CONTENT[^\]]*\]$/u.exec(
			rawText.trim(),
		);
	const text = wrapped?.[1] ?? rawText;
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new BrowserAutomationError(
			"BROWSEROS_INVALID_RESPONSE",
			"BrowserOS evaluate returned no structured value.",
		);
	}
};

const pageOf = (result: McpToolResult): string | number => {
	const page = result.structuredContent?.page;
	if (typeof page === "string" || typeof page === "number") return page;
	const text =
		result.content?.find((block) => block.type === "text")?.text ?? "";
	const match = /(?:opened|active|closed)?\s*page\s+(\d+)/i.exec(text);
	if (match?.[1]) return Number.parseInt(match[1], 10);
	throw new BrowserAutomationError(
		"BROWSEROS_INVALID_RESPONSE",
		"BrowserOS did not return a page handle.",
	);
};

export class BrowserOsBackend implements BrowserBackend {
	readonly engine = "browseros" as const;
	private client: StreamableHttpMcpClient | null = null;
	private tools: Set<string> | null = null;
	private clientKey: string | null = null;
	constructor(
		private readonly runtime: ManagedBrowserOsRuntime,
		private readonly settings: () => BrowserSettings,
	) {}

	async status(signal?: AbortSignal): Promise<EngineStatus> {
		try {
			const client = await this.ensureClient(signal);
			// Listing tabs exercises the BrowserOS-only CDP extension. A stock Chromium
			// binary can expose the MCP tools but cannot execute them.
			let lastError: unknown;
			for (let attempt = 0; attempt < 8; attempt += 1) {
				try {
					await client.callTool("tabs", { action: "list" }, signal);
					lastError = undefined;
					break;
				} catch (error) {
					lastError = error;
					if (
						!/not running|not connected|not paired/i.test(
							error instanceof Error ? error.message : String(error),
						)
					) {
						throw error;
					}
					await new Promise((resolve) => setTimeout(resolve, 250));
				}
			}
			if (lastError) throw lastError;
			return {
				engine: this.engine,
				readiness: "ready",
				version: process.env.MEMORALL_BROWSEROS_VERSION ?? null,
			};
		} catch (error) {
			return {
				engine: this.engine,
				readiness: "unavailable",
				version: process.env.MEMORALL_BROWSEROS_VERSION ?? null,
				failure: {
					code: "BROWSEROS_UNAVAILABLE",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	async open(
		rawUrl: string,
		_mode: BrowserMode,
		timeoutMs: number,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<{ session: BackendSession; snapshot: BrowserSnapshot }> {
		const url = checkedHttpUrl(rawUrl);
		const client = await this.ensureClient(signal);
		const created = await client.callTool(
			"tabs",
			{ action: "new", background: !this.settings().visible },
			signal,
		);
		const handle = pageOf(created);
		const session: BackendSession = { engine: this.engine, handle, url };
		const timed = withTimeoutSignal(timeoutMs, signal);
		try {
			await client.callTool(
				"navigate",
				{ page: handle, action: "url", url },
				timed.signal,
			);
			return {
				session,
				snapshot: await this.snapshot(session, maxHtmlChars, timed.signal),
			};
		} catch (error) {
			if (timed.signal.aborted) {
				throw new BackendOpenError(
					"NAVIGATION_TIMEOUT",
					"Timed out waiting for the BrowserOS page to load.",
					session,
				);
			}
			await this.close(session).catch(() => {});
			throw error;
		} finally {
			timed.dispose();
		}
	}

	async snapshot(
		session: BackendSession,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<BrowserSnapshot> {
		const snapshot = await this.evaluate<BrowserSnapshot>(
			session,
			browserSnapshotCode(maxHtmlChars),
			signal,
		);
		session.url = snapshot.url;
		return snapshot;
	}

	async query(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; elements: unknown[] }> {
		const selector = JSON.stringify(requiredString(request, "selector"));
		const maxResults = Math.max(0, requiredNumber(request, "maxResults"));
		const elements = await this.evaluate<unknown[]>(
			session,
			`(() => Array.from(document.querySelectorAll(${selector})).slice(0, ${maxResults}).map((node, index) => {
  const element = node;
  const inputType = (element.type || 'text').toLowerCase();
  const style = getComputedStyle(element);
  return {
    index,
    tagName: element.tagName.toLowerCase(),
    id: element.getAttribute('id'), name: element.getAttribute('name'),
    type: element.getAttribute('type'), placeholder: element.getAttribute('placeholder'),
    ariaLabel: element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'),
    title: element.getAttribute('title'), role: element.getAttribute('role'),
    text: (element.textContent || '').trim(),
    value: 'value' in element ? String(element.value || '') : null,
    href: element.getAttribute('href'), disabled: Boolean(element.disabled),
    visible: !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length),
    acceptsTextInput: element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(inputType))
  };
}))()`,
			signal,
		);
		return {
			elements,
			snapshot: await this.snapshot(
				session,
				requiredNumber(request, "maxHtmlChars"),
				signal,
			),
		};
	}

	async action(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; result: unknown }> {
		const selector = JSON.stringify(requiredString(request, "selector"));
		const index =
			typeof request.index === "number" ? Math.max(0, request.index) : 0;
		const action = requiredString(request, "action");
		const value = JSON.stringify(
			typeof request.value === "string" ? request.value : "",
		);
		const result = await this.evaluate<unknown>(
			session,
			`(() => {
  const element = Array.from(document.querySelectorAll(${selector}))[${index}];
  if (!element) return { __memorallError: 'ELEMENT_NOT_FOUND' };
  const record = { label: element.tagName.toLowerCase(), text: element.textContent || '', value: 'value' in element ? String(element.value || '') : null };
  const action = ${JSON.stringify(action)};
  if (action === 'click') element.click();
  else if (action === 'input') {
    const inputType = (element.type || 'text').toLowerCase();
    if (!(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(inputType))) return { __memorallError: 'INVALID_INPUT_TARGET' };
    const next = ${value}; element.focus(); element.value = next;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
    element.dispatchEvent(new Event('change', { bubbles: true })); record.text = next; record.value = next;
  } else if (action === 'focus') element.focus();
  else if (action === 'scrollBottom') window.scrollTo(0, document.body?.scrollHeight || 0);
  else if (action === 'scrollTop') window.scrollTo(0, 0);
  return record;
})()`,
			signal,
		);
		if (
			typeof result === "object" &&
			result !== null &&
			"__memorallError" in result
		) {
			const code = String(
				(result as { __memorallError: unknown }).__memorallError,
			);
			throw new BrowserAutomationError(
				code,
				code === "ELEMENT_NOT_FOUND"
					? `No element at index ${index} for selector: ${String(request.selector)}`
					: "Target element does not support text input.",
			);
		}
		return {
			result,
			snapshot: await this.snapshot(
				session,
				requiredNumber(request, "maxHtmlChars"),
				signal,
			),
		};
	}

	async waitSelector(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; matched: boolean }> {
		const selector = JSON.stringify(requiredString(request, "selector"));
		const present = request.state !== "absent";
		const timeoutMs = Math.max(0, requiredNumber(request, "timeoutMs"));
		const intervalMs = Math.max(25, requiredNumber(request, "intervalMs"));
		const matched = await this.evaluate<boolean>(
			session,
			`(async () => {
  const selector = ${selector};
  const expected = ${String(present)};
  const matches = () => Boolean(document.querySelector(selector)) === expected;
  if (matches()) return true;
  return await new Promise((resolve) => {
    const deadline = Date.now() + ${timeoutMs};
    const timer = setInterval(() => {
      if (matches()) { clearInterval(timer); resolve(true); }
      else if (Date.now() >= deadline) { clearInterval(timer); resolve(false); }
    }, ${intervalMs});
  });
})()`,
			signal,
		);
		return {
			matched,
			snapshot: await this.snapshot(
				session,
				requiredNumber(request, "maxHtmlChars"),
				signal,
			),
		};
	}

	async screenshot(
		session: BackendSession,
		signal?: AbortSignal,
	): Promise<{ dataUrl: string; width: number; height: number }> {
		const cdpEndpoint = this.runtime.getCdpEndpoint();
		if (cdpEndpoint) {
			const bytes = await this.captureCdpScreenshot(
				cdpEndpoint,
				session.url,
				signal,
			);
			return {
				dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
				...pngDimensions(bytes),
			};
		}
		const client = await this.ensureClient(signal);
		const result = await client.callTool(
			"screenshot",
			{ page: session.handle, format: "png" },
			signal,
		);
		const image = mcpImage(result);
		if (!image)
			throw new BrowserAutomationError(
				"BROWSEROS_INVALID_RESPONSE",
				"Screenshot contained no image.",
			);
		const bytes = Buffer.from(image.data, "base64");
		return {
			dataUrl: `data:${image.mimeType};base64,${image.data}`,
			...pngDimensions(bytes),
		};
	}

	private async captureCdpScreenshot(
		cdpEndpoint: string,
		pageUrl: string,
		signal?: AbortSignal,
	): Promise<Buffer> {
		const response = await fetch(`${cdpEndpoint}/json/list`, { signal });
		if (!response.ok) {
			throw new BrowserAutomationError(
				"CDP_SCREENSHOT_FAILED",
				`Browser CDP target list returned HTTP ${response.status}.`,
			);
		}
		const targets = (await response.json()) as Array<{
			type?: string;
			url?: string;
			webSocketDebuggerUrl?: string;
		}>;
		const target =
			targets.find(
				(candidate) =>
					candidate.type === "page" &&
					candidate.url === pageUrl &&
					candidate.webSocketDebuggerUrl,
			) ??
			targets.find(
				(candidate) =>
					candidate.type === "page" && candidate.webSocketDebuggerUrl,
			);
		if (!target?.webSocketDebuggerUrl) {
			throw new BrowserAutomationError(
				"CDP_SCREENSHOT_FAILED",
				"Browser page target was not found.",
			);
		}
		return await new Promise<Buffer>((resolve, reject) => {
			const socket = new WebSocket(target.webSocketDebuggerUrl as string);
			const timeout = setTimeout(() => {
				socket.close();
				reject(
					new BrowserAutomationError(
						"CDP_SCREENSHOT_TIMEOUT",
						"Browser screenshot timed out.",
					),
				);
			}, 15_000);
			const abort = () => {
				clearTimeout(timeout);
				socket.close();
				reject(new BrowserAutomationError("CANCELLED", "Operation cancelled."));
			};
			const finish = (error?: unknown, data?: string) => {
				clearTimeout(timeout);
				signal?.removeEventListener("abort", abort);
				socket.close();
				if (error || !data) {
					reject(
						error instanceof Error
							? error
							: new BrowserAutomationError(
									"CDP_SCREENSHOT_FAILED",
									String(error ?? "No image returned."),
								),
					);
				} else resolve(Buffer.from(data, "base64"));
			};
			signal?.addEventListener("abort", abort, { once: true });
			socket.addEventListener("open", () => {
				socket.send(
					JSON.stringify({
						id: 1,
						method: "Page.captureScreenshot",
						params: { format: "png", fromSurface: true },
					}),
				);
			});
			socket.addEventListener("message", (event) => {
				try {
					const message = JSON.parse(String(event.data)) as {
						id?: number;
						result?: { data?: string };
						error?: { message?: string };
					};
					if (message.id !== 1) return;
					finish(message.error?.message, message.result?.data);
				} catch (error) {
					finish(error);
				}
			});
			socket.addEventListener("error", () =>
				finish(
					new BrowserAutomationError(
						"CDP_SCREENSHOT_FAILED",
						"Browser CDP socket failed.",
					),
				),
			);
		});
	}

	async fetchImage(
		session: BackendSession,
		rawUrl: string,
		signal?: AbortSignal,
	): Promise<{ base64: string; mimeType: string }> {
		const url = JSON.stringify(checkedHttpUrl(rawUrl));
		return await this.evaluate<{ base64: string; mimeType: string }>(
			session,
			`(async () => {
  const response = await fetch(${url});
  if (!response.ok) throw new Error('Failed to fetch image: HTTP ' + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer()); let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return { base64: btoa(binary), mimeType: (response.headers.get('content-type') || 'image/png').split(';')[0].trim() };
})()`,
			signal,
		);
	}

	async close(session: BackendSession): Promise<void> {
		const client = await this.ensureClient();
		await client.callTool("tabs", { action: "close", page: session.handle });
	}

	async stop(): Promise<void> {
		const client = this.client;
		this.client = null;
		this.tools = null;
		this.clientKey = null;
		await client?.close().catch(() => {});
	}

	async show(session: BackendSession, signal?: AbortSignal): Promise<boolean> {
		const client = await this.ensureClient(signal);
		const cdpEndpoint = this.runtime.getCdpEndpoint();
		if (cdpEndpoint) {
			const response = await fetch(`${cdpEndpoint}/json/list`, { signal });
			if (response.ok) {
				const targets = (await response.json()) as Array<{
					id?: string;
					type?: string;
					url?: string;
				}>;
				const target =
					targets.find(
						(candidate) =>
							candidate.type === "page" && candidate.url === session.url,
					) ?? targets.find((candidate) => candidate.type === "page");
				if (target?.id) {
					const activated = await fetch(
						`${cdpEndpoint}/json/activate/${encodeURIComponent(target.id)}`,
						{ signal },
					);
					if (activated.ok) return true;
				}
			}
		}
		if (this.tools?.has("show_page")) {
			await client.callTool("show_page", { page: session.handle }, signal);
			return true;
		}
		return false;
	}

	private async evaluate<T>(
		session: BackendSession,
		code: string,
		signal?: AbortSignal,
	): Promise<T> {
		const client = await this.ensureClient(signal);
		return evaluateValue<T>(
			await client.callTool(
				"evaluate",
				{
					page: session.handle,
					code: `return await (${code});`,
					timeout: 30_000,
				},
				signal,
			),
		);
	}

	private async ensureClient(
		signal?: AbortSignal,
	): Promise<StreamableHttpMcpClient> {
		if (process.env.MEMORALL_BROWSEROS_DISABLED === "1") {
			throw new BrowserAutomationError(
				"BROWSEROS_DISABLED",
				"BrowserOS MCP is disabled for fallback verification.",
			);
		}
		const connection = await this.runtime.ensure();
		const key = `${connection.endpoint}\n${connection.token ?? ""}`;
		if (this.client && this.tools && this.clientKey === key) return this.client;
		if (this.client) await this.client.close().catch(() => {});
		const client = new StreamableHttpMcpClient(
			connection.endpoint,
			connection.token,
		);
		try {
			const tools = await client.listTools(signal);
			for (const required of [
				"tabs",
				"navigate",
				"evaluate",
				"wait",
				"screenshot",
			]) {
				if (!tools.has(required)) {
					throw new BrowserAutomationError(
						"BROWSEROS_PROTOCOL_MISMATCH",
						`BrowserOS MCP is missing required tool: ${required}`,
					);
				}
			}
			this.client = client;
			this.tools = tools;
			this.clientKey = key;
			return client;
		} catch (error) {
			await client.close().catch(() => {});
			throw error;
		}
	}
}
