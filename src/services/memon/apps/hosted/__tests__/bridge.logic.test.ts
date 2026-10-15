import { describe, expect, it } from "vitest";
import type { HostedAppAi } from "../ai";
import {
	createHostedAppBridge,
	type HostedBridgeEntry,
	HostedBridgeError,
	type HostedBridgeFiles,
	resolveHostedPath,
} from "../bridge";

/** An in-memory disk: files by path, folders as a set. */
const memoryFiles = (initial: Record<string, string> = {}) => {
	const files = new Map<string, Uint8Array>(
		Object.entries(initial).map(([path, text]) => [
			path,
			new TextEncoder().encode(text),
		]),
	);
	const folders = new Set(["/"]);
	const parentOf = (path: string) =>
		path.slice(0, path.lastIndexOf("/")) || "/";
	for (const path of files.keys()) {
		for (let dir = parentOf(path); dir !== "/"; dir = parentOf(dir))
			folders.add(dir);
	}
	const entry = (path: string): HostedBridgeEntry | null =>
		files.has(path)
			? {
					path,
					type: "file",
					size: files.get(path)?.length ?? 0,
					mtimeMs: 1_700_000_000_000,
				}
			: folders.has(path)
				? { path, type: "dir", size: 0, mtimeMs: 1_700_000_000_000 }
				: null;
	const api: HostedBridgeFiles = {
		read: async (path) => {
			const bytes = files.get(path);
			if (!bytes) throw new Error("ENOENT");
			return bytes;
		},
		write: async (path, bytes) => {
			files.set(path, bytes);
		},
		stat: async (path) => entry(path),
		list: async (path) =>
			[...files.keys(), ...folders]
				.filter((child) => child !== path && parentOf(child) === path)
				.map((child) => entry(child) as HostedBridgeEntry),
		mkdir: async (path) => {
			for (let dir = path; dir !== "/"; dir = parentOf(dir)) folders.add(dir);
		},
		remove: async (path) => {
			files.delete(path);
			folders.delete(path);
		},
		move: async (from, to) => {
			const bytes = files.get(from);
			if (!bytes) throw new Error("ENOENT");
			files.delete(from);
			files.set(to, bytes);
		},
		copy: async (from, to) => {
			const bytes = files.get(from);
			if (!bytes) throw new Error("ENOENT");
			files.set(to, bytes.slice());
		},
	};
	return {
		api,
		files,
		text: (path: string) => new TextDecoder().decode(files.get(path)),
	};
};

describe("the open picker", () => {
	it("asks the host, from the open file's folder, and answers one item or a list", async () => {
		const disk = memoryFiles({ "/docs/Plan.pdf": "a", "/docs/Scan.pdf": "b" });
		const asked: unknown[] = [];
		const answers = [
			["/docs/Scan.pdf"],
			["/docs/Plan.pdf", "/docs/Scan.pdf"],
			null,
		];
		const bridge = createHostedAppBridge({
			app: "pdf",
			home: "/agents/bot",
			launchPath: "/docs/Plan.pdf",
			files: disk.api,
			pickFiles: async (request) => {
				asked.push(request);
				return answers.shift() ?? null;
			},
		});
		const one = await bridge.handle("ui.showOpenFilePicker", {
			accept: ".pdf",
		});
		expect(one.result).toMatchObject({ path: "/docs/Scan.pdf" });
		const several = await bridge.handle("ui.showOpenFilePicker", {
			accept: ".pdf",
			multiple: true,
		});
		expect(
			(several.result as Array<{ name: string }>).map((item) => item.name),
		).toEqual(["Plan.pdf", "Scan.pdf"]);
		await expect(
			bridge.handle("ui.showOpenFilePicker", {}),
		).rejects.toMatchObject({ code: "cancelled" });
		expect(asked[0]).toEqual({
			accept: ".pdf",
			multiple: false,
			folder: "/docs",
		});
	});
});

describe("resolveHostedPath", () => {
	it("keeps absolute paths, puts relative ones in the home, and never climbs above the root", () => {
		expect(resolveHostedPath("/agents/bot", "/notes/Plan.docx")).toBe(
			"/notes/Plan.docx",
		);
		expect(resolveHostedPath("/agents/bot", "Spreadsheets/Budget.xlsx")).toBe(
			"/agents/bot/Spreadsheets/Budget.xlsx",
		);
		expect(resolveHostedPath("/agents/bot", "~/a.pdf")).toBe(
			"/agents/bot/a.pdf",
		);
		expect(resolveHostedPath("/agents/bot", "../../../../etc/x")).toBe(
			"/etc/x",
		);
		expect(() => resolveHostedPath("/home", "  ")).toThrow(HostedBridgeError);
	});
});

