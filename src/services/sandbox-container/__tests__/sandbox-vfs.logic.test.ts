import { describe, expect, it } from "vitest";
import { isWorkspacePath } from "../../../../public/sandbox/core/sandbox-vfs.js";
import {
	rememberInstalledPackages,
	runtimeState,
} from "../../../../public/sandbox/runtime/shared.js";

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
		expect(Object.fromEntries(runtimeState.installedPackages)).toEqual(normalized);
	});
});
