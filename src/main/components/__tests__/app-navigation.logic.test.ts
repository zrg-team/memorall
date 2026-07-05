import { describe, expect, it } from "vitest";
import {
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
});
