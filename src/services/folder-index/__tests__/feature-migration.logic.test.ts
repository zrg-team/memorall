import { describe, expect, it } from "vitest";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	splitFolderIndexFeatures,
	splitFolderIndexFeatureFlags,
} from "../feature-migration";
import {
	FOLDER_INDEX_STEP_NAME,
	FILE_OKF_INDEX_STEP_NAME,
	FILE_EMBEDDING_INDEX_STEP_NAME,
} from "../constants";

describe("independent file index features", () => {
	it.each([true, false])(
		"preserves the combined feature's enabled state %s and execution order",
		(enabled) => {
			const config: UnifiedFlowConfig = {
				graphType: "foundation",
				steps: [
					{ id: "before", name: "add-system", enabled: true },
					{ id: "indexes", name: FOLDER_INDEX_STEP_NAME, enabled },
					{ id: "after", name: "agent-completion", enabled: true },
				],
			};
			const before = structuredClone(config);
			const result = splitFolderIndexFeatures(config);
			expect(result.steps.map((step) => [step.name, step.enabled])).toEqual([
				["add-system", true],
				[FILE_OKF_INDEX_STEP_NAME, enabled],
				[FILE_EMBEDDING_INDEX_STEP_NAME, enabled],
				["agent-completion", true],
			]);
			expect(config).toEqual(before);
			expect(splitFolderIndexFeatures(result)).toBe(result);
		},
	);
	it("preserves explicit independent choices and avoids id collisions", () => {
		const config: UnifiedFlowConfig = {
			graphType: "agent",
			steps: [
				{ id: "index", name: FOLDER_INDEX_STEP_NAME, enabled: true },
				{
					id: "index:embeddings",
					name: FILE_OKF_INDEX_STEP_NAME,
					enabled: false,
				},
			],
		};
		const result = splitFolderIndexFeatures(config);
		expect(result.steps).toEqual([
			{
				id: "index:embeddings:1",
				name: FILE_EMBEDDING_INDEX_STEP_NAME,
				enabled: true,
			},
			config.steps[1],
		]);
	});
	it("does not add capabilities to configurations without the old feature", () => {
		const config = { graphType: "agent" };
		expect(splitFolderIndexFeatures(config)).toBe(config);
		const flags = { "fs-feature": true };
		expect(splitFolderIndexFeatureFlags(flags)).toBe(flags);
	});
	it("splits legacy row flags while preserving an explicitly disabled index", () => {
		const flags = {
			[FOLDER_INDEX_STEP_NAME]: true,
			[FILE_EMBEDDING_INDEX_STEP_NAME]: false,
			"fs-feature": true,
		};
		expect(splitFolderIndexFeatureFlags(flags)).toEqual({
			[FILE_OKF_INDEX_STEP_NAME]: true,
			[FILE_EMBEDDING_INDEX_STEP_NAME]: false,
			"fs-feature": true,
		});
		expect(flags[FOLDER_INDEX_STEP_NAME]).toBe(true);
	});
});
