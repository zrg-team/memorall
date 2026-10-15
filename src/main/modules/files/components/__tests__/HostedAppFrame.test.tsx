import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	HOSTED_APP_CHANNEL,
	HOSTED_APP_PROTOCOL_VERSION,
} from "@/services/memon/apps/hosted/protocol";

/** The model usage ledger's rows, as booked. */
const booked = vi.hoisted(() => [] as Record<string, unknown>[]);

/** The library: files by path, and its change listeners. */
const disk = vi.hoisted(() => ({
	files: new Map<string, Uint8Array>(),
	listeners: new Set<(change: unknown) => void>(),
}));

const announce = (path: string) => {
	for (const listener of disk.listeners)
		listener({ scope: "documents", operation: "write", path });
};

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: {
		writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
			disk.files.set(path, bytes);
			announce(path);
		}),
		onFilesystemChanged: (listener: (change: unknown) => void) => {
			disk.listeners.add(listener);
			return () => disk.listeners.delete(listener);
		},
	},
}));

vi.mock("@/services/flow-service-adapters", () => ({
	toFlowFileSystem: () => ({
		readFile: async (path: string) => {
			const bytes = disk.files.get(path);
			if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			return bytes;
		},
		stat: async (path: string) => {
			const bytes = disk.files.get(path);
			if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
			return {
				isDirectory: () => false,
				size: bytes.length,
				mtime: new Date(0),
			};
		},
		mkdir: async () => undefined,
		writeFile: async () => undefined,
		readdir: async () => [],
	}),
}));

/** The chosen chat model: streams "Hel", "lo". */
vi.mock("@/services", () => ({
	serviceManager: {
		llmService: {
			getCurrentModel: async () => ({ modelId: "chosen" }),
			getInfo: () => ({ name: "ollama", type: "ollama", ready: true }),
			chatCompletions: async function* () {
				for (const content of ["Hel", "lo"])
					yield {
						model: "chosen",
						choices: [{ index: 0, delta: { content }, finish_reason: null }],
					};
			},
		},
		databaseService: {
			use: async (
				work: (handle: {
					db: unknown;
					schema: { modelUsage: object };
				}) => unknown,
			) =>
				work({
					db: {
						insert: () => ({
							values: async (row: Record<string, unknown>) => {
								booked.push(row);
							},
						}),
					},
					schema: { modelUsage: {} },
				}),
		},
	},
}));

vi.mock("@/platform/current", () => ({
	platform: { assets: { url: (path: string) => `/${path}` } },
}));

vi.mock("@/main/components/molecules/ThemeContext", () => ({
	useTheme: () => ({ actualTheme: "dark" }),
}));

const { HostedAppFrame } = await import("../HostedAppFrame");

const PATH = "/work/Budget.xlsx";
const bytes = (text: string) => new TextEncoder().encode(text);

/** A message from the app inside the frame. */
const fromFrame = (frame: HTMLIFrameElement, body: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					channel: HOSTED_APP_CHANNEL,
					version: HOSTED_APP_PROTOCOL_VERSION,
					...body,
				},
				origin: window.location.origin,
				source: frame.contentWindow,
			}),
		);
	});

const openFrame = async () => {
	render(<HostedAppFrame app="spreadsheet" path={PATH} home="/work" />);
	const frame = document.querySelector("iframe") as HTMLIFrameElement;
	const posted = vi.spyOn(frame.contentWindow as Window, "postMessage");
	fromFrame(frame, { kind: "hello", app: "spreadsheet" });
	await waitFor(() => expect(posted).toHaveBeenCalled());
	return { frame, posted };
};

