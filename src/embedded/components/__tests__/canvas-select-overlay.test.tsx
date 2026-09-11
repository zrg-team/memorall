import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CO_AGENT_OVERLAY_ID } from "../overlay-registry";

const mocks = vi.hoisted(() => ({
	captureViewport: vi.fn(),
	cropCapture: vi.fn(),
}));

vi.mock("../../utils/capture-region", async () => {
	const actual = await vi.importActual<
		typeof import("../../utils/capture-region")
	>("../../utils/capture-region");
	return {
		...actual,
		captureViewport: mocks.captureViewport,
		cropCapture: mocks.cropCapture,
	};
});

import { RegionCaptureError } from "../../utils/capture-region";
import {
	CanvasSelectOverlay,
	createCanvasSelectOverlay,
} from "../CanvasSelectOverlay";
import { CANVAS_SELECT_CONTAINER_ID } from "../overlay-registry";

const CAPTURE = "data:image/png;base64,capture";
const CROPPED = "data:image/png;base64,cropped";

let container: HTMLDivElement;
let root: Root;
let dock: HTMLDivElement;

/** Drives the two requestAnimationFrame waits the capture sequence performs. */
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await act(async () => {
			await Promise.resolve();
		});
	}
};

const render = async (props: {
	onSelectContext?: (item: unknown) => void;
	onCancel?: () => void;
}) => {
	await act(async () => {
		root.render(
			<CanvasSelectOverlay
				onSelectContext={props.onSelectContext ?? (() => {})}
				onCancel={props.onCancel ?? (() => {})}
			/>,
		);
	});
	await settle();
};

const surface = () =>
	container.querySelector<HTMLElement>('[data-testid="canvas-select-surface"]');

const drag = async (
	from: { x: number; y: number },
	to: { x: number; y: number },
) => {
	const target = surface();
	if (!target) throw new Error("overlay surface is not rendered");
	await act(async () => {
		target.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				button: 0,
				clientX: from.x,
				clientY: from.y,
			}),
		);
	});
	await act(async () => {
		target.dispatchEvent(
			new PointerEvent("pointermove", {
				bubbles: true,
				clientX: to.x,
				clientY: to.y,
			}),
		);
	});
	await act(async () => {
		target.dispatchEvent(
			new PointerEvent("pointerup", {
				bubbles: true,
				clientX: to.x,
				clientY: to.y,
			}),
		);
	});
	await settle();
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.captureViewport.mockResolvedValue(CAPTURE);
	mocks.cropCapture.mockResolvedValue({
		dataUrl: CROPPED,
		width: 400,
		height: 300,
	});
	// jsdom has no rAF loop worth waiting on; run the callback straight away.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		cb(0);
		return 0;
	});

	dock = document.createElement("div");
	dock.id = CO_AGENT_OVERLAY_ID;
	document.body.appendChild(dock);

	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	document.body.innerHTML = "";
	vi.unstubAllGlobals();
});

