import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	installDocumentsVfsOverlay,
	materializeMountedWorkspaceFileContent,
	materializedWorkspaceFiles,
	mountedWorkspaceDirectories,
	mountedWorkspaceFiles,
	pendingWorkspaceOps,
	vfsBoolState,
} from "../../../../public/sandbox/core/sandbox-vfs.js";

/** The AlmostNode VFS methods the overlay wraps, for paths outside mounts. */
const createVfs = () =>
	({
		readFileSync: vi.fn(() => new Uint8Array([1, 2, 3])),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		existsSync: vi.fn(() => false),
		statSync: vi.fn(),
		readdirSync: vi.fn(() => []),
	}) as unknown as Record<string, (...args: unknown[]) => unknown>;

/** Node's callback convention, as AlmostNode's fs.readFile/fs.stat use it. */
const viaCallback = <T>(
	call: (callback: (error: unknown, value?: T) => void) => void,
) =>
	new Promise<T>((resolve, reject) => {
		call((error, value) => (error ? reject(error) : resolve(value as T)));
	});

const PAGE = "<h1>Xin chào</h1>";
const PATH = "/notes/landing/index.html";

describe("sandbox workspace reads", () => {
	let onMessage: ((event: { data: unknown }) => void) | undefined;
	const postMessage = vi.fn();

	beforeEach(() => {
		onMessage = undefined;
		postMessage.mockClear();
		vi.stubGlobal("window", {
			parent: { postMessage },
			addEventListener: (_type: string, listener: typeof onMessage) => {
				onMessage = listener;
			},
		});
		mountedWorkspaceFiles.clear();
		mountedWorkspaceDirectories.clear();
		materializedWorkspaceFiles.clear();
		pendingWorkspaceOps.length = 0;
		mountedWorkspaceDirectories.add("/");
		vfsBoolState.workspaceMountLoaded = true;
		materializeMountedWorkspaceFileContent(PATH, PAGE);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		mountedWorkspaceFiles.clear();
		materializedWorkspaceFiles.clear();
	});

	it("gives bytes unless text is asked for, as Node and AlmostNode do", () => {
		const vfs = createVfs();
		installDocumentsVfsOverlay(vfs);

		const bytes = vfs.readFileSync(PATH);
		expect(bytes).toBeInstanceOf(Uint8Array);
		expect(new TextDecoder().decode(bytes as Uint8Array)).toBe(PAGE);
		expect(vfs.readFileSync(PATH, "utf8")).toBe(PAGE);
		expect(vfs.readFileSync(PATH, { encoding: "utf8" })).toBe(PAGE);
		// A server sends the stat size as Content-Length: it must be bytes.
		expect((vfs.statSync(PATH) as { size: number }).size).toBe(
			new TextEncoder().encode(PAGE).byteLength,
		);
	});

	it("keeps an image's bytes as they are: copied in, fetched, or written", async () => {
		// A JPEG header: not UTF-8, so decoding it as text would ruin it.
		const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
		const vfs = createVfs();
		installDocumentsVfsOverlay(vfs);

		materializeMountedWorkspaceFileContent("/notes/landing/og.jpg", JPEG);
		expect(vfs.readFileSync("/notes/landing/og.jpg")).toEqual(JPEG);
		expect(
			(vfs.statSync("/notes/landing/og.jpg") as { size: number }).size,
		).toBe(JPEG.byteLength);
		// UTF-8 bytes are still kept as text.
		materializeMountedWorkspaceFileContent(
			"/notes/landing/a.txt",
			new TextEncoder().encode("chào"),
		);
		expect(materializedWorkspaceFiles.get("/notes/landing/a.txt")).toBe("chào");

		vi.useFakeTimers();
		mountedWorkspaceFiles.add("/notes/landing/font.ttf");
		const read = viaCallback<Uint8Array>((done) =>
			vfs.readFile("/notes/landing/font.ttf", done),
		);
		await vi.advanceTimersByTimeAsync(0);
		const request = postMessage.mock.calls[0]?.[0] as { requestId: string };
		onMessage?.({
			data: {
				channel: "memorall-sandbox-fs-res",
				requestId: request.requestId,
				ok: true,
				result: { content: JPEG },
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		await expect(read).resolves.toEqual(JPEG);

		vfs.writeFileSync("/notes/landing/out.png", JPEG);
		expect(pendingWorkspaceOps.at(-1)).toEqual({
			op: "write",
			path: "/notes/landing/out.png",
			content: JPEG,
		});
	});

	it("answers Node-style callbacks, which a static file server waits on", async () => {
		const vfs = createVfs();
		installDocumentsVfsOverlay(vfs);

		const bytes = await viaCallback<Uint8Array>((done) =>
			vfs.readFile(PATH, done),
		);
		expect(new TextDecoder().decode(bytes)).toBe(PAGE);
		expect(
			await viaCallback<string>((done) => vfs.readFile(PATH, "utf8", done)),
		).toBe(PAGE);
		expect(
			await viaCallback<string>((done) =>
				vfs.readFile(PATH, { encoding: "utf8" }, done),
			),
		).toBe(PAGE);
		const stat = await viaCallback<{ isFile(): boolean }>((done) =>
			vfs.stat(PATH, done),
		);
		expect(stat.isFile()).toBe(true);
		await expect(
			viaCallback((done) => vfs.stat("/notes/landing/missing.css", done)),
		).rejects.toMatchObject({ code: "ENOENT" });
		await expect(
			viaCallback((done) => vfs.access(PATH, done)),
		).resolves.toBeUndefined();
		// The runtime's own callers still await the promise.
		expect(await vfs.readFile(PATH, "utf8")).toBe(PAGE);
		expect(postMessage).not.toHaveBeenCalled();
	});

	it("fetches a file it lacks from the host, and gives up if the host never answers", async () => {
		vi.useFakeTimers();
		const vfs = createVfs();
		installDocumentsVfsOverlay(vfs);
		mountedWorkspaceFiles.add("/notes/landing/style.css");

		const read = viaCallback<string>((done) =>
			vfs.readFile("/notes/landing/style.css", "utf8", done),
		);
		await vi.advanceTimersByTimeAsync(0);
		const request = postMessage.mock.calls[0]?.[0] as { requestId: string };
		onMessage?.({
			data: {
				channel: "memorall-sandbox-fs-res",
				requestId: request.requestId,
				ok: true,
				result: { content: "h1 { color: teal; }" },
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		await expect(read).resolves.toBe("h1 { color: teal; }");
		expect(materializedWorkspaceFiles.get("/notes/landing/style.css")).toBe(
			"h1 { color: teal; }",
		);

		mountedWorkspaceFiles.add("/notes/landing/app.js");
		const stuck = viaCallback((done) =>
			vfs.readFile("/notes/landing/app.js", done),
		);
		const outcome = expect(stuck).rejects.toThrow(
			"The host did not answer fs.readFile for /notes/landing/app.js in time",
		);
		// The host's silence, then the callback it ends in.
		await vi.advanceTimersByTimeAsync(30_000);
		await vi.advanceTimersByTimeAsync(1);
		await outcome;
	});
});
