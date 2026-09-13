import { describe, expect, it, vi } from "vitest";
import { DesktopNativeFilesystemPort } from "./desktop-native-filesystem-port";
import { MutableCapabilityRegistry } from "../core/capability-registry";

/**
 * The port is exercised through an injected `invoke`, the same way
 * `desktop-browser-command-port.logic.test.ts` does, so none of this needs Tauri
 * to be running.
 */

const registry = () =>
	new MutableCapabilityRegistry({
		"filesystem.native": { available: true, requiresAction: "permission" },
	} as never);

type Listen = (
	event: string,
	handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

const portWith = (
	invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>,
	listen?: Listen,
) => {
	const capabilities = registry();
	return {
		capabilities,
		port: new DesktopNativeFilesystemPort(capabilities, invoke, listen),
	};
};

describe("DesktopNativeFilesystemPort", () => {
	it("addresses files by root id and relative path, never by absolute path", async () => {
		const invoke = vi.fn(async () => []);
		const { port } = portWith(invoke);
		await port.list("root-1", "notes/today");
		expect(invoke).toHaveBeenCalledWith("fs_map_list", {
			rootId: "root-1",
			path: "notes/today",
		});
	});

	it("base64-encodes writes rather than sending a byte array", async () => {
		const invoke = vi.fn(async () => undefined);
		const { port } = portWith(invoke);
		await port.write("r", "a.txt", 0, new TextEncoder().encode("foobar"), true);
		expect(invoke).toHaveBeenCalledWith("fs_map_write", {
			rootId: "r",
			path: "a.txt",
			offset: 0,
			dataBase64: "Zm9vYmFy",
			truncate: true,
		});
	});

	it("encodes a payload larger than the argument-spread limit", async () => {
		// String.fromCharCode(...bytes) throws past ~100k arguments, which is an
		// ordinary image, so the encoder has to chunk.
		let recorded: Record<string, unknown> | undefined;
		const { port } = portWith(async (_command, args) => {
			recorded = args;
			return undefined;
		});
		const big = new Uint8Array(300_000).fill(65);
		await expect(
			port.write("r", "big.bin", 0, big, true),
		).resolves.toBeUndefined();
		expect(String(recorded?.dataBase64)).toHaveLength(400_000);
	});

	it("accepts raw bytes back from a read", async () => {
		const source = new TextEncoder().encode("hello");
		const { port } = portWith(async () => source.buffer);
		await expect(port.read("r", "a.txt", 0, -1)).resolves.toEqual(source);
	});

	it("returns null when the user cancels the folder picker", async () => {
		const { port } = portWith(async () => null);
		await expect(port.addRoot()).resolves.toBeNull();
	});

	it("normalises a native failure into an Error carrying its code", async () => {
		const { port } = portWith(async () => {
			throw { code: "OUT_OF_SCOPE", message: "Path resolves outside." };
		});
		await expect(port.stat("r", "../escape")).rejects.toMatchObject({
			code: "OUT_OF_SCOPE",
			message: "Path resolves outside.",
		});
	});

	it("falls back to IO for a failure that is not shaped like one of ours", async () => {
		const { port } = portWith(async () => {
			throw new Error("the bridge went away");
		});
		await expect(port.stat("r", "a.txt")).rejects.toMatchObject({
			code: "IO",
			message: "the bridge went away",
		});
	});

	it("marks the capability unavailable when the native side cannot answer", async () => {
		const { port, capabilities } = portWith(async () => {
			throw new Error("command not found");
		});
		await expect(port.listRoots()).rejects.toThrow();
		// Otherwise the library would offer a "Map folder" action that silently
		// does nothing.
		expect(capabilities.get("filesystem.native").available).toBe(false);
	});

	it("fills in defaults for a malformed entry rather than throwing", async () => {
		const { port } = portWith(async () => [{ name: "a.md", kind: "file" }]);
		await expect(port.list("r", "")).resolves.toEqual([
			{
				name: "a.md",
				kind: "file",
				size: 0,
				mtimeMs: 0,
				birthtimeMs: 0,
				readOnly: false,
			},
		]);
	});

	describe("watching for outside changes", () => {
		const subscribe = async (payload: unknown) => {
			let handler: null | ((event: { payload: unknown }) => void) = null;
			const capture = (next: (event: { payload: unknown }) => void) => {
				handler = next;
			};
			const { port } = portWith(
				async () => undefined,
				async (_event, next) => {
					capture(next);
					return () => {};
				},
			);
			const seen: unknown[] = [];
			await port.watch((change) => seen.push(change));
			(handler as null | ((event: { payload: unknown }) => void))?.({
				payload,
			});
			return seen;
		};

		it("listens on the event the native side emits", async () => {
			const listen = vi.fn(async () => () => {});
			const { port } = portWith(async () => undefined, listen);
			await port.watch(() => {});
			// Must match FS_MAP_CHANGED_EVENT in fs_map.rs.
			expect(listen).toHaveBeenCalledWith(
				"fs-map://changed",
				expect.any(Function),
			);
		});

		it("passes through a change with its root and paths", async () => {
			await expect(
				subscribe({ rootId: "root-1", paths: ["a.md", "sub/b.md"] }),
			).resolves.toEqual([{ rootId: "root-1", paths: ["a.md", "sub/b.md"] }]);
		});

		it("keeps an empty path list, which means refresh everything", async () => {
			await expect(subscribe({ rootId: "root-1", paths: [] })).resolves.toEqual(
				[{ rootId: "root-1", paths: [] }],
			);
		});

		it("ignores a malformed payload rather than throwing in the listener", async () => {
			await expect(subscribe({ paths: ["a.md"] })).resolves.toEqual([]);
			await expect(subscribe(null)).resolves.toEqual([]);
		});

		it("drops non-string entries from the path list", async () => {
			await expect(
				subscribe({ rootId: "root-1", paths: ["a.md", 7, null] }),
			).resolves.toEqual([{ rootId: "root-1", paths: ["a.md"] }]);
		});
	});
});
