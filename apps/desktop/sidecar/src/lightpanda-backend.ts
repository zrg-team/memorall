import { randomUUID } from "node:crypto";
import type { BackendSession, BrowserBackend } from "./browser-backend";
import { BackendOpenError } from "./browser-backend";
import {
	BrowserAutomationError,
	checkedHttpUrl,
	requiredNumber,
	requiredString,
	type BrowserCommand,
	type BrowserMode,
	type BrowserSnapshot,
	type EngineStatus,
	withTimeoutSignal,
} from "./browser-runtime-types";
import {
	McpClientError,
	StreamableHttpMcpClient,
	type McpToolResult,
} from "./mcp-client";
import { ManagedLightpandaRuntime } from "./managed-lightpanda-runtime";

const evaluatedValue = <T>(result: McpToolResult): T => {
	if (result.structuredContent?.value !== undefined) {
		return result.structuredContent.value as T;
	}
	const text =
		result.content?.find((block) => block.type === "text")?.text ?? "";
	try {
		return JSON.parse(text) as T;
	} catch {
		throw new BrowserAutomationError(
			"LIGHTPANDA_INVALID_RESPONSE",
			"Lightpanda evaluate returned no structured value.",
		);
	}
};

export class LightpandaBackend implements BrowserBackend {
	readonly engine = "lightpanda" as const;
	private readonly clients = new Map<string, StreamableHttpMcpClient>();
	private readonly runtime = new ManagedLightpandaRuntime();

	async status(signal?: AbortSignal): Promise<EngineStatus> {
		let endpoint: string;
		try {
			endpoint = await this.runtime.ensure();
		} catch (error) {
			return {
				engine: this.engine,
				readiness: "unavailable",
				version: process.env.MEMORALL_LIGHTPANDA_VERSION ?? null,
				failure: {
					code:
						error instanceof BrowserAutomationError
							? error.code
							: "LIGHTPANDA_UNAVAILABLE",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
		const client = new StreamableHttpMcpClient(endpoint);
		try {
			const tools = await client.listTools(signal);
			for (const required of ["goto", "evaluate", "waitForSelector"]) {
				if (!tools.has(required)) {
					throw new Error(
						`Lightpanda MCP is missing required tool: ${required}`,
					);
				}
			}
			return {
				engine: this.engine,
				readiness: "ready",
				version: process.env.MEMORALL_LIGHTPANDA_VERSION ?? null,
			};
		} catch (error) {
			return {
				engine: this.engine,
				readiness: "unavailable",
				version: process.env.MEMORALL_LIGHTPANDA_VERSION ?? null,
				failure: {
					code: "LIGHTPANDA_UNAVAILABLE",
					message: error instanceof Error ? error.message : String(error),
				},
			};
		} finally {
			await client.close().catch(() => {});
		}
	}

	async open(
		rawUrl: string,
		_mode: BrowserMode,
		timeoutMs: number,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<{ session: BackendSession; snapshot: BrowserSnapshot }> {
		const endpoint = await this.runtime.ensure();
		const url = checkedHttpUrl(rawUrl);
		const handle = randomUUID();
		const session: BackendSession = { engine: this.engine, handle, url };
		const client = new StreamableHttpMcpClient(endpoint);
		this.clients.set(handle, client);
		const timed = withTimeoutSignal(timeoutMs, signal);
		try {
			await client.initialize(timed.signal);
			await client.callTool(
				"goto",
				{ url, timeout: timeoutMs, waitUntil: "domcontentloaded" },
				timed.signal,
			);
			return {
				session,
				snapshot: await this.snapshot(session, maxHtmlChars, timed.signal),
			};
		} catch (error) {
			if (
				timed.signal.aborted ||
				(error instanceof McpClientError && /timeout/i.test(error.message))
			) {
				throw new BackendOpenError(
					"NAVIGATION_TIMEOUT",
					"Timed out waiting for the Lightpanda page to load.",
					session,
				);
			}
			this.clients.delete(handle);
			await client.close().catch(() => {});
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
		return await this.evaluate<BrowserSnapshot>(
			session,
			`(() => { const clone = document.cloneNode(true); clone.querySelectorAll('script,style,noscript,link,template').forEach(n => n.remove()); return { url: location.href, title: document.title || '', html: (document.documentElement?.outerHTML || '').slice(0, ${Math.max(0, maxHtmlChars)}), text: (clone.body?.innerText || clone.documentElement?.textContent || '').trim(), domAccessible: true }; })()`,
			signal,
		);
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
			`(() => Array.from(document.querySelectorAll(${selector})).slice(0, ${maxResults}).map((element, index) => ({ index, tagName: element.tagName.toLowerCase(), id: element.getAttribute('id'), name: element.getAttribute('name'), type: element.getAttribute('type'), placeholder: element.getAttribute('placeholder'), ariaLabel: element.getAttribute('aria-label') || element.getAttribute('aria-labelledby'), title: element.getAttribute('title'), role: element.getAttribute('role'), text: (element.textContent || '').trim(), value: 'value' in element ? String(element.value || '') : null, href: element.getAttribute('href'), disabled: Boolean(element.disabled), visible: !element.hidden, acceptsTextInput: element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement })))()`,
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

	async waitSelector(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; matched: boolean }> {
		const client = this.client(session);
		let matched = true;
		try {
			if (request.state === "absent") {
				await client.callTool(
					"waitForScript",
					{
						script: `!document.querySelector(${JSON.stringify(requiredString(request, "selector"))})`,
						timeout: requiredNumber(request, "timeoutMs"),
					},
					signal,
				);
			} else {
				await client.callTool(
					"waitForSelector",
					{
						selector: requiredString(request, "selector"),
						timeout: requiredNumber(request, "timeoutMs"),
					},
					signal,
				);
			}
		} catch (error) {
			if (
				/timeout/i.test(error instanceof Error ? error.message : String(error))
			)
				matched = false;
			else throw error;
		}
		return {
			matched,
			snapshot: await this.snapshot(
				session,
				requiredNumber(request, "maxHtmlChars"),
				signal,
			),
		};
	}

	async close(session: BackendSession): Promise<void> {
		const handle = String(session.handle);
		const client = this.clients.get(handle);
		this.clients.delete(handle);
		await client?.close().catch(() => {});
	}

	async stop(): Promise<void> {
		const clients = [...this.clients.values()];
		this.clients.clear();
		await Promise.all(clients.map((client) => client.close().catch(() => {})));
		await this.runtime.stop();
	}

	private client(session: BackendSession): StreamableHttpMcpClient {
		const client = this.clients.get(String(session.handle));
		if (!client)
			throw new BrowserAutomationError(
				"SESSION_NOT_FOUND",
				"Lightpanda session no longer exists.",
			);
		return client;
	}

	private async evaluate<T>(
		session: BackendSession,
		script: string,
		signal?: AbortSignal,
	): Promise<T> {
		return evaluatedValue<T>(
			await this.client(session).callTool("evaluate", { script }, signal),
		);
	}
}
