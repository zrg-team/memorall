import z from "zod";
import type { Tool, ToolFactory } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";

const TOOL_NAME = "js_execute" as const;

const schema = z.object({
	code: z
		.string()
		.describe("JavaScript code to execute. Use `return` to return a value."),
	timeoutMs: z
		.number()
		.min(10)
		.max(10_000)
		.optional()
		.describe("Execution timeout in milliseconds (default: 1000)"),
	maxLogEntries: z
		.number()
		.min(1)
		.max(200)
		.optional()
		.describe(
			"Maximum console log entries to capture (default: 20, keeps latest)",
		),
});

type Input = z.infer<typeof schema>;

type LogEntry = {
	level: "log" | "info" | "warn" | "error" | "debug";
	message: string;
};

type WorkerResult =
	| {
			status: "ok";
			durationMs: number;
			result: string;
			logs: LogEntry[];
			truncatedLogs: number;
	  }
	| {
			status: "error";
			durationMs: number;
			error: string;
			stack?: string;
			logs: LogEntry[];
			truncatedLogs: number;
	  }
	| {
			status: "timeout";
			durationMs: number;
			logs: LogEntry[];
			truncatedLogs: number;
	  };

const executeInSandboxPage = async (
	code: string,
	timeoutMs: number,
	maxLogEntries: number,
): Promise<WorkerResult> => {
	if (typeof document === "undefined" || typeof window === "undefined") {
		return {
			status: "error",
			durationMs: 0,
			error: "DOM APIs are not available in this environment.",
			logs: [],
			truncatedLogs: 0,
		};
	}
	if (typeof chrome === "undefined" || !chrome.runtime?.getURL) {
		return {
			status: "error",
			durationMs: 0,
			error: "Chrome runtime is not available.",
			logs: [],
			truncatedLogs: 0,
		};
	}

	const logs: LogEntry[] = [];
	let truncatedLogs = 0;
	const startedAt = Date.now();
	let settled = false;
	const id = crypto.randomUUID();

	const iframe = document.createElement("iframe");
	iframe.style.display = "none";
	iframe.sandbox.add("allow-scripts");
	iframe.src = chrome.runtime.getURL("sandbox/pages/js-execute.html");
	document.body.appendChild(iframe);

	const finalize = (result: WorkerResult) => {
		if (settled) return;
		settled = true;
		clearTimeout(timeoutId);
		window.removeEventListener("message", onMessage);
		iframe.remove();
		return result;
	};

	const timeoutId = window.setTimeout(() => {
		const durationMs = Date.now() - startedAt;
		const result = finalize({
			status: "timeout",
			durationMs,
			logs,
			truncatedLogs,
		});
		if (result && resolver) resolver(result);
	}, timeoutMs);

	let resolver: ((value: WorkerResult) => void) | null = null;
	const resultPromise = new Promise<WorkerResult>((resolve) => {
		resolver = resolve;
	});

	const onMessage = (event: MessageEvent) => {
		if (event.source !== iframe.contentWindow) return;
		const { type, payload, id: messageId } = event.data || {};
		if (messageId !== id) return;

		if (type === "log" && payload) {
			if (logs.length < maxLogEntries) {
				logs.push({
					level: payload.level || "log",
					message: payload.message || "",
				});
			} else {
				truncatedLogs += 1;
			}
			return;
		}

		if (type === "result") {
			const durationMs = payload?.durationMs ?? Date.now() - startedAt;
			const result = finalize({
				status: payload?.status ?? "ok",
				durationMs,
				result: payload?.result ?? "undefined",
				error: payload?.error,
				stack: payload?.stack,
				logs: payload?.logs ?? logs,
				truncatedLogs: payload?.truncatedLogs ?? truncatedLogs,
			} as WorkerResult);
			if (result && resolver) resolver(result);
		}
	};

	window.addEventListener("message", onMessage);

	const postCode = () => {
		if (!iframe.contentWindow) return;
		iframe.contentWindow.postMessage(
			{
				type: "run",
				id,
				code,
				timeoutMs,
				maxLogEntries,
			},
			"*",
		);
	};

	if (
		iframe.contentWindow &&
		iframe.contentDocument?.readyState === "complete"
	) {
		postCode();
	} else {
		iframe.addEventListener("load", postCode, { once: true });
	}

	return resultPromise;
};
const formatResult = (result: WorkerResult) => {
	return JSON.stringify(result, null, 2);
};

export const createJsExecuteTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Execute JavaScript from `code` in an extension sandbox page (CSP-safe). Allowed APIs: console (log/info/warn/error/debug), Math/Number/String/Boolean/Array/Object/Date/JSON/RegExp/Promise, in-memory cookie/localStorage/sessionStorage, fetch/XMLHttpRequest with credentials blocked (credentials forced to omit, Cookie/Authorization headers stripped). Returns JSON: status (ok|error|timeout), result (string on ok), logs [{level,message}] (keeps latest 20 by default), durationMs, truncatedLogs, and error/stack when status=error. IMPORTANT: Always use console.log(...) to report progress and the final answer so it appears in logs; also `return String(...)` for a definitive result value.",
	schema,
	execute: async (input) => {
		const { code, timeoutMs = 1000, maxLogEntries = 20 } = input;
		const result = await executeInSandboxPage(code, timeoutMs, maxLogEntries);
		return formatResult(result);
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createJsExecuteTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
