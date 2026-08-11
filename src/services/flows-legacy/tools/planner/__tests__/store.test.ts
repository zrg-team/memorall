import { describe, expect, it } from "vitest";
import { createFlowRuntimeVars } from "@/services/flows-legacy/runtime/runtime-context";
import { createPlannerCreateTool } from "@/services/flows-legacy/tools/planner/planner-create";
import { clearPlan, getPlan } from "@/services/flows-legacy/tools/planner/store";

describe("planner runtime storage", () => {
	it("keeps planner state isolated per runtime vars instance", async () => {
		const runtimeA = createFlowRuntimeVars();
		const runtimeB = createFlowRuntimeVars();
		const plannerCreate = createPlannerCreateTool();

		await plannerCreate.execute(
			{ title: "Plan A", items: "Inspect; Patch" },
			{ state: {}, runtime: runtimeA },
		);
		await plannerCreate.execute(
			{ title: "Plan B", items: "Verify" },
			{ state: {}, runtime: runtimeB },
		);

		expect(getPlan(runtimeA)?.title).toBe("Plan A");
		expect(getPlan(runtimeA)?.items.map((item) => item.description)).toEqual([
			"Inspect",
			"Patch",
		]);
		expect(getPlan(runtimeB)?.title).toBe("Plan B");
		expect(getPlan(runtimeB)?.items.map((item) => item.description)).toEqual([
			"Verify",
		]);

		clearPlan(runtimeA);

		expect(getPlan(runtimeA)).toBeNull();
		expect(getPlan(runtimeB)?.title).toBe("Plan B");
	});
});
