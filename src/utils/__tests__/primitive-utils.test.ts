import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logDebug: vi.fn(),
	logError: vi.fn(),
	logInfo: vi.fn(),
	logSilent: vi.fn(),
	logWarn: vi.fn(),
	logger: {
		debug: vi.fn(async () => undefined),
		error: vi.fn(async () => undefined),
		info: vi.fn(async () => undefined),
		warn: vi.fn(async () => undefined),
	},
}));

import { ABORT_ERROR_MESSAGE, isAbortError } from "../abort";
import {
	RUNTIME_PANEL_BREAKPOINT,
	isPopupSurface,
	waitForDOMReady,
} from "../dom";
import { openStandalonePage } from "../open-standalone";
import { sanitizeForJson } from "../sanitize-json";
import { v4, isUuid } from "../uuid";
import {
	detectWebGPUAdapter,
	ensureWebGPUSupported,
	isWebGPUSupported,
} from "../webgpu";
import { formatYAML } from "../yaml";

afterEach(() => {
	vi.clearAllMocks();
	Reflect.deleteProperty(globalThis, "chrome");
	Reflect.deleteProperty(globalThis, "document");
	Reflect.deleteProperty(globalThis, "window");
});

describe("abort utilities", () => {
	it("recognizes DOM aborts and the shared abort error message", () => {
		expect(isAbortError(new DOMException("cancelled", "AbortError"))).toBe(
			true,
		);
		expect(
			isAbortError(Object.assign(new Error("x"), { name: "AbortError" })),
		).toBe(true);
		expect(isAbortError(new Error(ABORT_ERROR_MESSAGE))).toBe(true);
		expect(isAbortError(new Error("different"))).toBe(false);
		expect(isAbortError("AbortError")).toBe(false);
	});
});

describe("sanitizeForJson", () => {
	it("normalizes values that JSON cannot represent", () => {
		const circular: Record<string, unknown> = { keep: "value" };
		circular.self = circular;

		expect(
			sanitizeForJson({
				undefinedValue: undefined,
				nil: null,
				big: 10n,
				fn: () => undefined,
				sym: Symbol("s"),
				date: new Date("2024-01-02T03:04:05.000Z"),
				list: [undefined, 2n],
				circular,
			}),
		).toEqual({
			undefinedValue: null,
			nil: null,
			big: "10",
			fn: null,
			sym: null,
			date: "2024-01-02T03:04:05.000Z",
			list: [null, "2"],
			circular: { keep: "value", self: null },
		});
	});
});

describe("formatYAML", () => {
	it("formats empty and nested arguments under the input key", () => {
		expect(formatYAML({})).toBe("input:");
		expect(
			formatYAML({
				file_path: "/notes/todo.md",
				nested: { enabled: true },
			}),
		).toMatchInlineSnapshot(`
			"input:
			  file_path: /notes/todo.md
			  nested:
			    enabled: true"
		`);
	});
});

describe("uuid helpers", () => {
	it("generates and validates the local UUID shape", () => {
		const id = v4();

		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		expect(isUuid(id)).toBe(true);
		expect(isUuid("not-a-uuid")).toBe(false);
		expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
	});
});

describe("DOM utilities", () => {
	it("detects popup surfaces by dataset or URL", () => {
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { documentElement: { dataset: { uiSurface: "popup" } } },
		});
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: { location: { href: "chrome-extension://id/options.html" } },
		});

		expect(RUNTIME_PANEL_BREAKPOINT).toBe(700);
		expect(isPopupSurface()).toBe(true);

		(globalThis.document as any).documentElement.dataset.uiSurface =
			"sidepanel";
		(globalThis.window as any).location.href =
			"chrome-extension://id/popup.html";
		expect(isPopupSurface()).toBe(true);

		(globalThis.window as any).location.href =
			"chrome-extension://id/standalone.html";
		expect(isPopupSurface()).toBe(false);
	});

	it("waits for DOMContentLoaded only while the document is loading", async () => {
		const listeners = new Map<string, () => void>();
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: {
				readyState: "loading",
				addEventListener: vi.fn((event: string, listener: () => void) => {
					listeners.set(event, listener);
				}),
			},
		});

		const ready = waitForDOMReady();
		expect((globalThis.document as any).addEventListener).toHaveBeenCalledWith(
			"DOMContentLoaded",
			expect.any(Function),
		);
		listeners.get("DOMContentLoaded")?.();
		await expect(ready).resolves.toBeUndefined();

		(globalThis.document as any).readyState = "complete";
		await expect(waitForDOMReady()).resolves.toBeUndefined();
	});
});

describe("WebGPU utilities", () => {
	it("checks API presence and adapter availability", async () => {
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: {},
		});

		expect(isWebGPUSupported()).toBe(false);
		expect(() => ensureWebGPUSupported()).toThrow("WebGPU is not available");
		await expect(detectWebGPUAdapter()).resolves.toBe(false);

		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: { gpu: { requestAdapter: vi.fn(async () => ({ name: "gpu" })) } },
		});

		expect(isWebGPUSupported()).toBe(true);
		expect(() => ensureWebGPUSupported()).not.toThrow();
		await expect(detectWebGPUAdapter()).resolves.toBe(true);

		(globalThis.navigator as any).gpu.requestAdapter = vi.fn(async () => null);
		await expect(detectWebGPUAdapter()).resolves.toBe(false);
	});
});

describe("openStandalonePage", () => {
	it("uses openOptionsPage when Chrome accepts it", async () => {
		const openOptionsPage = vi.fn(async () => undefined);
		Object.defineProperty(globalThis, "chrome", {
			configurable: true,
			value: {
				runtime: { openOptionsPage },
			},
		});

		await openStandalonePage();

		expect(openOptionsPage).toHaveBeenCalledTimes(1);
	});

	it("focuses an existing standalone tab when openOptionsPage fails", async () => {
		const updateTab = vi.fn(async () => undefined);
		const updateWindow = vi.fn(async () => undefined);
		Object.defineProperty(globalThis, "chrome", {
			configurable: true,
			value: {
				runtime: {
					openOptionsPage: vi.fn(async () => {
						throw new Error("blocked");
					}),
					getURL: vi.fn(() => "chrome-extension://id/standalone.html"),
				},
				tabs: {
					query: vi.fn(async () => [{ id: 7, windowId: 9 }]),
					update: updateTab,
					create: vi.fn(),
				},
				windows: { update: updateWindow },
			},
		});

		await openStandalonePage();

		expect(updateTab).toHaveBeenCalledWith(7, { active: true });
		expect(updateWindow).toHaveBeenCalledWith(9, { focused: true });
		expect((globalThis.chrome as any).tabs.create).not.toHaveBeenCalled();
	});

	it("creates a standalone tab when no existing tab can be focused", async () => {
		const createTab = vi.fn(async () => undefined);
		Object.defineProperty(globalThis, "chrome", {
			configurable: true,
			value: {
				runtime: {
					openOptionsPage: vi.fn(async () => {
						throw new Error("blocked");
					}),
					getURL: vi.fn(() => "chrome-extension://id/standalone.html"),
				},
				tabs: {
					query: vi.fn(async () => []),
					update: vi.fn(),
					create: createTab,
				},
				windows: { update: vi.fn() },
			},
		});

		await openStandalonePage();

		expect(createTab).toHaveBeenCalledWith({
			url: "chrome-extension://id/standalone.html",
			active: true,
		});
	});
});
