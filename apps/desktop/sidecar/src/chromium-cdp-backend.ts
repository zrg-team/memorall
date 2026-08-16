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
	type BrowserSnapshot,
	type EngineStatus,
	withTimeoutSignal,
} from "./browser-runtime-types";
import { ManagedBrowserOsRuntime } from "./managed-browseros-runtime";

type CdpMessage = {
	id?: number;
	method?: string;
	params?: Record<string, unknown>;
	result?: Record<string, unknown>;
	error?: { code?: number; message?: string };
};

class CdpConnection {
	private nextId = 0;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: Record<string, unknown>) => void;
			reject: (error: unknown) => void;
			timer: ReturnType<typeof setTimeout>;
			abort?: () => void;
			signal?: AbortSignal;
		}
	>();
	private readonly listeners = new Map<
		string,
		Set<(params: Record<string, unknown>) => void>
	>();
	private closed = false;

	private constructor(private readonly socket: WebSocket) {
		socket.addEventListener("message", (event) =>
			this.onMessage(String(event.data)),
		);
		socket.addEventListener("close", () =>
			this.failAll("CDP connection closed."),
		);
		socket.addEventListener("error", () =>
			this.failAll("CDP connection failed."),
		);
	}

	static async connect(
		url: string,
		signal?: AbortSignal,
	): Promise<CdpConnection> {
		return await new Promise<CdpConnection>((resolve, reject) => {
			const socket = new WebSocket(url);
			const timeout = setTimeout(() => {
				socket.close();
				reject(
					new BrowserAutomationError(
						"CDP_CONNECT_TIMEOUT",
						"CDP connection timed out.",
					),
				);
			}, 10_000);
			const abort = () => {
				clearTimeout(timeout);
				socket.close();
				reject(new BrowserAutomationError("CANCELLED", "Operation cancelled."));
			};
			signal?.addEventListener("abort", abort, { once: true });
			socket.addEventListener(
				"open",
				() => {
					clearTimeout(timeout);
					signal?.removeEventListener("abort", abort);
					resolve(new CdpConnection(socket));
				},
				{ once: true },
			);
			socket.addEventListener(
				"error",
				() => {
					clearTimeout(timeout);
					signal?.removeEventListener("abort", abort);
					reject(
						new BrowserAutomationError(
							"CDP_CONNECT_FAILED",
							"CDP connection failed.",
						),
					);
				},
				{ once: true },
			);
		});
	}

	async send<T extends Record<string, unknown> = Record<string, unknown>>(
		method: string,
		params: Record<string, unknown> = {},
		signal?: AbortSignal,
		timeoutMs = 30_000,
	): Promise<T> {
		if (this.closed) {
			throw new BrowserAutomationError(
				"CDP_CONNECTION_CLOSED",
				"CDP connection is closed.",
			);
		}
		if (signal?.aborted) {
			throw new BrowserAutomationError("CANCELLED", "Operation cancelled.");
		}
		const id = ++this.nextId;
		return await new Promise<T>((resolve, reject) => {
			let abort: (() => void) | undefined;
			const timer = setTimeout(
				() => {
					this.pending.delete(id);
					if (abort) signal?.removeEventListener("abort", abort);
					reject(
						new BrowserAutomationError(
							"CDP_COMMAND_TIMEOUT",
							`${method} timed out.`,
						),
					);
				},
				Math.max(1, timeoutMs),
			);
			abort = signal
				? () => {
						clearTimeout(timer);
						this.pending.delete(id);
						reject(
							new BrowserAutomationError("CANCELLED", "Operation cancelled."),
						);
					}
				: undefined;
			signal?.addEventListener("abort", abort!, { once: true });
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timer,
				abort,
				signal,
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	on(
		method: string,
		listener: (params: Record<string, unknown>) => void,
	): () => void {
		const listeners = this.listeners.get(method) ?? new Set();
		listeners.add(listener);
		this.listeners.set(method, listeners);
		return () => listeners.delete(listener);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.socket.close();
		this.failAll("CDP connection closed.");
	}

	private onMessage(raw: string): void {
		let message: CdpMessage;
		try {
			message = JSON.parse(raw) as CdpMessage;
		} catch {
			return;
		}
		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (pending.abort)
				pending.signal?.removeEventListener("abort", pending.abort);
			if (message.error) {
				pending.reject(
					new BrowserAutomationError(
						"CDP_COMMAND_FAILED",
						message.error.message ?? "CDP command failed.",
					),
				);
			} else pending.resolve(message.result ?? {});
			return;
		}
		if (message.method) {
			for (const listener of this.listeners.get(message.method) ?? []) {
				listener(message.params ?? {});
			}
		}
	}

	private failAll(message: string): void {
		if (this.closed && this.pending.size === 0) return;
		this.closed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			if (pending.abort)
				pending.signal?.removeEventListener("abort", pending.abort);
			pending.reject(
				new BrowserAutomationError("CDP_CONNECTION_CLOSED", message),
			);
		}
		this.pending.clear();
	}
}

