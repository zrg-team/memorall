import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	contexts: vi.fn(),
	create: vi.fn(),
	close: vi.fn(),
	set: vi.fn(),
}));
vi.mock("@/services/shared-storage", () => ({
	sharedStorageService: { set: mocks.set },
}));
vi.mock("@/utils/logger", () => ({ logInfo: vi.fn(), logError: vi.fn() }));

describe("offscreen database owner", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		vi.stubGlobal("chrome", {
			runtime: {
				getURL: (path: string) => `chrome-extension://memorall/${path}`,
				getContexts: mocks.contexts,
				ContextType: { OFFSCREEN_DOCUMENT: "OFFSCREEN_DOCUMENT" },
			},
			offscreen: {
				createDocument: mocks.create,
				closeDocument: mocks.close,
				Reason: {
					IFRAME_SCRIPTING: "IFRAME_SCRIPTING",
					USER_MEDIA: "USER_MEDIA",
				},
			},
		});
	});

	it("preserves an existing writer and its progress", async () => {
		mocks.contexts.mockResolvedValue([
			{ documentUrl: "chrome-extension://memorall/offscreen.html", frameId: 0 },
		]);
		const { ensureOffscreenDocument } = await import("./offscreen");
		await ensureOffscreenDocument();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.set).not.toHaveBeenCalled();
	});

	it("resets stale completion before creating a missing writer, once for concurrent callers", async () => {
		mocks.contexts.mockResolvedValue([]);
		mocks.create.mockImplementation(async () => {
			expect(mocks.set).toHaveBeenCalledWith("offscreenProgress", {
				done: false,
				progress: 0,
				status: "Pending",
			});
		});
		const { ensureOffscreenDocument } = await import("./offscreen");
		await Promise.all([ensureOffscreenDocument(), ensureOffscreenDocument()]);
		expect(mocks.create).toHaveBeenCalledOnce();
		expect(mocks.create).toHaveBeenCalledWith(
			expect.objectContaining({ reasons: ["IFRAME_SCRIPTING", "USER_MEDIA"] }),
		);
		expect(mocks.close).not.toHaveBeenCalled();
	});

	it("can retry a failed create", async () => {
		mocks.contexts.mockResolvedValue([]);
		mocks.create.mockRejectedValueOnce(new Error("create failed"));
		const { ensureOffscreenDocument } = await import("./offscreen");
		await expect(ensureOffscreenDocument()).rejects.toThrow("create failed");
		await ensureOffscreenDocument();
		expect(mocks.create).toHaveBeenCalledTimes(2);
	});
});