describe("HostedAppFrame", () => {
	beforeEach(() => {
		disk.files.clear();
		disk.listeners.clear();
		disk.files.set(PATH, bytes("v1"));
	});

	it("opens the app with its file, the home and the theme", async () => {
		const { frame, posted } = await openFrame();
		expect(frame.getAttribute("src")).toBe(
			"/vendors/apps/spreadsheet/index.html",
		);
		const [message, origin] = posted.mock.calls[0] as [
			Record<string, unknown>,
			string,
		];
		expect(origin).toBe(window.location.origin);
		expect(message).toMatchObject({
			kind: "init",
			init: {
				home: "/work",
				theme: "dark",
				launch: [{ path: PATH, name: "Budget.xlsx", is_dir: false, size: 2 }],
			},
		});
	});

	it("answers the app's reads, and its own saves do not reopen it", async () => {
		const { frame, posted } = await openFrame();
		fromFrame(frame, {
			kind: "request",
			id: 7,
			method: "fs.read",
			params: { path: PATH },
		});
		await waitFor(() =>
			expect(posted).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "response",
					id: 7,
					result: expect.objectContaining({
						type: expect.stringContaining("spreadsheetml"),
					}),
				}),
				window.location.origin,
				expect.any(Array),
			),
		);
		const save = bytes("v2 by the user").buffer;
		fromFrame(frame, {
			kind: "request",
			id: 8,
			method: "fs.write",
			params: { path: PATH, bytes: save },
		});
		await waitFor(() =>
			expect(new TextDecoder().decode(disk.files.get(PATH))).toBe(
				"v2 by the user",
			),
		);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(document.querySelector("iframe")).toBe(frame);
	});

	it("opens the file again when someone else changes it", async () => {
		const { frame } = await openFrame();
		act(() => {
			disk.files.set(PATH, bytes("v2 by the agent"));
			announce(PATH);
		});
		await waitFor(
			() => expect(document.querySelector("iframe")).not.toBe(frame),
			{ timeout: 2000 },
		);
		expect(screen.getByRole("status").textContent).toMatch(/Updated/);
	});

	it("answers the app's AI with the chosen model, streaming parts before the response", async () => {
		const { frame, posted } = await openFrame();
		fromFrame(frame, {
			kind: "request",
			id: 9,
			method: "ai.chat",
			params: { messages: [{ role: "user", content: "Hi" }], stream: true },
		});
		await waitFor(() =>
			expect(posted).toHaveBeenCalledWith(
				expect.objectContaining({ kind: "response", id: 9 }),
				window.location.origin,
				[],
			),
		);
		const sent = posted.mock.calls
			.map(([message]) => message as Record<string, unknown>)
			.filter((message) => message.id === 9);
		expect(sent.map((message) => message.kind)).toEqual([
			"part",
			"part",
			"response",
		]);
		expect(sent.slice(0, 2).map((message) => message.part)).toEqual([
			{ type: "text", text: "Hel" },
			{ type: "text", text: "lo" },
		]);
		// Counted on the Usage page: the app, the file, no agent on Files.
		await waitFor(() =>
			expect(booked).toContainEqual(
				expect.objectContaining({
					source: "apps",
					tool: "spreadsheet",
					agentFlowId: null,
					sessionId: `spreadsheet:${PATH}`,
					title: "Spreadsheet · Budget.xlsx",
					provider: "ollama",
					model: "chosen",
				}),
			),
		);
	});

	it("opens Memorall's assistant beside the app when it asks", async () => {
		const { frame, posted } = await openFrame();
		fromFrame(frame, { kind: "notify", event: "assistant" });
		expect(
			await screen.findByRole("complementary", { name: "Assistant" }),
		).toBeTruthy();
		await waitFor(() =>
			expect(posted).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "event",
					event: "assistant",
					payload: true,
				}),
				window.location.origin,
				[],
			),
		);
	});

	it("starts the app again for another file, which it opens", async () => {
		const OTHER = "/work/Forecast.xlsx";
		disk.files.set(OTHER, bytes("other"));
		const { rerender } = render(
			<HostedAppFrame app="spreadsheet" path={PATH} home="/work" />,
		);
		const first = document.querySelector("iframe") as HTMLIFrameElement;
		fromFrame(first, { kind: "hello", app: "spreadsheet" });
		await waitFor(() => expect(screen.queryByText(/Opening/)).toBeNull());

		rerender(<HostedAppFrame app="spreadsheet" path={OTHER} home="/work" />);
		const second = document.querySelector("iframe") as HTMLIFrameElement;
		expect(second).not.toBe(first);
		const posted = vi.spyOn(second.contentWindow as Window, "postMessage");
		fromFrame(second, { kind: "hello", app: "spreadsheet" });
		await waitFor(() =>
			expect(posted).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "init",
					init: expect.objectContaining({
						launch: [expect.objectContaining({ path: OTHER })],
					}),
				}),
				window.location.origin,
				[],
			),
		);
		await waitFor(() => expect(screen.queryByText(/Opening/)).toBeNull());
	});

	it("ignores messages from other windows", async () => {
		render(<HostedAppFrame app="spreadsheet" path={PATH} home="/work" />);
		const frame = document.querySelector("iframe") as HTMLIFrameElement;
		const posted = vi.spyOn(frame.contentWindow as Window, "postMessage");
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						channel: HOSTED_APP_CHANNEL,
						version: HOSTED_APP_PROTOCOL_VERSION,
						kind: "hello",
						app: "spreadsheet",
					},
					origin: "https://elsewhere.example",
					source: frame.contentWindow,
				}),
			);
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(posted).not.toHaveBeenCalled();
	});
});