interface CdpTarget {
	id: string;
	type?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
}

const snapshotCode = (maxHtmlChars: number): string => `(() => {
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

export class ChromiumCdpBackend implements BrowserBackend {
	readonly engine = "chromium" as const;
	private readonly pages = new Map<string, CdpConnection>();
	private browserHardenedFor: string | null = null;

	constructor(private readonly runtime: ManagedBrowserOsRuntime) {}

	async status(signal?: AbortSignal): Promise<EngineStatus> {
		try {
			const endpoint = await this.endpoint();
			const response = await fetch(`${endpoint}/json/version`, { signal });
			if (!response.ok)
				throw new Error(`CDP returned HTTP ${response.status}.`);
			const version = (await response.json()) as { Browser?: string };
			await this.hardenBrowser(endpoint, signal);
			return {
				engine: this.engine,
				readiness: "ready",
				version:
					version.Browser ??
					process.env.MEMORALL_BROWSER_RENDERER_VERSION ??
					null,
			};
		} catch (error) {
			return {
				engine: this.engine,
				readiness: "unavailable",
				version: process.env.MEMORALL_BROWSER_RENDERER_VERSION ?? null,
				failure: {
					code:
						error instanceof BrowserAutomationError
							? error.code
							: "CHROMIUM_CDP_UNAVAILABLE",
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
		const endpoint = await this.endpoint();
		await this.hardenBrowser(endpoint, signal);
		const response = await fetch(
			`${endpoint}/json/new?${encodeURIComponent("about:blank")}`,
			{
				method: "PUT",
				signal,
			},
		);
		if (!response.ok) {
			throw new BrowserAutomationError(
				"CDP_TARGET_CREATE_FAILED",
				`Managed Chromium could not create a page (HTTP ${response.status}).`,
			);
		}
		const target = (await response.json()) as CdpTarget;
		if (!target.id || !target.webSocketDebuggerUrl) {
			throw new BrowserAutomationError(
				"CDP_INVALID_RESPONSE",
				"Managed Chromium returned no page target.",
			);
		}
		const page = await CdpConnection.connect(
			target.webSocketDebuggerUrl,
			signal,
		);
		this.pages.set(target.id, page);
		const session: BackendSession = {
			engine: this.engine,
			handle: target.id,
			url,
		};
		const timed = withTimeoutSignal(timeoutMs, signal);
		try {
			await page.send("Page.enable", {}, timed.signal);
			await page.send("Runtime.enable", {}, timed.signal);
			const navigation = await page.send<{ errorText?: string }>(
				"Page.navigate",
				{ url },
				timed.signal,
			);
			if (navigation.errorText) throw new Error(navigation.errorText);
			await this.waitForDocument(page, timed.signal);
			const snapshot = await this.snapshot(session, maxHtmlChars, timed.signal);
			session.url = snapshot.url;
			return { session, snapshot };
		} catch (error) {
			if (timed.signal.aborted) {
				throw new BackendOpenError(
					"NAVIGATION_TIMEOUT",
					"Timed out waiting for managed Chromium to load the page.",
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
			snapshotCode(maxHtmlChars),
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
  const element = node; const inputType = (element.type || 'text').toLowerCase(); const style = getComputedStyle(element);
  return { index, tagName: element.tagName.toLowerCase(), id: element.getAttribute('id'), name: element.getAttribute('name'), type: element.getAttribute('type'), placeholder: element.getAttribute('placeholder'), ariaLabel: element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'), title: element.getAttribute('title'), role: element.getAttribute('role'), text: (element.textContent || '').trim(), value: 'value' in element ? String(element.value || '') : null, href: element.getAttribute('href'), disabled: Boolean(element.disabled), visible: !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' && Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length), acceptsTextInput: element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(inputType)) };
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
		const result = await this.evaluate<Record<string, unknown>>(
			session,
			`(() => {
  const element = Array.from(document.querySelectorAll(${selector}))[${index}];
  if (!element) return { __memorallError: 'ELEMENT_NOT_FOUND' };
  const record = { label: element.tagName.toLowerCase(), text: element.textContent || '', value: 'value' in element ? String(element.value || '') : null };
  const action = ${JSON.stringify(action)};
  if (action === 'click') element.click();
  else if (action === 'input') { const inputType = (element.type || 'text').toLowerCase(); if (!(element instanceof HTMLTextAreaElement) && !(element instanceof HTMLInputElement && ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(inputType))) return { __memorallError: 'INVALID_INPUT_TARGET' }; const next = ${value}; element.focus(); element.value = next; element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next })); element.dispatchEvent(new Event('change', { bubbles: true })); record.text = next; record.value = next; }
  else if (action === 'focus') element.focus();
  else if (action === 'scrollBottom') window.scrollTo(0, document.body?.scrollHeight || 0);
  else if (action === 'scrollTop') window.scrollTo(0, 0);
  return record;
})()`,
			signal,
		);
		if (result.__memorallError) {
			const code = String(result.__memorallError);
			throw new BrowserAutomationError(
				code,
				code === "ELEMENT_NOT_FOUND"
					? `No element at index ${index} for selector: ${String(request.selector)}`
					: "Target element does not support text input.",
			);
		}
		if (action === "click") {
			await new Promise((resolve) => setTimeout(resolve, 100));
			await this.waitForDocument(this.page(session), signal).catch(() => {});
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
		const expected = request.state !== "absent";
		const timeoutMs = Math.max(0, requiredNumber(request, "timeoutMs"));
		const intervalMs = Math.max(25, requiredNumber(request, "intervalMs"));
		const matched = await this.evaluate<boolean>(
			session,
			`(async () => { const selector = ${selector}; const expected = ${String(expected)}; const matches = () => Boolean(document.querySelector(selector)) === expected; if (matches()) return true; return await new Promise((resolve) => { const deadline = Date.now() + ${timeoutMs}; const timer = setInterval(() => { if (matches()) { clearInterval(timer); resolve(true); } else if (Date.now() >= deadline) { clearInterval(timer); resolve(false); } }, ${intervalMs}); }); })()`,
			signal,
			timeoutMs + 1_000,
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
		const result = await this.page(session).send<{ data?: string }>(
			"Page.captureScreenshot",
			{ format: "png", fromSurface: true, captureBeyondViewport: false },
			signal,
		);
		if (!result.data)
			throw new BrowserAutomationError(
				"CDP_SCREENSHOT_FAILED",
				"No image returned.",
			);
		const bytes = Buffer.from(result.data, "base64");
		return {
			dataUrl: `data:image/png;base64,${result.data}`,
			...pngDimensions(bytes),
		};
	}

	async fetchImage(
		session: BackendSession,
		rawUrl: string,
		signal?: AbortSignal,
	): Promise<{ base64: string; mimeType: string }> {
		const url = JSON.stringify(checkedHttpUrl(rawUrl));
		return await this.evaluate<{ base64: string; mimeType: string }>(
			session,
			`(async () => { const response = await fetch(${url}); if (!response.ok) throw new Error('Failed to fetch image: HTTP ' + response.status); const bytes = new Uint8Array(await response.arrayBuffer()); let binary = ''; for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192)); return { base64: btoa(binary), mimeType: (response.headers.get('content-type') || 'image/png').split(';')[0].trim() }; })()`,
			signal,
		);
	}

	async show(session: BackendSession, signal?: AbortSignal): Promise<boolean> {
		await this.page(session).send("Page.bringToFront", {}, signal);
		return true;
	}

	async close(session: BackendSession): Promise<void> {
		const id = String(session.handle);
		this.pages.get(id)?.close();
		this.pages.delete(id);
		const endpoint = this.runtime.getCdpEndpoint();
		if (endpoint)
			await fetch(`${endpoint}/json/close/${encodeURIComponent(id)}`).catch(
				() => {},
			);
	}

	async stop(): Promise<void> {
		for (const page of this.pages.values()) page.close();
		this.pages.clear();
		this.browserHardenedFor = null;
	}

	private page(session: BackendSession): CdpConnection {
		const page = this.pages.get(String(session.handle));
		if (!page)
			throw new BrowserAutomationError(
				"SESSION_NOT_FOUND",
				"Chromium session no longer exists.",
			);
		return page;
	}

	private async evaluate<T>(
		session: BackendSession,
		expression: string,
		signal?: AbortSignal,
		timeoutMs = 30_000,
	): Promise<T> {
		const response = await this.page(session).send<{
			result?: { value?: unknown; description?: string };
			exceptionDetails?: {
				text?: string;
				exception?: { description?: string };
			};
		}>(
			"Runtime.evaluate",
			{
				expression,
				awaitPromise: true,
				returnByValue: true,
				userGesture: true,
			},
			signal,
			timeoutMs,
		);
		if (response.exceptionDetails) {
			throw new BrowserAutomationError(
				"CDP_EVALUATION_FAILED",
				response.exceptionDetails.exception?.description ??
					response.exceptionDetails.text ??
					"Page evaluation failed.",
			);
		}
		return response.result?.value as T;
	}

	private async waitForDocument(
		page: CdpConnection,
		signal?: AbortSignal,
	): Promise<void> {
		while (true) {
			const response = await page.send<{ result?: { value?: unknown } }>(
				"Runtime.evaluate",
				{ expression: "document.readyState", returnByValue: true },
				signal,
				5_000,
			);
			if (
				response.result?.value === "interactive" ||
				response.result?.value === "complete"
			)
				return;
			await new Promise((resolve) => setTimeout(resolve, 50));
			if (signal?.aborted)
				throw new BrowserAutomationError("CANCELLED", "Operation cancelled.");
		}
	}

	private async endpoint(): Promise<string> {
		const connection = await this.runtime.ensure();
		if (!connection.cdpEndpoint) {
			throw new BrowserAutomationError(
				"CDP_ENDPOINT_MISSING",
				"Managed Chromium exposed no CDP endpoint.",
			);
		}
		return connection.cdpEndpoint;
	}

	private async hardenBrowser(
		endpoint: string,
		signal?: AbortSignal,
	): Promise<void> {
		if (this.browserHardenedFor === endpoint) return;
		const response = await fetch(`${endpoint}/json/version`, { signal });
		if (!response.ok)
			throw new Error(`CDP version endpoint returned HTTP ${response.status}.`);
		const version = (await response.json()) as {
			webSocketDebuggerUrl?: string;
		};
		if (!version.webSocketDebuggerUrl)
			throw new Error("CDP browser socket is missing.");
		const browser = await CdpConnection.connect(
			version.webSocketDebuggerUrl,
			signal,
		);
		try {
			await browser.send(
				"Browser.setDownloadBehavior",
				{ behavior: "deny" },
				signal,
			);
			for (const name of [
				"geolocation",
				"notifications",
				"audioCapture",
				"videoCapture",
			]) {
				await browser
					.send(
						"Browser.setPermission",
						{ permission: { name }, setting: "denied" },
						signal,
					)
					.catch(() => ({}));
			}
			this.browserHardenedFor = endpoint;
		} finally {
			browser.close();
		}
	}
}
