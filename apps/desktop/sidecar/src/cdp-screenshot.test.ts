import { describe, expect, it, vi } from "vitest";
import {
	BrowserAutomationError,
	type BrowserCommand,
	SCREENSHOT_MAX_HEIGHT,
	screenshotClip,
	screenshotOptions,
} from "./browser-runtime-types";
import { captureCdpPage } from "./chromium-cdp-backend";

const layout = {
	cssLayoutViewport: {
		pageX: 0,
		pageY: 400,
		clientWidth: 1280,
		clientHeight: 800,
	},
	cssContentSize: { width: 1280, height: 3000 },
};

/** A PNG's header bytes, enough for its size to be read. */
const png = (width: number, height: number) => {
	const bytes = Buffer.alloc(24);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes.toString("base64");
};

describe("the part of the page a desktop screenshot keeps", () => {
	it("clips in page coordinates, as CDP takes them", () => {
		// A rectangle of the viewport moves with the page's scroll.
		expect(
			screenshotClip(
				{ clip: { x: 10, y: 20, width: 300, height: 100 } },
				layout,
			),
		).toEqual({
			clip: { x: 10, y: 420, width: 300, height: 100, scale: 1 },
			cut: false,
		});
		expect(screenshotClip({ fullPage: true }, layout)).toEqual({
			clip: { x: 0, y: 0, width: 1280, height: 3000, scale: 1 },
			cut: false,
		});
		expect(
			screenshotClip(
				{ fullPage: true },
				{ ...layout, cssContentSize: { width: 1280, height: 90_000 } },
			),
		).toEqual({
			clip: {
				x: 0,
				y: 0,
				width: 1280,
				height: SCREENSHOT_MAX_HEIGHT,
				scale: 1,
			},
			cut: true,
		});
		expect(() =>
			screenshotClip({ clip: { x: 0, y: 900, width: 10, height: 10 } }, layout),
		).toThrow(BrowserAutomationError);
	});

	it("reads the options of a screenshot command, and refuses a broken clip", () => {
		const command = (extra: Record<string, unknown>) =>
			({ command: "screenshot", sessionId: "s", ...extra }) as BrowserCommand;
		expect(screenshotOptions(command({}))).toEqual({});
		expect(
			screenshotOptions(
				command({ fullPage: true, clip: { x: 1, y: 2, width: 3, height: 4 } }),
			),
		).toEqual({ fullPage: true, clip: { x: 1, y: 2, width: 3, height: 4 } });
		expect(() => screenshotOptions(command({ clip: { x: 1 } }))).toThrow(
			"x, y, width and height",
		);
	});

	it("asks Chromium to paint the whole page beyond the viewport", async () => {
		const send = vi.fn(
			async (
				method: string,
				_params?: Record<string, unknown>,
				_signal?: AbortSignal,
				_timeoutMs?: number,
			) =>
				method === "Page.getLayoutMetrics"
					? layout
					: method === "Runtime.evaluate"
						? { result: { value: { x: 0, y: 400 } } }
						: { data: png(1280, 3000) },
		);
		const picture = await captureCdpPage({ send } as never, { fullPage: true });

		// From the top, so a sticky header is drawn where it starts; then back.
		expect(send.mock.calls.map(([method]) => method)).toEqual([
			"Runtime.evaluate",
			"Page.getLayoutMetrics",
			"Page.captureScreenshot",
			"Runtime.evaluate",
		]);
		expect(send.mock.calls[0]?.[1]?.expression).toContain(
			"scrollTo({ left: 0, top: 0",
		);
		expect(send).toHaveBeenCalledWith(
			"Page.captureScreenshot",
			{
				format: "png",
				fromSurface: true,
				captureBeyondViewport: true,
				clip: { x: 0, y: 0, width: 1280, height: 3000, scale: 1 },
			},
			undefined,
			90_000,
		);
		expect(send.mock.calls[3]?.[1]?.expression).toContain("top: 400");
		expect(picture).toMatchObject({ width: 1280, height: 3000 });
		expect(picture.cut).toBeUndefined();

		// The plain viewport needs no metrics.
		send.mockClear();
		await captureCdpPage({ send } as never, {});
		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0]?.[1]).toEqual({
			format: "png",
			fromSurface: true,
			captureBeyondViewport: false,
		});
	});
});
