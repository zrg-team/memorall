import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

import { createContextMenus, MENU_IDS, updateContextMenuText } from "../index";

const LANGUAGES = ["en", "vn"] as const;

const installChromeMenus = () => {
	const created: chrome.contextMenus.CreateProperties[] = [];
	const updated: string[] = [];

	vi.stubGlobal("chrome", {
		runtime: { lastError: undefined },
		contextMenus: {
			removeAll: (callback?: () => void) => callback?.(),
			create: (
				properties: chrome.contextMenus.CreateProperties,
				callback?: () => void,
			) => {
				created.push(properties);
				callback?.();
				return properties.id;
			},
			update: async (id: string) => {
				updated.push(id);
			},
		},
	});

	return { created, updated };
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("context menu registration", () => {
	it.each(LANGUAGES)("registers every menu item in %s", async (language) => {
		const { created } = installChromeMenus();
		await createContextMenus(language);

		const titled = created.filter((item) => item.type !== "separator");
		expect(titled.length).toBeGreaterThan(0);
		for (const item of titled) {
			expect(typeof item.title).toBe("string");
			expect(item.title).not.toBe("");
			expect(item.title).not.toContain("undefined");
		}
	});

	/**
	 * The check that would have caught canvas select being unreachable: its id
	 * was dispatched and handled end to end, but never passed to
	 * chrome.contextMenus.create, so nothing in the UI could ever send it.
	 */
	it("registers every menu id the click handler dispatches", async () => {
		const { created } = installChromeMenus();
		await createContextMenus("en");
		const registered = new Set(created.map((item) => item.id));

		const handlerSource = readFileSync(
			join(__dirname, "..", "handler.ts"),
			"utf-8",
		);
		const dispatched = [
			...handlerSource.matchAll(/id === MENU_IDS\.([A-Z_]+)/g),
		].map((match) => match[1]);

		expect(dispatched.length).toBeGreaterThan(0);

		const unreachable = dispatched.filter((key) => {
			const id = MENU_IDS[key as keyof typeof MENU_IDS];
			expect(id, `MENU_IDS.${key} is dispatched but undefined`).toBeDefined();
			return !registered.has(id);
		});

		// The capture and activity items are dispatched, and even updated in
		// handler.ts, but nothing ever creates them — so they cannot be clicked.
		// Recorded rather than silently tolerated: this list should only ever
		// shrink, and anything new appearing here is a feature wired up but left
		// unreachable.
		expect(unreachable.sort()).toEqual([
			"START_CAPTURE",
			"STOP_CAPTURE",
			"VIEW_ACTIVITIES",
		]);
	});

	it("keeps every registered item's text translatable", async () => {
		const { created } = installChromeMenus();
		await createContextMenus("en");
		const titledIds = created
			.filter((item) => item.type !== "separator")
			.map((item) => item.id);

		const { updated } = installChromeMenus();
		await updateContextMenuText("vn");

		// An item created with a title but missing from the update pass keeps its
		// old language when the user switches.
		for (const id of titledIds) {
			expect(
				updated,
				`${id} is never re-titled on a language change`,
			).toContain(id);
		}
	});
});
