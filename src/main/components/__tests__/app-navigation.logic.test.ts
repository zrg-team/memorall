import { describe, expect, it } from "vitest";
import {
	getCopilotNavigationId,
	workspaceNavigationItems,
	workspaceNavigationPaths,
} from "@/main/components/app-navigation";

describe("workspace navigation", () => {
	it("uses /memory as the canonical Memory workspace path", () => {
		const memoryItem = workspaceNavigationItems.find(
			(item) => item.nameKey === "navigation.knowledgeGraph",
		);

		expect(memoryItem?.path).toBe("/memory");
		expect(memoryItem?.mobileLabel).toBe("Memory");
		expect(workspaceNavigationPaths.has("/memory")).toBe(true);
		expect(workspaceNavigationPaths.has("/knowledge-graph")).toBe(false);
	});

	// The nav bar, the collapsed rail and the mobile nav all render this array in
	// order, so its order IS the harness reading: identity → context → capability
	// → engine → execution.
	it("orders tabs as the agent harness reads", () => {
		expect(workspaceNavigationItems.map((item) => item.path)).toEqual([
			"/agents",
			"/files",
			"/memory",
			"/connections",
			"/skills",
			"/llm",
			"/runtime",
		]);
	});

	it("marks a group boundary at each harness concept change", () => {
		expect(
			workspaceNavigationItems
				.filter((item) => item.groupStart)
				.map((item) => item.path),
		).toEqual(["/files", "/connections", "/llm", "/runtime"]);
	});

	it("resolves copilot ids from a single shared table", () => {
		expect(getCopilotNavigationId("/skills")).toBe("skills");
		expect(getCopilotNavigationId("/memory")).toBe("knowledge");
		expect(getCopilotNavigationId("/connections")).toBe("connections");
		// Runtime is execution plumbing, not a tour stop.
		expect(getCopilotNavigationId("/runtime")).toBeNull();
	});
});
