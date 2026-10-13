import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Files page uses this hook in three places at once. Each asked the OS for
 * the mapped folders when it mounted and kept its own copy, so mapping or
 * unmapping from the header left the others out of date.
 */

const mocks = vi.hoisted(() => ({
	roots: [{ id: "r1", label: "Notes" }] as Array<{ id: string; label: string }>,
	listRoots: vi.fn(),
	removeRoot: vi.fn(async () => {}),
}));

vi.mock("@/platform/current", () => ({
	platform: {
		nativeFilesystem: {
			listRoots: mocks.listRoots,
			removeRoot: mocks.removeRoot,
		},
		capabilities: { get: () => ({ available: true }) },
	},
}));
vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { notifyExternalChange: vi.fn(async () => {}) },
}));
vi.mock("@/services/filesystem/native-folders/mount-registry", () => ({
	nativeMountLabels: () => mocks.roots.map((root) => root.label),
	nativeMountSandboxPath: (label: string) => `/${label}`,
	syncNativeFolderMounts: vi.fn(async () => {}),
}));

import { useNativeMounts } from "../use-native-mounts";

afterEach(cleanup);

describe("mapped folders on the Files page", () => {
	it("are read once for every part of the page, and a change reaches them all", async () => {
		mocks.listRoots.mockImplementation(async () => [...mocks.roots]);
		const parts = [
			renderHook(() => useNativeMounts()),
			renderHook(() => useNativeMounts()),
			renderHook(() => useNativeMounts()),
		];
		await act(async () => {});
		expect(mocks.listRoots).toHaveBeenCalledTimes(1);
		for (const part of parts) {
			expect([...part.result.current.mountedPaths]).toEqual(["/Notes"]);
		}

		mocks.roots = [];
		await act(async () => {
			await parts[0].result.current.removeRoot("r1");
		});
		for (const part of parts) {
			expect(part.result.current.roots).toEqual([]);
			expect(part.result.current.mountedPaths.size).toBe(0);
			expect(part.result.current.busy).toBe(false);
		}
	});
});