describe("CanvasSelectOverlay", () => {
	it("photographs the page with our own UI hidden, and puts it back on close", async () => {
		let dockVisibilityAtCapture: string | null = null;
		mocks.captureViewport.mockImplementation(async () => {
			dockVisibilityAtCapture = dock.style.visibility;
			return CAPTURE;
		});

		await render({});

		// The capture returns the last painted frame, so the dock has to be out of
		// the way before it is taken or it ends up inside the picture.
		expect(dockVisibilityAtCapture).toBe("hidden");
		// It stays hidden for the whole session rather than reappearing over the
		// frozen still, and comes back when the overlay goes away.
		expect(dock.style.visibility).toBe("hidden");

		await act(async () => {
			root.render(null);
		});
		expect(dock.style.visibility).toBe("");
	});

	it("shows nothing until the still is in hand", async () => {
		let resolveCapture: (value: string) => void = () => {};
		mocks.captureViewport.mockReturnValue(
			new Promise<string>((resolve) => {
				resolveCapture = resolve;
			}),
		);

		await render({});
		expect(surface()).toBeNull();

		await act(async () => {
			resolveCapture(CAPTURE);
		});
		await settle();
		expect(surface()).not.toBeNull();
	});

	it("attaches the dragged region as an image", async () => {
		const onSelectContext = vi.fn();
		await render({ onSelectContext });
		await drag({ x: 100, y: 80 }, { x: 300, y: 200 });

		expect(mocks.cropCapture).toHaveBeenCalledWith(
			CAPTURE,
			{ left: 100, top: 80, width: 200, height: 120 },
			expect.objectContaining({ maxEdge: expect.any(Number) }),
		);
		expect(onSelectContext).toHaveBeenCalledTimes(1);
		const item = onSelectContext.mock.calls[0][0];
		expect(item).toMatchObject({ kind: "selected_image", content: CROPPED });
		expect(item.label).toContain("200");
		expect(item.label).toContain("120");
	});

	it("reads a drag the same way whichever corner it started from", async () => {
		await render({});
		await drag({ x: 300, y: 200 }, { x: 100, y: 80 });

		expect(mocks.cropCapture).toHaveBeenCalledWith(
			CAPTURE,
			{ left: 100, top: 80, width: 200, height: 120 },
			expect.objectContaining({ maxEdge: expect.any(Number) }),
		);
	});

	it("shows the size while dragging", async () => {
		await render({});
		const target = surface();
		if (!target) throw new Error("overlay surface is not rendered");

		await act(async () => {
			target.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					button: 0,
					clientX: 10,
					clientY: 10,
				}),
			);
		});
		await act(async () => {
			target.dispatchEvent(
				new PointerEvent("pointermove", {
					bubbles: true,
					clientX: 210,
					clientY: 110,
				}),
			);
		});

		expect(
			container.querySelector('[data-testid="canvas-select-size"]')
				?.textContent,
		).toContain("200 × 100");
	});

	it("ignores a stray click and stays open", async () => {
		const onSelectContext = vi.fn();
		const onCancel = vi.fn();
		await render({ onSelectContext, onCancel });
		await drag({ x: 100, y: 100 }, { x: 103, y: 102 });

		expect(mocks.cropCapture).not.toHaveBeenCalled();
		expect(onSelectContext).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
		expect(surface()).not.toBeNull();
	});

	it("explains a permission failure rather than vanishing", async () => {
		const onCancel = vi.fn();
		mocks.captureViewport.mockRejectedValue(
			new RegionCaptureError("no permission", true),
		);

		await render({ onCancel });

		const panel = container.querySelector(
			'[data-testid="canvas-select-error"]',
		);
		expect(panel).not.toBeNull();
		expect(panel?.textContent).toContain("right-click menu");
		// Cancelling silently is what made this look like a broken feature.
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("reports an ordinary capture failure without blaming permissions", async () => {
		mocks.captureViewport.mockRejectedValue(
			new RegionCaptureError("rate limited", false),
		);

		await render({});

		const panel = container.querySelector(
			'[data-testid="canvas-select-error"]',
		);
		expect(panel?.textContent).toContain("Could not capture");
	});

	it("closes on Escape", async () => {
		const onCancel = vi.fn();
		await render({ onCancel });

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});

		expect(onCancel).toHaveBeenCalled();
	});

	it("stays visible when mounted the way the app mounts it", async () => {
		// Mounted for real the overlay's own container is on the page, and it is
		// in the same hide list as the dock. Hiding ourselves would leave the user
		// clicking the button and seeing nothing at all — which the component-only
		// tests above cannot catch, because that container does not exist there.
		const cleanup = createCanvasSelectOverlay(
			() => {},
			() => {},
		);
		await settle();

		const mounted = document.getElementById(CANVAS_SELECT_CONTAINER_ID);
		expect(mounted).not.toBeNull();
		expect(mounted?.style.visibility).not.toBe("hidden");
		expect(
			mounted?.querySelector('[data-testid="canvas-select-surface"]'),
		).not.toBeNull();
		// The dock is still hidden while the overlay is up.
		expect(dock.style.visibility).toBe("hidden");

		act(() => cleanup());
		await settle();
		expect(dock.style.visibility).toBe("");
	});
});
