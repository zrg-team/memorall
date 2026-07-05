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

const legacyDocumentsRoot = `/${"documents"}`;
const legacyWorkspacesRoot = `/${"workspaces"}`;

describe("filesystem sandbox path utilities", () => {
	it("converts logical paths to scoped sandbox paths and back", () => {
		expect(DOCUMENTS_SANDBOX_ROOT).toBe("/");
		expect(WORKSPACES_SANDBOX_ROOT).toBe("/");
		expect(SANDBOX_FS_PREFIX).toBe("/home/files");

		expect(toDocumentsSandboxPath("/")).toBe("/");
		expect(toDocumentsSandboxPath("/notes/a.md")).toBe("/notes/a.md");
		expect(toWorkspacesSandboxPath("/")).toBe("/");
		expect(toWorkspacesSandboxPath("/app/index.ts")).toBe("/app/index.ts");
		expect(toSandboxPath("/a", "documents")).toBe("/a");
		expect(toSandboxPath("/a", "workspace")).toBe("/a");

		expect(toDocumentsLogicalPath(legacyDocumentsRoot)).toBe("/");
		expect(toDocumentsLogicalPath(`${legacyDocumentsRoot}/a`)).toBe("/a");
		expect(toDocumentsLogicalPath(`${legacyWorkspacesRoot}/a`)).toBe("/a");
		expect(toWorkspacesLogicalPath(legacyWorkspacesRoot)).toBe("/");
		expect(toWorkspacesLogicalPath(`${legacyWorkspacesRoot}/a`)).toBe("/a");
		expect(toWorkspacesLogicalPath(`${legacyDocumentsRoot}/a`)).toBeNull();
	});

	it("identifies sandbox roots and maps them to ZenFS paths", () => {
		expect(isDocumentsSandboxPath("/notes/a")).toBe(true);
		expect(isDocumentsSandboxPath(`${legacyDocumentsRoot}/a`)).toBe(true);
		expect(isWorkspacesSandboxPath(`${legacyWorkspacesRoot}/a`)).toBe(true);
		expect(isWorkspacesSandboxPath("/workspace/a")).toBe(false);
		expect(sandboxPathToFsPath(`${legacyDocumentsRoot}/a/`)).toBe(
			"/home/files/a",
		);
		expect(sandboxPathToFsPath(`${legacyWorkspacesRoot}/a`)).toBe(
			"/home/files/a",
		);
		expect(sandboxPathToFsPath("tmp/a")).toBe("/home/files/tmp/a");
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
