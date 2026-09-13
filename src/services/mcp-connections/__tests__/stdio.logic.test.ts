import { beforeEach, describe, expect, it, vi } from "vitest";

const listConnections = vi.fn();
const loadSecret = vi.fn();
const store = new Map<string, unknown>();
const port = {
	ensure: vi.fn(),
	listTools: vi.fn(),
	call: vi.fn(),
	stop: vi.fn(),
	status: vi.fn(),
	probe: vi.fn(),
	pickDirectory: vi.fn(),
};
const platformState: { mcpStdio?: typeof port } = { mcpStdio: port };

vi.mock("@/platform/current", () => ({
	platform: {
		get mcpStdio() {
			return platformState.mcpStdio;
		},
		persistentStore: {
			get: async (key: string) => store.get(key) ?? null,
			set: async (key: string, value: unknown) => {
				store.set(key, value);
			},
		},
	},
}));

vi.mock("../registry", () => ({
	listConnections: (...args: unknown[]) => listConnections(...args),
	upsertConnection: vi.fn(),
}));

vi.mock("@/utils/master-key", () => ({
	loadSecret: (...args: unknown[]) => loadSecret(...args),
}));

vi.mock("@/utils/logger", () => ({
	logWarn: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logDebug: vi.fn(),
}));

import { McpStdioPortError } from "@/platform/contracts/core";
import { discoverConnection } from "../discovery";
import { resolveConnections } from "../resolve";
import {
	approveStdio,
	buildStdioSpec,
	formatCommandLine,
	isStdioApproved,
	revokeStdioApproval,
	stdioApprovalFingerprint,
} from "../stdio";
import type { McpConnection, StdioConnectionDetail } from "../types";

type StdioConnection = McpConnection & { stdio: StdioConnectionDetail };

const localServer = (
	overrides: Partial<StdioConnectionDetail> = {},
	connectionOverrides: Partial<McpConnection> = {},
): StdioConnection => ({
	id: "local-1",
	kind: "template",
	name: "Project Files",
	transport: "stdio",
	url: "",
	authMode: "none",
	enabledByDefault: false,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	stdio: {
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-filesystem@2026.8.31", "/work"],
		...overrides,
	},
	...connectionOverrides,
});

beforeEach(() => {
	store.clear();
	listConnections.mockReset();
	loadSecret.mockReset();
	for (const fn of Object.values(port)) fn.mockReset();
	platformState.mcpStdio = port;
});

describe("local server approval", () => {
	it("holds for the approved command and lapses when it changes", async () => {
		const server = localServer();
		expect(await isStdioApproved(server)).toBe(false);

		await approveStdio(server);
		expect(await isStdioApproved(server)).toBe(true);

		expect(
			await isStdioApproved(
				localServer({ args: [...server.stdio.args, "/etc"] }),
			),
		).toBe(false);
		expect(await isStdioApproved(localServer({ env: { DEBUG: "1" } }))).toBe(
			false,
		);
	});

	it("survives a rotated secret but not a newly secret variable", async () => {
		const withToken = localServer({ secretEnvKeys: ["TOKEN"] });
		expect(await stdioApprovalFingerprint(withToken.stdio)).toBe(
			await stdioApprovalFingerprint({ ...withToken.stdio }),
		);
		expect(await stdioApprovalFingerprint(withToken.stdio)).not.toBe(
			await stdioApprovalFingerprint(localServer().stdio),
		);
	});

	it("can be revoked", async () => {
		const server = localServer();
		await approveStdio(server);
		await revokeStdioApproval(server.id);
		expect(await isStdioApproved(server)).toBe(false);
	});
});

