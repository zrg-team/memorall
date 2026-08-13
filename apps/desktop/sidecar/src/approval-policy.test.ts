import { describe, expect, it } from "vitest";
import { assertExecutorApproved, createSanitizedEnvironment } from "./approval-policy";

const approval = {
	enabled: true,
	mode: "every-operation" as const,
	approvedWorkspaceRoots: ["C:/work/project"],
	limits: { maxDurationMs: 60_000, maxOutputBytes: 1_000_000, maxProcesses: 2 },
};

describe("local executor approval policy", () => {
	it("allows approved workspace descendants and rejects escapes", () => {
		expect(() =>
			assertExecutorApproved(
				{
					command: "node",
					args: ["-v"],
					cwd: "C:/work/project/subdir",
					workspaceRoot: "C:/work/project",
					network: false,
				},
				approval,
			),
		).not.toThrow();
		expect(() =>
			assertExecutorApproved(
				{
					command: "node",
					args: [],
					cwd: "C:/work/project-escape",
					workspaceRoot: "C:/work/project",
					network: false,
				},
				approval,
			),
		).toThrow("outside");
	});

	it("copies only explicitly allowed environment variables", () => {
		expect(
			createSanitizedEnvironment(
				{ PATH: "bin", HOME: "secret", OPENAI_API_KEY: "secret", LANG: "en" },
				["PATH", "LANG"],
			),
		).toEqual({ PATH: "bin", LANG: "en" });
	});
});
