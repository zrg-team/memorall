import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneForCapture } from "../render-dom";

/** A window holding a frame whose page this document can read. */
const windowWithPage = (html: string) => {
	const window = document.createElement("div");
	window.setAttribute("data-memon-window", "");
	const frame = document.createElement("iframe");
	window.appendChild(frame);
	document.body.appendChild(window);
	const page = frame.contentDocument as Document;
	page.open();
	page.write(html);
	page.close();
	return { window, frame, page };
};

describe("capturing a window with a page in a frame", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("draws a readable frame from its page, clipped and on the page's background", async () => {
		const { window, page } = windowWithPage(
			'<html><body style="background-color: rgb(10, 20, 30)"><h1>Hello from localhost</h1><script>void 0</script></body></html>',
		);

		const { clone, ready, documents } = cloneForCapture(window);
		await ready;

		const box = clone?.firstElementChild as HTMLElement;
		expect(box.tagName.toLowerCase()).toBe("div");
		expect(box.style.getPropertyValue("overflow")).toBe("hidden");
		expect(box.style.getPropertyValue("background-color")).toBe(
			"rgb(10, 20, 30)",
		);
		// The page's text is in the picture; its head and scripts are not.
		expect(box.textContent).toContain("Hello from localhost");
		expect(box.querySelector("script")).toBeNull();
		// Its root and body are plain boxes inside the frame's.
		expect(box.querySelector("html, body")).toBeNull();
		// Its fonts are embedded with this page's.
		expect(documents).toEqual([document, page]);
	});

	it("keeps a page's fixed parts in its frame, not at the picture's corner", async () => {
		const { window } = windowWithPage(
			'<html><body><canvas style="position: fixed; inset: 0"></canvas></body></html>',
		);

		const { clone, ready } = cloneForCapture(window);
		await ready;

		const box = clone?.firstElementChild as HTMLElement;
		// A transform makes the box the viewport the fixed canvas sits in.
		expect(box.style.getPropertyValue("transform")).toBe("translate(0px, 0px)");
	});

	it("reads a canvas again once its page has drawn the next frame", async () => {
		const { window, page } = windowWithPage(
			"<html><body><canvas></canvas></body></html>",
		);
		const canvas = page.querySelector("canvas") as HTMLCanvasElement;
		// A WebGL canvas reads blank between frames and drawn right after one.
		canvas.toDataURL = vi
			.fn()
			.mockReturnValueOnce("data:image/png;base64,blank")
			.mockReturnValue("data:image/png;base64,drawn");
		const view = page.defaultView as Window;
		view.requestAnimationFrame = (callback) => {
			setTimeout(() => callback(0));
			return 1;
		};

		const { clone, ready } = cloneForCapture(window);
		await ready;

		expect(clone?.querySelector("img")?.getAttribute("src")).toBe(
			"data:image/png;base64,drawn",
		);
	});

	it("still shows a frame it cannot read as a box", async () => {
		const { window, frame } = windowWithPage("<p>secret</p>");
		Object.defineProperty(frame, "contentDocument", {
			get: () => {
				throw new DOMException("Blocked a frame", "SecurityError");
			},
		});

		const { clone, ready } = cloneForCapture(window);
		await ready;

		const box = clone?.firstElementChild as HTMLElement;
		expect(box.textContent).toBe("");
		expect(box.style.getPropertyValue("border")).toContain("dashed");
	});
});
