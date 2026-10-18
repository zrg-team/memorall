import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	capture: vi.fn(async () => ({
		dataUrl: "data:image/png;base64,AQID",
		width: 1,
		height: 1,
	})),
	getTabSessionForUrl: vi.fn(() => ({ sessionId: "image-session" })),
	fetchImageFromSession: vi.fn(async () => ({
		base64: "AQID",
		mimeType: "image/png",
	})),
	writeFileBytes: vi.fn(async () => {}),
}));

vi.mock("../tools/web/web-tool-registry", () => ({
	captureWebSessionScreenshot: mocks.capture,
	getTabSessionForUrl: mocks.getTabSessionForUrl,
	fetchImageFromSession: mocks.fetchImageFromSession,
	captureImageFromSession: vi.fn(),
	createDefaultWebErrorResult: (error: unknown) =>
		JSON.stringify({ error: String(error) }),
	createWebResult: (payload: unknown) => JSON.stringify(payload),
}));
vi.mock("@memorall/agent-harness-flows/tools/fs/util", () => ({
	writeFileBytes: mocks.writeFileBytes,
}));
vi.mock("../tools/files/util", () => ({
	normalizeDocumentPath: (path: string) => path,
}));
vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import { createWebScreenshotTool } from "../tools/web/web-screenshot";
import {
	createWebFetchImageTool,
	fetchImageBytesFromBrowserSession,
} from "../tools/web/web-fetch-image";
import { createWebReadImagesTool } from "../tools/web/web-read-images";
import { convertToolToOpenAI } from "@memorall/agent-harness-flows/registries/tool-registry";

const screenshot = () => {
	const getOrOpenSession = vi.fn(async () => ({
		session: { id: "s1", currentUrl: "https://example.test/", title: "Page" },
		disposable: false,
	}));
	const tool = createWebScreenshotTool({
		fs: {},
		webBrowser: { getOrOpenSession },
	} as never);
	return { tool, getOrOpenSession };
};

describe("image and screenshot input normalization", () => {
	beforeEach(() => vi.clearAllMocks());

	it.each(["", null, "   "])(
		"captures a session with unused URL and blank file path %j",
		async (blank) => {
			const { tool, getOrOpenSession } = screenshot();
			const input = tool.schema.parse({
				sessionId: "s1",
				url: "not-used",
				browserMode: "not-used",
				file_path: blank,
				timeoutMs: blank,
			});
			const result = JSON.parse((await tool.execute(input)) as string);
			expect(result).toMatchObject({
				success: true,
				file_path: expect.stringMatching(
					/^\/screenshots\/screenshot-\d+\.png$/,
				),
			});
			expect(getOrOpenSession).toHaveBeenCalledWith(
				expect.objectContaining({
					sessionId: "s1",
					url: undefined,
					timeoutMs: 15_000,
				}),
			);
		},
	);

	it("requires a usable session or URL for screenshots", () => {
		const { tool } = screenshot();
		expect(() => tool.schema.parse({ sessionId: "", url: "" })).toThrow(
			"Either sessionId or url",
		);
		expect(() => tool.schema.parse({ url: "not-a-url" })).toThrow();
	});

	it("uses default image paths and session lookup for blank optional values", async () => {
		const tool = createWebFetchImageTool({ fs: {} } as never);
		const result = JSON.parse(
			(await tool.execute(
				tool.schema.parse({
					url: " https://example.test/photo.png ",
					sessionId: "",
					file_path: null,
				}),
			)) as string,
		);
		expect(result).toMatchObject({
			success: true,
			file_path: "/resources/images/photo.png",
		});
		expect(mocks.fetchImageFromSession).toHaveBeenCalledWith(
			"image-session",
			"https://example.test/photo.png",
		);
	});

	it.each(["", "   "])(
		"also resolves a blank session (%j) in direct image-helper calls",
		async (sessionId) => {
			await fetchImageBytesFromBrowserSession(
				"https://example.test/photo.png",
				sessionId,
			);
			expect(mocks.getTabSessionForUrl).toHaveBeenCalled();
			expect(mocks.fetchImageFromSession).toHaveBeenCalledWith(
				"image-session",
				"https://example.test/photo.png",
			);
		},
	);

	it("normalizes image lists, limits the batch, and tolerates blank options", async () => {
		const tool = createWebReadImagesTool({});
		const urls = Array.from(
			{ length: 10 },
			(_, i) => `https://example.test/${i}.png`,
		);
		const parsed = tool.schema.parse({
			urls: ["", null, urls[0], ...urls],
			sessionId: "",
			detail: "",
			save_dir: " ",
		});
		expect(parsed.urls).toEqual(urls.slice(0, 8));
		const result = await tool.execute(parsed);
		expect(result).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: "image_url" })]),
		);
		expect(mocks.writeFileBytes).not.toHaveBeenCalled();
		expect(tool.schema.parse({ urls: urls[0] }).urls).toEqual([urls[0]]);
	});

	it("still requires actual image URLs", () => {
		const tool = createWebReadImagesTool({});
		expect(() => tool.schema.parse({ urls: ["", null] })).toThrow();
		expect(() => tool.schema.parse({ urls: ["not-a-url"] })).toThrow();
	});

	it("keeps model-facing image and screenshot schemas intact", () => {
		const images = convertToolToOpenAI({
			...createWebReadImagesTool({}),
			execute: async () => "",
		});
		expect(images.function.parameters).toMatchObject({
			type: "object",
			required: ["urls"],
			properties: {
				urls: { type: "array", items: { type: "string" } },
				detail: { type: "string", enum: ["auto", "low", "high"] },
			},
		});
		const capture = convertToolToOpenAI({
			...screenshot().tool,
			execute: async () => "",
		});
		expect(capture.function.parameters).toMatchObject({
			type: "object",
			properties: {
				sessionId: { type: "string" },
				url: { type: "string" },
				timeoutMs: { type: "number" },
			},
		});
	});
});