describe("buildStdioSpec", () => {
	it("merges decrypted secrets into env and marks them for redaction", async () => {
		loadSecret.mockResolvedValue(JSON.stringify({ TOKEN: "s3cret" }));
		const spec = await buildStdioSpec(
			localServer(
				{ env: { MODE: "ro" }, secretEnvKeys: ["TOKEN"] },
				{ secretRef: "mcp_secret_local-1" },
			),
		);
		expect(spec).toEqual({
			id: "local-1",
			command: "npx",
			args: [
				"-y",
				"@modelcontextprotocol/server-filesystem@2026.8.31",
				"/work",
			],
			env: { MODE: "ro", TOKEN: "s3cret" },
			secretEnvKeys: ["TOKEN"],
		});
	});

	it("returns null when a secret cannot be read", async () => {
		loadSecret.mockRejectedValue(new Error("locked"));
		expect(
			await buildStdioSpec(
				localServer({ secretEnvKeys: ["TOKEN"] }, { secretRef: "ref" }),
			),
		).toBeNull();
	});

	it("uses typed-in secrets before anything is saved", async () => {
		const spec = await buildStdioSpec(
			localServer({ secretEnvKeys: ["TOKEN"] }),
			{
				TOKEN: "typed",
			},
		);
		expect(spec?.env).toEqual({ TOKEN: "typed" });
		expect(loadSecret).not.toHaveBeenCalled();
	});
});

describe("formatCommandLine", () => {
	it("quotes arguments with spaces so the approval shows what really runs", () => {
		expect(
			formatCommandLine({
				command: "uvx",
				args: ["mcp-server-git", "C:\\My Repo"],
			}),
		).toBe('uvx mcp-server-git "C:\\\\My Repo"');
	});
});

describe("resolveConnections with local servers", () => {
	it("includes an approved local server as a stdio server", async () => {
		const server = localServer();
		listConnections.mockResolvedValue([server]);
		await approveStdio(server);

		const result = await resolveConnections([
			{ connectionId: "local-1", toolAllowlist: ["read_file"] },
		]);

		expect(result.servers).toEqual([
			{
				type: "stdio",
				name: "project-files",
				id: "local-1",
				command: "npx",
				args: server.stdio.args,
				env: {},
				secretEnvKeys: [],
			},
		]);
		expect(result.toolAllowlist).toEqual(["project-files__read_file"]);
		expect(result.skipped).toEqual([]);
	});

	it("skips a local server that was never approved on this device", async () => {
		listConnections.mockResolvedValue([localServer()]);
		const result = await resolveConnections([{ connectionId: "local-1" }]);
		expect(result.servers).toEqual([]);
		expect(result.skipped).toEqual(["local-1"]);
	});

	it("skips local servers where processes cannot be started", async () => {
		const server = localServer();
		listConnections.mockResolvedValue([server]);
		await approveStdio(server);
		platformState.mcpStdio = undefined;

		const result = await resolveConnections([{ connectionId: "local-1" }]);
		expect(result.skipped).toEqual(["local-1"]);
	});
});

describe("discoverConnection for local servers", () => {
	it("starts the server and lists its tools under the connection prefix", async () => {
		const server = localServer();
		await approveStdio(server);
		port.ensure.mockResolvedValue({ state: "running" });
		port.listTools.mockResolvedValue([
			{
				name: "read_file",
				description: "Read a file",
				inputSchema: {},
				annotations: { readOnlyHint: true },
			},
		]);

		const result = await discoverConnection(server);

		expect(result).toMatchObject({
			ok: true,
			descriptors: [
				{
					name: "read_file",
					exposedName: "project-files__read_file",
					readOnly: true,
				},
			],
		});
		expect(port.ensure).toHaveBeenCalledWith(
			expect.objectContaining({ id: "local-1", command: "npx" }),
		);
	});

	it("refuses to start a command that is not approved", async () => {
		const result = await discoverConnection(localServer());
		expect(result).toMatchObject({ ok: false, reason: "not-approved" });
		expect(port.ensure).not.toHaveBeenCalled();
	});

	it("reports a missing runtime so the UI can point at the installer", async () => {
		const server = localServer();
		await approveStdio(server);
		port.ensure.mockRejectedValue(
			new McpStdioPortError(
				"MCP_STDIO_COMMAND_NOT_FOUND",
				'"npx" is not installed or not on PATH.',
			),
		);

		expect(await discoverConnection(server)).toMatchObject({
			ok: false,
			reason: "runtime-missing",
		});
	});

	it("explains that local servers need the desktop app", async () => {
		platformState.mcpStdio = undefined;
		expect(await discoverConnection(localServer())).toMatchObject({
			ok: false,
			reason: "unsupported",
		});
	});
});
