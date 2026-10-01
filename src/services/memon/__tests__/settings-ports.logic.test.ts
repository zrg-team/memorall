import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnection } from "@/services/mcp-connections/types";

// Only their step names are needed; the step modules load the whole harness.
vi.mock("@memorall/agent-harness-flows/steps/common/add-skill-context", () => ({
	ADD_SKILL_CONTEXT_STEP_NAME: "add-skill-context",
}));
vi.mock(
	"@memorall/agent-harness-flows/steps/features/mcp-feature/index",
	() => ({
		MCP_FEATURE_NAME: "mcp-feature",
	}),
);

import {
	createMemonConnectionsPort,
	createMemonSkillsPort,
	type MemonAgentSettings,
	type MemonConnectionRegistry,
	type MemonSkillLibrary,
} from "../settings-ports";

const createSettings = () => {
	let config: UnifiedFlowConfig = {
		graphType: "foundation",
		steps: [
			{
				id: "1",
				name: "add-skill-context",
				enabled: true,
				config: { enabledSkillNames: ["writer"] },
			},
			{
				id: "2",
				name: "mcp-feature",
				enabled: false,
				config: { servers: [{ name: "stale" }] },
			},
		],
	};
	const settings: MemonAgentSettings = {
		readConfig: vi.fn(async () => config),
		saveConfig: vi.fn(async (_agentId: string, next: UnifiedFlowConfig) => {
			config = next;
		}),
		agentName: vi.fn(async () => "Researcher"),
	};
	const stepConfig = (name: string) =>
		config.steps.find((step) => step.name === name);
	return { settings, stepConfig };
};

const library: MemonSkillLibrary = {
	listSkills: vi.fn(async () => [
		{
			name: "pdf-tools",
			description: "PDFs",
			path: "/home/skills/pdf-tools.md",
			origin: "default" as const,
			readOnly: true,
		},
		{
			name: "writer",
			description: "Write",
			path: "/home/skills/writer.md",
			origin: "custom" as const,
		},
	]),
	readSkill: vi.fn(),
	writeSkill: vi.fn(async () => undefined),
	deleteSkill: vi.fn(async () => undefined),
	validateSkillName: (name) =>
		/^[a-z0-9][a-z0-9-]*$/.test(name)
			? { valid: true }
			: { valid: false, reason: "Use lowercase letters, numbers and hyphens." },
};

const composio = {
	id: "c1",
	name: "Composio",
	kind: "composio",
	transport: "http",
	url: "https://example.com/mcp",
	authMode: "none",
	apps: [
		{ id: "gmail", name: "Gmail", status: "active" },
		{ id: "github", name: "GitHub", status: "active" },
	],
} as unknown as McpConnection;

const registry: MemonConnectionRegistry = {
	listConnections: vi.fn(async () => [composio]),
	getConnection: vi.fn(async () => composio),
	loadToolCache: vi.fn(async () => ({
		version: 1 as const,
		entries: {
			c1: {
				descriptors: [
					{
						name: "GMAIL_SEND",
						exposedName: "c1__GMAIL_SEND",
						description: "Send",
					},
				],
				discoveredAt: "2026-10-01T00:00:00.000Z",
			},
		},
	})),
	saveToolCacheEntry: vi.fn(async () => undefined),
	discoverConnection: vi.fn(async () => ({
		ok: false as const,
		reason: "unreachable" as const,
		error: "403 forbidden",
	})),
	isUnlocked: vi.fn(async () => true),
	statusOf: vi.fn(() => "connected" as const),
};

describe("MemonOS settings ports", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("lists the agent's skills first and saves a switch to its flow", async () => {
		const { settings, stepConfig } = createSettings();
		const port = createMemonSkillsPort(settings, async () => library);
		const { agentName, items } = await port.list("agent-1");
		expect(agentName).toBe("Researcher");
		expect(items.map((item) => [item.name, item.enabled])).toEqual([
			["writer", true],
			["pdf-tools", false],
		]);

		await port.setEnabled("agent-1", "pdf-tools", true);
		await port.setEnabled("agent-1", "writer", false);
		expect(stepConfig("add-skill-context")?.config).toEqual({
			enabledSkillNames: ["pdf-tools"],
		});

		await expect(
			port.save({ name: "pdf-tools", description: "x", body: "y" }),
		).rejects.toThrow('"pdf-tools" is a built-in skill and cannot be changed.');
		await expect(
			port.save({ name: "Bad Name", description: "x", body: "y" }),
		).rejects.toThrow("Use lowercase letters");
		await port.save({ name: "notes-helper", description: "x", body: "y" });
		expect(library.writeSkill).toHaveBeenCalledWith("notes-helper", "x", "y");
	});

	it("grants one Composio app, turning the connections feature on", async () => {
		const { settings, stepConfig } = createSettings();
		const port = createMemonConnectionsPort(settings, async () => registry);
		const before = await port.list("agent-1");
		expect(before.items.map((item) => [item.label, item.granted])).toEqual([
			["Gmail", false],
			["GitHub", false],
		]);
		expect(before.items[0]?.tools[0]?.name).toBe("c1__GMAIL_SEND");

		await port.setGranted("agent-1", "c1::gmail", true);
		expect(stepConfig("mcp-feature")).toMatchObject({
			enabled: true,
			config: { connections: [{ connectionId: "c1", appIds: ["gmail"] }] },
		});
		// The run-time server list is derived, never kept.
		expect(stepConfig("mcp-feature")?.config).not.toHaveProperty("servers");
		expect((await port.list("agent-1")).items[0]?.granted).toBe(true);

		// Granting again changes nothing; revoking the last app turns it off.
		await port.setGranted("agent-1", "c1::gmail", true);
		await port.setGranted("agent-1", "c1::gmail", false);
		expect(stepConfig("mcp-feature")).toMatchObject({
			enabled: false,
			config: { connections: [] },
		});
		await expect(port.setGranted("agent-1", "c9", true)).rejects.toThrow(
			"That connection no longer exists.",
		);
	});

	it("keeps the known tools when a refresh fails, with the error", async () => {
		const { settings } = createSettings();
		const port = createMemonConnectionsPort(settings, async () => registry);
		await port.refresh("c1");
		expect(registry.saveToolCacheEntry).toHaveBeenCalledWith(
			"c1",
			expect.objectContaining({
				error: "403 forbidden",
				descriptors: [expect.objectContaining({ name: "GMAIL_SEND" })],
			}),
		);
	});
});
