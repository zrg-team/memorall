import { beforeAll, describe, expect, it } from "vitest";
import { stepRegistry } from "@memorall/agent-harness-flows/registries/step-registry";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import {
	expectStepContracts,
	expectToolContracts,
	sortedDelta,
} from "@/services/__tests__/flow-contract-test-utils";

describe("flows-features registered contracts", () => {
	let toolNames: string[] = [];
	let stepNames: string[] = [];

	beforeAll(async () => {
		const beforeTools = new Set(toolRegistry.getRegisteredToolNames());
		const beforeSteps = new Set(stepRegistry.getRegisteredStepNames());
		await import("../index");
		toolNames = sortedDelta(beforeTools, toolRegistry.getRegisteredToolNames());
		stepNames = sortedDelta(beforeSteps, stepRegistry.getRegisteredStepNames());
	});

	it("registers every features tool contract", () => {
		expect(toolNames).toMatchSnapshot();
		expectToolContracts(toolNames);
	});

	it("registers every features step contract", () => {
		expect(stepNames).toMatchSnapshot();
		expectStepContracts(stepNames);
	});
});
