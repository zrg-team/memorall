import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from "@/constants/language";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/platform/current", () => ({
	platform: { persistentStore: { get } },
}));
vi.mock("@/utils/logger", () => ({ logWarn: vi.fn() }));

import { loadLanguageFromStorage } from "./config";

describe("embedded reader language storage", () => {
	beforeEach(() => {
		get.mockReset();
	});

	it.each(["en", "vn"])(
		"loads %s through the current platform",
		async (language) => {
			get.mockResolvedValue(language);
			await expect(loadLanguageFromStorage()).resolves.toBe(language);
			expect(get).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY);
		},
	);

	it("uses the default when the saved language is unsupported", async () => {
		get.mockResolvedValue("unsupported");
		await expect(loadLanguageFromStorage()).resolves.toBe(DEFAULT_LANGUAGE);
	});

	it("uses the default when storage is unavailable", async () => {
		get.mockRejectedValue(new Error("Storage unavailable"));
		await expect(loadLanguageFromStorage()).resolves.toBe(DEFAULT_LANGUAGE);
	});
});
