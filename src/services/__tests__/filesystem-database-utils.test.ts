import { describe, expect, it, vi } from "vitest";

import {
	DOCUMENTS_SANDBOX_ROOT,
	SANDBOX_FS_PREFIX,
	WORKSPACES_SANDBOX_ROOT,
	isDocumentsSandboxPath,
	isWorkspacesSandboxPath,
	sandboxPathToFsPath,
	toDocumentsLogicalPath,
	toDocumentsSandboxPath,
	toSandboxPath,
	toWorkspacesLogicalPath,
	toWorkspacesSandboxPath,
} from "../filesystem/sandbox-paths";
import { defaultNowToTrigger } from "../database/utils/default-now-to-trigger";
import { getEffectiveSourceStatus } from "../database/utils/source-utils";

describe("filesystem sandbox path utilities", () => {
	it("converts logical paths to scoped sandbox paths and back", () => {
		expect(DOCUMENTS_SANDBOX_ROOT).toBe("/documents");
		expect(WORKSPACES_SANDBOX_ROOT).toBe("/workspaces");
		expect(SANDBOX_FS_PREFIX).toBe("/home");

		expect(toDocumentsSandboxPath("/")).toBe("/documents");
		expect(toDocumentsSandboxPath("/notes/a.md")).toBe("/documents/notes/a.md");
		expect(toWorkspacesSandboxPath("/")).toBe("/workspaces");
		expect(toWorkspacesSandboxPath("/app/index.ts")).toBe(
			"/workspaces/app/index.ts",
		);
		expect(toSandboxPath("/a", "documents")).toBe("/documents/a");
		expect(toSandboxPath("/a", "workspace")).toBe("/workspaces/a");

		expect(toDocumentsLogicalPath("/documents")).toBe("/");
		expect(toDocumentsLogicalPath("/documents/a")).toBe("/a");
		expect(toDocumentsLogicalPath("/workspaces/a")).toBeNull();
		expect(toWorkspacesLogicalPath("/workspaces")).toBe("/");
		expect(toWorkspacesLogicalPath("/workspaces/a")).toBe("/a");
		expect(toWorkspacesLogicalPath("/documents/a")).toBeNull();
	});

	it("identifies sandbox roots and maps them to ZenFS paths", () => {
		expect(isDocumentsSandboxPath("/documents/a")).toBe(true);
		expect(isDocumentsSandboxPath("/documentary/a")).toBe(false);
		expect(isWorkspacesSandboxPath("/workspaces/a")).toBe(true);
		expect(isWorkspacesSandboxPath("/workspace/a")).toBe(false);
		expect(sandboxPathToFsPath("/documents/a/")).toBe("/home/documents/a");
		expect(sandboxPathToFsPath("/workspaces/a")).toBe("/home/workspaces/a");
		expect(() => sandboxPathToFsPath("/tmp/a")).toThrow("Invalid sandbox path");
	});
});

describe("database utility helpers", () => {
	it("builds timestamp trigger SQL from options", () => {
		expect(defaultNowToTrigger("sources")).toContain(
			"sources_set_timestamps_on_insert",
		);
		expect(defaultNowToTrigger("sources")).toContain("sources_set_updated_at");
		expect(
			defaultNowToTrigger("sources", { createdAt: false, updatedAt: true }),
		).not.toContain("set_timestamps_on_insert");
		expect(
			defaultNowToTrigger("sources", { createdAt: true, updatedAt: false }),
		).not.toContain("set_updated_at");
	});

	it("marks stale pending or processing sources as failed", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-01-01T01:00:00.000Z"));

		expect(
			getEffectiveSourceStatus(
				{
					status: "pending",
					statusValidFrom: new Date("2024-01-01T00:00:00.000Z"),
				} as any,
				30,
			),
		).toBe("failed");
		expect(
			getEffectiveSourceStatus(
				{
					status: "processing",
					updatedAt: new Date("2024-01-01T00:45:00.000Z"),
				} as any,
				30,
			),
		).toBe("processing");
		expect(getEffectiveSourceStatus({ status: "ready" } as any)).toBe("ready");
		expect(
			getEffectiveSourceStatus({
				status: undefined,
				createdAt: "not a date",
			} as any),
		).toBe("pending");

		vi.useRealTimers();
	});
});