describe("the hosted app bridge", () => {
	const bridgeOn = (
		disk: ReturnType<typeof memoryFiles>,
		launchPath: string | null = "/docs/Plan.docx",
	) =>
		createHostedAppBridge({
			app: "documents",
			home: "/agents/bot",
			launchPath,
			files: disk.api,
		});

	it("reads a file as bytes with its type, and describes the launch file as Puter does", async () => {
		const disk = memoryFiles({ "/docs/Plan.docx": "docx bytes" });
		const bridge = bridgeOn(disk);
		const { result, transfer } = await bridge.handle("fs.read", {
			path: "/docs/Plan.docx",
		});
		const { bytes, type } = result as { bytes: ArrayBuffer; type: string };
		expect(new TextDecoder().decode(bytes)).toBe("docx bytes");
		expect(type).toContain("wordprocessingml");
		expect(transfer).toEqual([bytes]);
		expect(await bridge.launchItem()).toMatchObject({
			name: "Plan.docx",
			path: "/docs/Plan.docx",
			is_dir: false,
			modified: 1_700_000_000,
		});
	});

	it("answers a missing file with Puter's not-found code", async () => {
		const bridge = bridgeOn(memoryFiles());
		await expect(
			bridge.handle("fs.stat", { path: "nope.xlsx" }),
		).rejects.toMatchObject({
			code: "subject_does_not_exist",
		});
	});

	it("writes into the home, making folders, and finds a free name when asked", async () => {
		const disk = memoryFiles({ "/agents/bot/Spreadsheets/Budget.xlsx": "old" });
		const written: string[] = [];
		const bridge = createHostedAppBridge({
			app: "spreadsheet",
			home: "/agents/bot",
			launchPath: null,
			files: disk.api,
			onWrite: (path) => written.push(path),
		});
		const bytes = new TextEncoder().encode("new").buffer;
		const first = await bridge.handle("fs.write", {
			path: "Spreadsheets/Budget.xlsx",
			bytes,
			dedupeName: true,
		});
		expect(first.result).toMatchObject({
			path: "/agents/bot/Spreadsheets/Budget (2).xlsx",
		});
		await bridge.handle("fs.write", {
			path: "Reports/Q3/Sales.xlsx",
			bytes: new TextEncoder().encode("q3").buffer,
		});
		expect(disk.text("/agents/bot/Reports/Q3/Sales.xlsx")).toBe("q3");
		expect(disk.text("/agents/bot/Spreadsheets/Budget.xlsx")).toBe("old");
		expect(written).toEqual([
			"/agents/bot/Spreadsheets/Budget (2).xlsx",
			"/agents/bot/Reports/Q3/Sales.xlsx",
		]);
	});

	it("refuses to overwrite when the app says not to, and to rename onto a taken name", async () => {
		const disk = memoryFiles({ "/a/One.pdf": "1", "/a/Two.pdf": "2" });
		const bridge = bridgeOn(disk, "/a/One.pdf");
		await expect(
			bridge.handle("fs.write", {
				path: "/a/One.pdf",
				bytes: new ArrayBuffer(1),
				overwrite: false,
			}),
		).rejects.toMatchObject({ code: "item_with_same_name_exists" });
		await expect(
			bridge.handle("fs.rename", { path: "/a/One.pdf", name: "Two.pdf" }),
		).rejects.toMatchObject({
			code: "item_with_same_name_exists",
		});
		const renamed = await bridge.handle("fs.rename", {
			path: "/a/One.pdf",
			name: "Three.pdf",
		});
		expect(renamed.result).toMatchObject({ path: "/a/Three.pdf" });
	});

	it('lists a folder, and saves "Save as" next to the launch file', async () => {
		const disk = memoryFiles({ "/docs/Plan.docx": "x", "/docs/Old.docx": "y" });
		const bridge = bridgeOn(disk);
		const listed = await bridge.handle("fs.readdir", { path: "/docs" });
		expect(
			(listed.result as Array<{ name: string }>)
				.map((item) => item.name)
				.sort(),
		).toEqual(["Old.docx", "Plan.docx"]);
		const saved = await bridge.handle("ui.showSaveFilePicker", {
			bytes: new TextEncoder().encode("copy").buffer,
			name: "Plan.docx",
		});
		expect(saved.result).toMatchObject({ path: "/docs/Plan (2).docx" });
	});

	it("turns the open picker and unknown requests away", async () => {
		const bridge = bridgeOn(memoryFiles());
		await expect(
			bridge.handle("ui.showOpenFilePicker", {}),
		).rejects.toMatchObject({ code: "cancelled" });
		await expect(bridge.handle("fs.upload", {})).rejects.toMatchObject({
			code: "not_supported",
		});
	});
});

describe("the app's AI through the bridge", () => {
	const reply = {
		message: { role: "assistant" as const, content: "Hi." },
		finish_reason: "stop" as const,
		usage: null,
	};
	const bridgeWith = (ai?: HostedAppAi) =>
		createHostedAppBridge({
			app: "presentation",
			home: "/",
			launchPath: null,
			files: memoryFiles().api,
			ai,
		});

	it("answers a whole request with the reply, and a streamed one in parts", async () => {
		const seen: unknown[] = [];
		const ai: HostedAppAi = {
			async chat(params, { onPart } = {}) {
				seen.push(params);
				onPart?.({ type: "text", text: "Hi." });
				return reply;
			},
		};
		const bridge = bridgeWith(ai);

		await expect(
			bridge.handle("ai.chat", { messages: [{ role: "user", content: "x" }] }),
		).resolves.toEqual({ result: reply });

		const parts: unknown[] = [];
		await expect(
			bridge.handle(
				"ai.chat",
				{ messages: [{ role: "user", content: "x" }], stream: true },
				{ onPart: (part) => parts.push(part) },
			),
		).resolves.toEqual({ result: { done: true } });
		expect(parts).toEqual([{ type: "text", text: "Hi." }]);
		expect(seen).toHaveLength(2);
	});

	it("has no AI without a model port", async () => {
		await expect(
			bridgeWith().handle("ai.chat", { messages: [] }),
		).rejects.toMatchObject({ code: "not_supported" });
	});
});
