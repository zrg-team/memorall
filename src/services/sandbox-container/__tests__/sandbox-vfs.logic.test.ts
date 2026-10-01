import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleFsOperation } from "../../../../public/sandbox/core/sandbox-fs-handlers.js";
import {
	WORKSPACE_OPS_PENDING_CHANNEL,
	isWorkspacePath,
	materializedWorkspaceFiles,
	mountedWorkspaceDirectories,
	mountedWorkspaceFiles,
	pendingWorkspaceOps,
	queueWorkspaceOp,
	vfsBoolState,
} from "../../../../public/sandbox/core/sandbox-vfs.js";
import { applyWorkspaceHotReload } from "../../../../public/sandbox/runtime/operations.js";
import {
	rememberInstalledPackages,
	runtimeState,
} from "../../../../public/sandbox/runtime/shared.js";

const resetWorkspaceMount = (files: string[] = []) => {
	mountedWorkspaceFiles.clear();
	mountedWorkspaceDirectories.clear();
	materializedWorkspaceFiles.clear();
	pendingWorkspaceOps.length = 0;
	mountedWorkspaceDirectories.add("/");
	for (const file of files) mountedWorkspaceFiles.add(file);
	vfsBoolState.workspaceMountLoaded = true;
};

describe("sandbox workspace live sync", () => {
	const postMessage = vi.fn();

	beforeEach(() => {
		vi.useFakeTimers();
		postMessage.mockClear();
		vi.stubGlobal("window", { parent: { postMessage } });
		resetWorkspaceMount();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		resetWorkspaceMount();
	});

	it("keeps only the last content of a file rewritten in a loop and tells the host once", () => {
		queueWorkspaceOp({ op: "write", path: "/log.txt", content: "1" });
		queueWorkspaceOp({ op: "write", path: "/log.txt", content: "2" });
		queueWorkspaceOp({ op: "mkdir", path: "/out" });
		queueWorkspaceOp({ op: "write", path: "/log.txt", content: "3" });

		expect(pendingWorkspaceOps).toEqual([
			{ op: "write", path: "/log.txt", content: "2" },
			{ op: "mkdir", path: "/out" },
			{ op: "write", path: "/log.txt", content: "3" },
		]);
		expect(postMessage).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(postMessage).toHaveBeenCalledTimes(1);
		expect(postMessage).toHaveBeenCalledWith(
			{ channel: WORKSPACE_OPS_PENDING_CHANNEL },
			"*",
		);
	});

	it("lists and fills only files the runtime holds no content for", async () => {
		resetWorkspaceMount(["/app/server.js", "/app/lib/db.js", "/other.md"]);
		materializedWorkspaceFiles.set("/app/lib/db.js", "sandbox's newer write");

		await expect(
			handleFsOperation(
				"fs.listUnmaterializedWorkspaceFiles",
				{ path: "/app" },
				{},
			),
		).resolves.toEqual({ files: ["/app/server.js"] });

		await expect(
			handleFsOperation(
				"fs.materializeWorkspaceFiles",
				{
					files: [
						{ path: "/app/server.js", content: "host" },
						{ path: "/app/lib/db.js", content: "stale host read" },
						{ path: "/app/deleted.js", content: "gone" },
					],
				},
				{},
			),
		).resolves.toEqual({ materialized: ["/app/server.js"] });
		expect(materializedWorkspaceFiles.get("/app/server.js")).toBe("host");
		expect(materializedWorkspaceFiles.get("/app/lib/db.js")).toBe(
			"sandbox's newer write",
		);
		expect(mountedWorkspaceFiles.has("/app/deleted.js")).toBe(false);
	});

	it("keeps unsaved sandbox writes when a host snapshot arrives without them", async () => {
		resetWorkspaceMount(["/app/old.js"]);
		materializedWorkspaceFiles.set("/app/new.js", "fresh");
		mountedWorkspaceFiles.add("/app/new.js");
		pendingWorkspaceOps.push(
			{ op: "write", path: "/app/new.js", content: "fresh" },
			{ op: "rename", oldPath: "/app/old.js", newPath: "/app/moved.js" },
		);

		await applyWorkspaceHotReload({
			mode: "incremental",
			snapshot: { directories: ["/", "/app"], files: ["/app/old.js"] },
			changes: [],
		});

		expect(mountedWorkspaceFiles.has("/app/new.js")).toBe(true);
		expect(materializedWorkspaceFiles.get("/app/new.js")).toBe("fresh");
		expect(mountedWorkspaceFiles.has("/app/moved.js")).toBe(true);
		expect(mountedWorkspaceFiles.has("/app/old.js")).toBe(false);
	});
});

describe("sandbox workspace path ownership", () => {
	it("keeps source and manifests host-backed", () => {
		expect(isWorkspacePath("/package.json")).toBe(true);
		expect(isWorkspacePath("/src/index.js")).toBe(true);
	});

	it("keeps installed dependency trees sandbox-local", () => {
		expect(isWorkspacePath("/node_modules")).toBe(false);
		expect(isWorkspacePath("/node_modules/lodash/lodash.js")).toBe(false);
	});
});

describe("sandbox package result normalization", () => {
	it("converts provider-native package maps into stable version records", () => {
		runtimeState.installedPackages.clear();
		const normalized = rememberInstalledPackages({
			installed: new Map([
				["lodash", { name: "lodash", version: "4.17.21" }],
				["nanoid", { name: "nanoid", version: "5.1.5" }],
			]),
			added: ["lodash", "nanoid"],
		});

		expect(normalized).toEqual({ lodash: "4.17.21", nanoid: "5.1.5" });
		expect(Object.fromEntries(runtimeState.installedPackages)).toEqual(
			normalized,
		);
	});
});
