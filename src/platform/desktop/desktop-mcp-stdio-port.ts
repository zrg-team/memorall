import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
	type McpStdioCallResult,
	type McpStdioPort,
	McpStdioPortError,
	type McpStdioRuntimeProbe,
	type McpStdioServerStatus,
	type McpStdioSpec,
	type McpStdioToolInfo,
} from "../contracts/core";

type Invoke = (
	command: string,
	args?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Local MCP servers, started and owned by the desktop sidecar.
 *
 * Every request goes through one narrow Tauri command whose method allowlist
 * lives in Rust; the web view never gets a general way to start processes.
 */
export class DesktopMcpStdioPort implements McpStdioPort {
	constructor(
		private readonly invoke: Invoke = (command, args) =>
			tauriInvoke(command, args),
	) {}

	ensure(
		spec: McpStdioSpec,
		options: { force?: boolean; startTimeoutMs?: number } = {},
	): Promise<McpStdioServerStatus> {
		return this.request("mcp.stdio.ensure", {
			spec,
			...(options.force ? { force: true } : {}),
			...(options.startTimeoutMs
				? { startTimeoutMs: options.startTimeoutMs }
				: {}),
		});
	}

	async listTools(
		spec: McpStdioSpec,
		options: { startTimeoutMs?: number } = {},
	): Promise<McpStdioToolInfo[]> {
		const result = await this.request<{ tools: McpStdioToolInfo[] }>(
			"mcp.stdio.list-tools",
			{
				spec,
				...(options.startTimeoutMs
					? { startTimeoutMs: options.startTimeoutMs }
					: {}),
			},
		);
		return result.tools;
	}

	async call(
		spec: McpStdioSpec,
		tool: string,
		input: Record<string, unknown>,
		options: { timeoutMs?: number; signal?: AbortSignal } = {},
	): Promise<McpStdioCallResult> {
		const { signal } = options;
		if (signal?.aborted) throw abortError(signal);
		// Tauri cannot cancel an invoke, so the call carries an id the sidecar can
		// be told to abort, which also tells the server to stop the work.
		const callId = signal ? newCallId() : undefined;
		const pending = this.request<McpStdioCallResult>("mcp.stdio.call", {
			spec,
			tool,
			input,
			...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
			...(callId ? { callId } : {}),
		});
		if (!signal || !callId) return pending;

		let onAbort: (() => void) | undefined;
		const aborted = new Promise<never>((_, reject) => {
			onAbort = () => {
				void this.request("mcp.stdio.cancel", { callId }).catch(
					() => undefined,
				);
				reject(abortError(signal));
			};
			signal.addEventListener("abort", onAbort, { once: true });
		});
		// The losing side of the race must not surface as an unhandled rejection.
		pending.catch(() => undefined);
		aborted.catch(() => undefined);
		try {
			return await Promise.race([pending, aborted]);
		} finally {
			if (onAbort) signal.removeEventListener("abort", onAbort);
		}
	}

	async stop(id: string): Promise<McpStdioServerStatus | null> {
		const result = await this.request<{ status: McpStdioServerStatus | null }>(
			"mcp.stdio.stop",
			{ id },
		);
		return result.status;
	}

	async status(ids?: string[]): Promise<McpStdioServerStatus[]> {
		const result = await this.request<{ servers: McpStdioServerStatus[] }>(
			"mcp.stdio.status",
			ids ? { ids } : {},
		);
		return result.servers;
	}

	async probe(
		commands: string[],
	): Promise<Record<string, McpStdioRuntimeProbe>> {
		const result = await this.request<{
			runtimes: Record<string, McpStdioRuntimeProbe>;
		}>("mcp.stdio.probe", { commands });
		return result.runtimes;
	}

	async pickDirectory(): Promise<string | null> {
		const picked = await this.invoke("plugin:dialog|open", {
			options: { directory: true, multiple: false },
		});
		return typeof picked === "string" ? picked : null;
	}

	private async request<T>(
		method: string,
		params: Record<string, unknown>,
	): Promise<T> {
		try {
			return (await this.invoke("desktop_mcp_stdio_request", {
				method,
				params,
			})) as T;
		} catch (error) {
			throw normalizeMcpStdioError(error);
		}
	}
}

const newCallId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/** Shaped like a `fetch` abort, so callers that check for one recognise it. */
const abortError = (signal: AbortSignal): Error => {
	if (signal.reason instanceof Error) return signal.reason;
	const error = new Error("The local server call was cancelled.");
	error.name = "AbortError";
	return error;
};

export function normalizeMcpStdioError(error: unknown): McpStdioPortError {
	if (error instanceof McpStdioPortError) return error;
	const candidate =
		typeof error === "object" && error !== null
			? (error as { code?: unknown; message?: unknown })
			: {};
	const message =
		typeof candidate.message === "string"
			? candidate.message
			: error instanceof Error
				? error.message
				: String(error);
	const code = typeof candidate.code === "string" ? candidate.code : "";

	// The supervisor is shared with the browser, so its own codes name it.
	if (code === "BROWSER_TIMEOUT") {
		return new McpStdioPortError(
			"MCP_STDIO_TIMEOUT",
			"The local server did not answer in time.",
		);
	}
	// A sidecar or app build older than this frontend.
	if (
		/not allowed|not implemented yet|desktop_mcp_stdio_request.*not found/i.test(
			message,
		)
	) {
		return new McpStdioPortError(
			"MCP_STDIO_UNSUPPORTED",
			"This version of Memorall cannot run local servers yet. Restart or update the app.",
		);
	}
	return new McpStdioPortError(code || "MCP_STDIO_UNAVAILABLE", message);
}
