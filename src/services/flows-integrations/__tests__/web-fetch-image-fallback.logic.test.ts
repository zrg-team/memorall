import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	fetchImageFromSession: vi.fn(),
	getTabSessionForUrl: vi.fn(
		() => undefined as { sessionId: string } | undefined,
	),
	downloadResourceBytes: vi.fn(),
	captureImageFromSession: vi.fn(),
}));

vi.mock("../tools/web/web-tool-registry", () => ({
	fetchImageFromSession: mocks.fetchImageFromSession,
	getTabSessionForUrl: mocks.getTabSessionForUrl,
	captureImageFromSession: mocks.captureImageFromSession,
	createDefaultWebErrorResult: (error: unknown) => String(error),
	createWebResult: (payload: unknown) => JSON.stringify(payload),
}));

vi.mock("@memorall/agent-harness-flows/utils/download-resource", () => ({
	downloadResourceBytes: mocks.downloadResourceBytes,
	decodeBase64Bytes: (value: string) => new Uint8Array([value.length]),
	filenameFromUrl: () => "image.jpg",
}));

vi.mock("@memorall/agent-harness-flows/tools/fs/util", () => ({
	writeFileBytes: vi.fn(async () => undefined),
}));

vi.mock("@memorall/agent-harness-flows/registries/tool-registry", () => ({
	toolRegistry: { register: vi.fn() },
}));

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logError: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import { fetchImageBytesFromBrowserSession } from "../tools/web/web-fetch-image";

const URL_ = "https://batdongsan.com.vn/photo.jpg";

describe("fetchImageBytesFromBrowserSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getTabSessionForUrl.mockReturnValue(undefined);
		mocks.downloadResourceBytes.mockResolvedValue({
			bytes: new Uint8Array([1, 2, 3]),
			mimeType: "image/jpeg",
		});
		mocks.captureImageFromSession.mockResolvedValue({
			base64: "PNGDATA",
			mimeType: "image/png",
		});
	});

	it("downloads directly when no tab is open", async () => {
		const result = await fetchImageBytesFromBrowserSession(URL_);

		expect(result.bytes).toHaveLength(3);
		expect(mocks.fetchImageFromSession).not.toHaveBeenCalled();
	});

	it("prefers the page's own tab, which carries the site's cookies", async () => {
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "s1" });
		mocks.fetchImageFromSession.mockResolvedValue({
			base64: "AAAA",
			mimeType: "image/png",
		});

		const result = await fetchImageBytesFromBrowserSession(URL_);

		expect(result.sessionId).toBe("s1");
		expect(result.mimeType).toBe("image/png");
		expect(mocks.downloadResourceBytes).not.toHaveBeenCalled();
	});

	it("downloads directly when the session's tab has been closed", async () => {
		// The reported failure: a stale session made the whole call fail on an
		// image a plain download would have returned.
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "dead" });
		mocks.fetchImageFromSession.mockRejectedValue(
			new Error("The browser web session tab was closed."),
		);

		const result = await fetchImageBytesFromBrowserSession(URL_);

		expect(result.bytes).toHaveLength(3);
		expect(result.sessionId).toBe("");
		expect(mocks.downloadResourceBytes).toHaveBeenCalled();
	});

	it("falls back for an iframe session, which cannot fetch at all", async () => {
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "iframe" });
		mocks.fetchImageFromSession.mockRejectedValue(
			new Error("Fetching images via iframe sessions is not supported."),
		);

		await expect(
			fetchImageBytesFromBrowserSession(URL_),
		).resolves.toMatchObject({ mimeType: "image/jpeg" });
	});

	it("opens the image in a tab when neither request can be made to look like the page's", async () => {
		// Measured on a hotlink-protected host: the direct request is refused for
		// having no Referer and the content-script request is blocked by CORS.
		// Only a tab the page itself opens carries the right Referer.
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "s1" });
		mocks.fetchImageFromSession.mockRejectedValue(new Error("Failed to fetch"));
		mocks.downloadResourceBytes.mockRejectedValue(
			new Error("Failed to download resource (status=403)"),
		);

		const result = await fetchImageBytesFromBrowserSession(URL_);

		expect(mocks.captureImageFromSession).toHaveBeenCalledWith("s1", URL_);
		expect(result.mimeType).toBe("image/png");
	});

	it("does not open a tab when a plain download already worked", async () => {
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "dead" });
		mocks.fetchImageFromSession.mockRejectedValue(
			new Error("The browser web session tab was closed."),
		);

		await fetchImageBytesFromBrowserSession(URL_);

		expect(mocks.captureImageFromSession).not.toHaveBeenCalled();
	});

	it("reports all three reasons when nothing works", async () => {
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "dead" });
		mocks.fetchImageFromSession.mockRejectedValue(
			new Error("The browser web session tab was closed."),
		);
		mocks.downloadResourceBytes.mockRejectedValue(
			new Error("Failed to download resource (status=403)"),
		);
		mocks.captureImageFromSession.mockRejectedValue(new Error("popup blocked"));

		await expect(fetchImageBytesFromBrowserSession(URL_)).rejects.toThrow(
			/tab was closed.*status=403.*popup blocked/s,
		);
	});

	it("honours an explicit session id over the guess", async () => {
		mocks.getTabSessionForUrl.mockReturnValue({ sessionId: "guessed" });
		mocks.fetchImageFromSession.mockResolvedValue({
			base64: "AA",
			mimeType: "image/webp",
		});

		await fetchImageBytesFromBrowserSession(URL_, "explicit");

		expect(mocks.fetchImageFromSession).toHaveBeenCalledWith("explicit", URL_);
	});
});
