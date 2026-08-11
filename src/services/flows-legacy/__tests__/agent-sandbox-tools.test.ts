import { describe, expect, it, vi } from "vitest";
import { extractToolResult } from "@/services/flows-legacy/interfaces/engine/tool";
import type { IAgentSandboxService } from "@/services/flows-legacy/interfaces/services/agent-sandbox";
import { createSandboxInspectTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-inspect";
import { createSandboxNetworkTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-network";
import { createSandboxPackagesTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-packages";
import { createSandboxProcessTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-process";
import { createSandboxRunTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-run";
import { createSandboxPreviewTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-preview";
import { createSandboxSnapshotTool } from "@/services/flows-legacy/tools/agent-sandbox/sandbox-snapshot";
import { adaptMCPTool } from "@/services/flows-legacy/steps/features/mcp-feature/mcp-tool-adapter";
import {
	getSandboxToolsForProfile,
	SANDBOX_EXECUTION_TOOLS,
	SANDBOX_WEB_APP_TOOLS,
} from "@/services/flows-legacy/tools/agent-sandbox/profiles";
import {
	BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT,
	BROWSER_SANDBOX_FEATURE_TOOLS,
} from "@/services/flows-legacy/steps/features/nodejs-sandbox-feature";

const service = (): IAgentSandboxService => ({
	acquire: vi.fn(),
	release: vi.fn(),
	getCapabilities: vi.fn(),
	inspect: vi.fn(async (request) => ({ operation: request.operation })),
	run: vi.fn(async (request) => ({
		kind: request.operation === "file" ? ("file" as const) : ("code" as const),
		status: "ok" as const,
		durationMs: 3,
		result: "42",
		logs: [],
		truncatedLogs: 0,
	})),
	process: vi.fn(async () => ({ processes: [] })),
	packages: vi.fn(async () => ({ success: true, packages: {} })),
	preview: vi.fn(async () => ({
		previewId: "preview-opaque",
		url: "sandbox://preview-opaque/",
		status: 200,
		ok: true,
		contentType: "text/html",
		responseType: "html" as const,
		headers: {},
		body: "<main>Ready</main>",
	})),
	network: vi.fn(async (request) => ({
		url: request.url,
		status: 200,
		ok: true,
		contentType: "text/plain",
		responseType: "text" as const,
		body: "ok",
	})),
	snapshot: vi.fn(async (request) => ({
		snapshotId:
			request.operation === "restore" ? request.snapshotId : "snapshot-1",
		restored: request.operation === "restore" ? (true as const) : undefined,
	})),
});

describe("agent sandbox tools", () => {
	it("keeps legacy string results backward compatible", () => {
		expect(extractToolResult("legacy output")).toMatchObject({
			content: "legacy output",
			contentText: "legacy output",
			isError: false,
		});
	});

	it("uses a strict root object and rejects cross-operation fields", () => {
		const tool = createSandboxRunTool({ sandboxRuntime: service() });
		expect(() =>
			tool.schema.parse({
				operation: "code",
				code: "1 + 1",
				command: "npm test",
			}),
		).toThrow();
		expect(() =>
			tool.schema.parse({ operation: "command", command: "npm test" }),
		).not.toThrow();
	});

	it("validates and dispatches every grouped tool operation", async () => {
		const sandboxRuntime = service();
		const cases = [
			{
				tool: createSandboxInspectTool({ sandboxRuntime }),
				method: sandboxRuntime.inspect,
				inputs: [
					{ operation: "status" },
					{ operation: "logs", limit: 20, level: "warn" },
					{ operation: "clear_logs" },
					{ operation: "reset" },
				],
			},
			{
				tool: createSandboxRunTool({ sandboxRuntime }),
				method: sandboxRuntime.run,
				inputs: [
					{ operation: "code", code: "1 + 1", filename: "inline.js" },
					{ operation: "file", path: "/main.js" },
					{ operation: "command", command: "npm test", cwd: "/" },
					{ operation: "repl", code: "2 + 2", replId: "repl-1" },
				],
			},
			{
				tool: createSandboxProcessTool({ sandboxRuntime }),
				method: sandboxRuntime.process,
				inputs: [
					{ operation: "list" },
					{ operation: "read", processId: "process-1", cursor: "opaque" },
					{ operation: "stdin", processId: "process-1", input: "q" },
					{ operation: "stop", processId: "process-1" },
				],
			},
			{
				tool: createSandboxPackagesTool({ sandboxRuntime }),
				method: sandboxRuntime.packages,
				inputs: [
					{ operation: "install", packageSpec: "zod@4.1.5", save: true },
					{ operation: "install_from_package_json" },
					{ operation: "list" },
				],
			},
			{
				tool: createSandboxPreviewTool({ sandboxRuntime }),
				method: sandboxRuntime.preview,
				inputs: [
					{ operation: "start", projectDir: "/app", kind: "vite" },
					{ operation: "restart", projectDir: "/app", port: 5173 },
					{ operation: "stop", previewId: "preview-1" },
					{ operation: "list" },
					{ operation: "request", previewId: "preview-1", path: "/api" },
					{ operation: "render", previewId: "preview-1", path: "/" },
				],
			},
			{
				tool: createSandboxNetworkTool({ sandboxRuntime }),
				method: sandboxRuntime.network,
				inputs: [{ operation: "fetch", url: "https://example.test/data" }],
			},
			{
				tool: createSandboxSnapshotTool({ sandboxRuntime }),
				method: sandboxRuntime.snapshot,
				inputs: [
					{ operation: "create", label: "baseline" },
					{ operation: "restore", snapshotId: "snapshot-1" },
				],
			},
		];

		for (const testCase of cases) {
			for (const input of testCase.inputs) {
				const parsed = testCase.tool.schema.parse(input);
				await testCase.tool.execute(parsed as never);
			}
			expect(testCase.method).toHaveBeenCalledTimes(testCase.inputs.length);
		}
	});

	it("rejects missing and irrelevant fields for grouped operations", () => {
		const sandboxRuntime = service();
		const invalidCases = [
			[
				createSandboxInspectTool({ sandboxRuntime }),
				{ operation: "status", limit: 5 },
			],
			[createSandboxRunTool({ sandboxRuntime }), { operation: "code" }],
			[createSandboxRunTool({ sandboxRuntime }), { operation: "file" }],
			[createSandboxRunTool({ sandboxRuntime }), { operation: "command" }],
			[createSandboxRunTool({ sandboxRuntime }), { operation: "repl" }],
			[
				createSandboxProcessTool({ sandboxRuntime }),
				{ operation: "list", processId: "p" },
			],
			[createSandboxProcessTool({ sandboxRuntime }), { operation: "read" }],
			[
				createSandboxProcessTool({ sandboxRuntime }),
				{ operation: "stdin", processId: "p" },
			],
			[createSandboxProcessTool({ sandboxRuntime }), { operation: "stop" }],
			[createSandboxPackagesTool({ sandboxRuntime }), { operation: "install" }],
			[
				createSandboxPackagesTool({ sandboxRuntime }),
				{ operation: "list", save: true },
			],
			[createSandboxPreviewTool({ sandboxRuntime }), { operation: "start" }],
			[createSandboxPreviewTool({ sandboxRuntime }), { operation: "stop" }],
			[createSandboxPreviewTool({ sandboxRuntime }), { operation: "request" }],
			[createSandboxPreviewTool({ sandboxRuntime }), { operation: "render" }],
			[
				createSandboxPreviewTool({ sandboxRuntime }),
				{ operation: "list", port: 5173 },
			],
			[
				createSandboxNetworkTool({ sandboxRuntime }),
				{ operation: "fetch", url: "not-a-url" },
			],
			[createSandboxSnapshotTool({ sandboxRuntime }), { operation: "restore" }],
			[
				createSandboxSnapshotTool({ sandboxRuntime }),
				{ operation: "create", snapshotId: "x" },
			],
		] as const;

		for (const [tool, input] of invalidCases) {
			expect(tool.schema.safeParse(input).success).toBe(false);
		}
	});

	it("returns structured content while preserving exact JSON model content", async () => {
		const sandboxRuntime = service();
		const tool = createSandboxRunTool({ sandboxRuntime });
		const result = await tool.execute({ operation: "code", code: "6 * 7" });
		const extracted = extractToolResult(result);

		expect(extracted.structuredContent).toMatchObject({
			ok: true,
			operation: "code",
			result: { result: "42" },
		});
		expect(JSON.parse(extracted.contentText)).toEqual(
			extracted.structuredContent,
		);
		expect(sandboxRuntime.run).toHaveBeenCalledWith(
			{ operation: "code", code: "6 * 7" },
			expect.objectContaining({
				operationId: expect.stringContaining("sandbox_run:"),
			}),
		);
	});

	it("returns expected operational failures as structured error results", async () => {
		const sandboxRuntime = service();
		vi.mocked(sandboxRuntime.run).mockRejectedValueOnce(
			new Error("transport lost"),
		);
		const tool = createSandboxRunTool({ sandboxRuntime });
		const extracted = extractToolResult(
			await tool.execute({ operation: "code", code: "1" }),
		);

		expect(extracted.isError).toBe(true);
		expect(extracted.structuredContent).toMatchObject({
			ok: false,
			error: { code: "provider_error", message: "transport lost" },
		});
	});

	it("preserves the web-access action marker for preview rendering", async () => {
		const tool = createSandboxPreviewTool({ sandboxRuntime: service() });
		const extracted = extractToolResult(
			await tool.execute({ operation: "render", previewId: "preview-opaque" }),
		);

		expect(extracted.structuredContent).toMatchObject({
			actionType: "web_access",
			result: { previewId: "preview-opaque" },
		});
	});

	it("preserves MCP structured content and metadata at the adapter boundary", async () => {
		const tool = adaptMCPTool({
			name: "remote_sandbox",
			description: "Remote sandbox test",
			schema: { type: "object", properties: {} },
			metadata: {
				source: "mcp",
				mcp: {
					serverName: "remote",
					originalToolName: "sandbox",
					title: "Remote Sandbox",
					outputSchema: { type: "object" },
				},
			},
			invoke: vi.fn(async () =>
				JSON.stringify({
					text: "completed",
					structuredContent: { sessionId: "remote-session" },
					meta: { operationId: "remote-op" },
				}),
			),
		} as never);
		const extracted = extractToolResult(await tool.execute({}));

		expect(tool.title).toBe("Remote Sandbox");
		expect(tool.outputSchema).toEqual({ type: "object" });
		expect(extracted.structuredContent).toEqual({
			sessionId: "remote-session",
		});
		expect(extracted.meta).toEqual({ operationId: "remote-op" });
	});
});

describe("sandbox tool profiles", () => {
	it("exposes six sandbox tools by default and snapshots only when stateful", () => {
		expect(SANDBOX_EXECUTION_TOOLS).toHaveLength(4);
		expect(SANDBOX_WEB_APP_TOOLS).toHaveLength(6);
		expect(getSandboxToolsForProfile("web_app")).not.toContain(
			"sandbox_snapshot",
		);
		expect(getSandboxToolsForProfile("stateful")).toContain("sandbox_snapshot");
	});

	it("removes tools whose required capabilities are unavailable", () => {
		const completeExecutionCapabilities = [
			"runtime.code",
			"runtime.file",
			"runtime.command",
			"runtime.repl",
			"process.background",
			"process.stdin",
		];
		expect(
			getSandboxToolsForProfile("web_app", completeExecutionCapabilities),
		).toEqual(["sandbox_inspect", "sandbox_run", "sandbox_process"]);
		expect(
			getSandboxToolsForProfile(
				"web_app",
				completeExecutionCapabilities.filter(
					(capability) => capability !== "runtime.repl",
				),
			),
		).toEqual(["sandbox_inspect", "sandbox_process"]);
		expect(
			getSandboxToolsForProfile(
				"web_app",
				completeExecutionCapabilities.filter(
					(capability) => capability !== "process.stdin",
				),
			),
		).toEqual(["sandbox_inspect", "sandbox_run"]);
	});

	it("sources the feature tool list and prompt from browser sandbox exports", () => {
		const sandboxTools = BROWSER_SANDBOX_FEATURE_TOOLS.filter((tool) =>
			tool.startsWith("sandbox_"),
		);
		expect(sandboxTools).toEqual(SANDBOX_WEB_APP_TOOLS);
		expect(BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT).toContain("sandbox_run");
		expect(BROWSER_SANDBOX_FEATURE_SYSTEM_PROMPT).not.toContain(
			"container_run_code",
		);
	});
});
