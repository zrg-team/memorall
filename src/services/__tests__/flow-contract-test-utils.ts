import { expect } from "vitest";
import type { BaseTool } from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { defaultRegistries } from "@memorall/agent-harness-flows/registries/registry-set";
import { convertToolsToOpenAI } from "@memorall/agent-harness-flows/registries/tool-registry";
import {
	stepRegistry,
	type RegisteredStep,
} from "@memorall/agent-harness-flows/registries/step-registry";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";

export const sortedDelta = (before: Set<string>, after: string[]): string[] =>
	after.filter((name) => !before.has(name)).sort((a, b) => a.localeCompare(b));

const createCallableMock = (): unknown =>
	new Proxy(() => undefined, {
		get(_target, property) {
			if (property === "then") return undefined;
			if (property === Symbol.toStringTag) return "MockService";
			return createCallableMock();
		},
		apply() {
			return undefined;
		},
	});

export const createMockServices = (): Record<string, unknown> =>
	new Proxy(
		{},
		{
			get(_target, property) {
				if (property === "then") return undefined;
				return createCallableMock();
			},
		},
	);

const sanitize = (value: unknown, depth = 0): unknown => {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "undefined") return undefined;
	if (typeof value === "function") {
		return `[Function ${(value as { name?: string }).name || "anonymous"}]`;
	}
	if (typeof value === "symbol") return value.toString();
	if (depth > 6) return "[MaxDepth]";
	if (Array.isArray(value))
		return value.map((item) => sanitize(item, depth + 1));
	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, sanitize(item, depth + 1)]),
		);
	}
	return String(value);
};

const bindToolContracts = (names: string[]): BaseTool[] =>
	names.map((name) => toolRegistry.getToolByName(name, createMockServices()));

export const expectToolContracts = (names: string[]): void => {
	expect(names.length).toBeGreaterThan(0);
	const tools = bindToolContracts(names);

	for (const tool of tools) {
		expect(tool.name).toBeTruthy();
		expect(tool.description.trim().length).toBeGreaterThan(0);
		expect(tool.schema).toBeTruthy();
		expect(typeof tool.execute).toBe("function");
	}

	expect(
		convertToolsToOpenAI(tools).map((tool) => ({
			name: tool.function.name,
			description: tool.function.description,
			parameters: tool.function.parameters,
		})),
	).toMatchSnapshot();
};

const stepContractSnapshot = (entry: RegisteredStep) => ({
	id: entry.id,
	name: entry.name,
	executable: typeof entry.factory === "function",
	config: sanitize(entry.config),
});

export const expectStepContracts = (names: string[]): void => {
	expect(names.length).toBeGreaterThan(0);
	const entries = names.flatMap((name) => stepRegistry.getVersions(name));

	for (const entry of entries) {
		expect(entry.id).toBeTruthy();
		expect(entry.name).toBeTruthy();
		if (entry.factory) {
			const step = stepRegistry.getStepByName(
				entry.id,
				createMockServices(),
				{},
				{ registries: defaultRegistries },
			);
			expect(step.name).toBe(entry.name);
			expect(typeof step.execute).toBe("function");
			expect(typeof step.toNode).toBe("function");
		}
	}

	expect(entries.map(stepContractSnapshot)).toMatchSnapshot();
};
