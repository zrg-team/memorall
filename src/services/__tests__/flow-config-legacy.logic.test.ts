import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";

// The converter folds legacy settings onto whatever the defaults are, so the
// defaults are supplied here rather than depending on which steps happen to be
// registered in a node test process.
vi.mock("@memorall/agent-harness-flows/utils/flow-config", () => ({
	buildDefaultFlowConfig: vi.fn(
		(graphType = "foundation"): UnifiedFlowConfig => ({
			graphType,
			steps: [
				{
					id: "system",
					name: "add-system",
					enabled: true,
					config: { content: "STOCK PROMPT" },
				},
				{
					id: "smart",
					name: "context-smart-retrieve",
					enabled: true,
					config: { prompt: "stock context" },
				},
				{ id: "quick", name: "context-quick-retrieve", enabled: false },
				{ id: "citation", name: "entities-facts-citation", enabled: true },
				{ id: "custom", name: "custom-feature", enabled: true },
				{
					id: "completion",
					name: "agent-completion",
					enabled: true,
					config: { tools: ["stock_tool"], maxIterations: 50 },
				},
			],
		}),
	),
}));

import { buildDefaultFlowConfig } from "@memorall/agent-harness-flows/utils/flow-config";
import {
	applyLegacyDraftToUnified,
	selectFeatureStepNames,
} from "../flow-config-legacy";

const legacyConfig = (overrides = {}) => ({
	systemPrompt: "",
	contextPrompt: "",
	tools: [] as string[],
	maxIterations: 50,
	enableContextRetrieval: true,
	enableCitations: true,
	retrievalMode: "smart",
	graphType: "foundation" as const,
	...overrides,
});

const convert = (
	config = legacyConfig(),
	flags: Record<string, boolean> = {},
	featureNames: string[] = ["custom-feature"],
) =>
	applyLegacyDraftToUnified(
		// A runtime read converts onto a freshly built default, so that is the
		// base under test here too.
		buildDefaultFlowConfig("foundation"),
		config as never,
		flags,
		[],
		[],
		[],
		featureNames,
	);

const stepNamed = (config: UnifiedFlowConfig, name: string) =>
	config.steps.find((step) => step.name === name);

describe("selectFeatureStepNames", () => {
	it("excludes features that declare no graph types", () => {
		const steps = [
			{ name: "for-foundation", type: "feature", graphTypes: ["foundation"] },
			{ name: "for-agent", type: "feature", graphTypes: ["agent"] },
			{ name: "ungraphed", type: "feature" },
			{ name: "not-a-feature", type: "common", graphTypes: ["foundation"] },
		];

		expect(selectFeatureStepNames(steps, "foundation")).toEqual([
			"for-foundation",
		]);
	});
});

describe("applyLegacyDraftToUnified", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("carries the agent's own instruction across", () => {
		const converted = convert(
			legacyConfig({ systemPrompt: "Always answer in Vietnamese." }),
		);

		expect(stepNamed(converted, "add-system")?.config?.content).toBe(
			"Always answer in Vietnamese.",
		);
	});

	it("falls back to the stock instruction when the agent stored a blank one", () => {
		expect(
			stepNamed(convert(legacyConfig({ systemPrompt: "   " })), "add-system")
				?.config?.content,
		).toBe("STOCK PROMPT");
	});

	it("carries the agent's tools and iteration budget", () => {
		const converted = convert(
			legacyConfig({ tools: ["web_search", "remember"], maxIterations: 12 }),
		);

		expect(stepNamed(converted, "agent-completion")?.config).toMatchObject({
			tools: ["web_search", "remember"],
			maxIterations: 12,
		});
	});

	it("clamps an out-of-range iteration budget rather than passing it through", () => {
		expect(
			stepNamed(
				convert(legacyConfig({ maxIterations: 9000 })),
				"agent-completion",
			)?.config?.maxIterations,
		).toBe(200);
	});

	it("enables only the retrieval step the agent selected", () => {
		const converted = convert(legacyConfig({ retrievalMode: "quick" }), {
			"knowledge-retrieval": true,
		});

		expect(stepNamed(converted, "context-quick-retrieve")?.enabled).toBe(true);
		expect(stepNamed(converted, "context-smart-retrieve")?.enabled).toBe(false);
	});

	it("turns every retrieval step off when retrieval is disabled", () => {
		const converted = convert(legacyConfig(), {
			"knowledge-retrieval": false,
		});

		expect(stepNamed(converted, "context-smart-retrieve")?.enabled).toBe(false);
		expect(stepNamed(converted, "context-quick-retrieve")?.enabled).toBe(false);
	});

	it("uses the agent's context prompt for retrieval, and drops it when blank", () => {
		expect(
			stepNamed(
				convert(legacyConfig({ contextPrompt: "Search the notes." })),
				"context-smart-retrieve",
			)?.config?.prompt,
		).toBe("Search the notes.");

		// Dropping the only key leaves an empty config, which the converter
		// collapses to undefined rather than writing `{}` back.
		expect(
			stepNamed(convert(legacyConfig()), "context-smart-retrieve")?.config,
		).toBeUndefined();
	});

	it("applies the citation flag", () => {
		expect(
			stepNamed(
				convert(legacyConfig(), { citations: false }),
				"entities-facts-citation",
			)?.enabled,
		).toBe(false);
		expect(
			stepNamed(
				convert(legacyConfig(), { citations: true }),
				"entities-facts-citation",
			)?.enabled,
		).toBe(true);
	});

	it("applies catalog feature flags by name", () => {
		expect(
			stepNamed(
				convert(legacyConfig(), { "custom-feature": false }),
				"custom-feature",
			)?.enabled,
		).toBe(false);
		expect(
			stepNamed(
				convert(legacyConfig(), { "custom-feature": true }),
				"custom-feature",
			)?.enabled,
		).toBe(true);
	});

	it("leaves a feature alone when it is not in the supplied name list", () => {
		// An empty list stands for a catalog that does not offer the feature for
		// this graph type; the default must survive rather than being forced off.
		expect(
			stepNamed(convert(legacyConfig(), {}, []), "custom-feature")?.enabled,
		).toBe(true);
	});
});
