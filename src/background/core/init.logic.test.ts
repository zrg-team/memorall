import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	close: vi.fn(),
	ensure: vi.fn(),
	storage: vi.fn(),
	jobs: vi.fn(),
	language: vi.fn(),
	progress: vi.fn(async function* () {
		yield { stage: "ready", progress: 100, status: "completed" };
	}),
}));

vi.mock("@/utils/logger", () => ({ logInfo: vi.fn(), logError: vi.fn() }));

vi.mock("@/services/background-jobs/background-job", () => ({
	backgroundJob: { initialize: mocks.jobs, initializeServices: mocks.progress },
}));
vi.mock("@/services/shared-storage", () => ({
	sharedStorageService: { initialize: mocks.storage },
}));
vi.mock("./offscreen", () => ({
	closeOffscreenDocument: mocks.close,
	ensureOffscreenDocument: mocks.ensure,
}));
vi.mock("./language", () => ({ loadCurrentLanguage: mocks.language }));

describe("background database owner lifecycle", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("reuses the database document on startup without closing an active writer", async () => {
		const { init } = await import("./init");
		await init();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(mocks.ensure).toHaveBeenCalledOnce();
		expect(mocks.progress).toHaveBeenCalledOnce();
		await init();
		expect(mocks.ensure).toHaveBeenCalledOnce();
	});

	it("allows retry after a failed startup without destroying the existing document", async () => {
		mocks.ensure.mockRejectedValueOnce(new Error("not ready"));
		const { init } = await import("./init");
		await init();
		await init();
		expect(mocks.close).not.toHaveBeenCalled();
		expect(mocks.ensure).toHaveBeenCalledTimes(2);
		expect(mocks.progress).toHaveBeenCalledOnce();
	});
});
