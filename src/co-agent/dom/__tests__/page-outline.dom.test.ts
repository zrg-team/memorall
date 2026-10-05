import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	actOnRef,
	buildPageOutline,
	formatPageOutline,
	type PageOutline,
	StaleOutlineError,
} from "../page-outline";

// jsdom has no layout: every element reports no boxes, which the outline
// reads as "not rendered". Give everything a box so visibility checks pass.
const stubLayout = () => {
	vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
		() => [{ width: 10, height: 10 }] as unknown as DOMRectList,
	);
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
		() =>
			({
				top: 0,
				left: 0,
				right: 100,
				bottom: 20,
				width: 100,
				height: 40,
				x: 0,
				y: 0,
			}) as DOMRect,
	);
};

describe("page outline", () => {
	beforeEach(() => {
		stubLayout();
		document.title = "Evals";
		document.body.innerHTML = `
			<nav><a href="/home">Home</a></nav>
			<h1>Grade the trajectory</h1>
			<p>Most evals check only the final answer.</p>
			<img src="https://example.com/figure.png" alt="Figure 1">
			<ul><li>Right tool</li><li>Valid arguments</li></ul>
			<form method="get" action="/search"><input name="q" placeholder="Search"><button>Go</button></form>
			<form method="post" action="/subscribe"><button>Subscribe</button></form>
			<input type="password" name="password" value="secret">
			<p hidden>Hidden text</p>
		`;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
	});

	it("lists headings, text and refs for controls and images", () => {
		const outline = buildPageOutline(document);
		const text = formatPageOutline(outline);

		expect(outline.title).toBe("Evals");
		expect(text).toContain("# Grade the trajectory");
		expect(text).toContain("Most evals check only the final answer.");
		expect(text).toMatch(/\[b\d+\] link "Home"/);
		expect(text).toMatch(/\[b\d+\] img 100×40 "Figure 1"/);
		expect(text).toContain("- Right tool\n- Valid arguments");
		expect(text).toMatch(/\[b\d+\] input "q" placeholder="Search"/);
		expect(text).toMatch(/\[b\d+\] button "Subscribe" \(submits a form\)/);
		expect(text).not.toContain("Hidden text");
		// A password field is listed but never shows its value.
		expect(text).not.toContain("secret");
	});

	it("reads what a box-less wrapper (display: contents) draws", () => {
		const wrapper = document.createElement("div");
		wrapper.style.display = "contents";
		wrapper.innerHTML =
			'<section><h2>Daily Papers</h2><a href="/papers/2509.00001">The Other Half of the Memory Wall</a></section>';
		document.body.append(wrapper);
		// As in a browser: the wrapper itself has no box.
		const rects = vi.mocked(Element.prototype.getClientRects);
		rects.mockImplementation(function (this: Element) {
			return (this === wrapper
				? []
				: [{ width: 10, height: 10 }]) as unknown as DOMRectList;
		});

		const text = formatPageOutline(buildPageOutline(document));
		expect(text).toContain("## Daily Papers");
		expect(text).toMatch(/\[b\d+\] link "The Other Half of the Memory Wall"/);
	});

	it("says the page is busy while it shows a loading region or spinner", () => {
		expect(buildPageOutline(document).busy).toBeUndefined();

		const main = document.createElement("main");
		main.setAttribute("aria-busy", "true");
		document.body.append(main);
		expect(buildPageOutline(document).busy).toBe(true);

		main.setAttribute("aria-busy", "false");
		const spinner = document.createElement("div");
		spinner.setAttribute("role", "progressbar");
		document.body.append(spinner);
		expect(buildPageOutline(document).busy).toBe(true);

		// A progress bar with a value is content, like "3 of 5 done".
		spinner.setAttribute("aria-valuenow", "60");
		expect(buildPageOutline(document).busy).toBeUndefined();

		// A loading indicator the page has hidden does not count.
		main.setAttribute("aria-busy", "true");
		main.hidden = true;
		expect(buildPageOutline(document).busy).toBeUndefined();
	});

	it("keeps refs stable across reads of the same document", () => {
		const first = buildPageOutline(document);
		const second = buildPageOutline(document);
		expect(second.docToken).toBe(first.docToken);
		expect(formatPageOutline(second)).toBe(formatPageOutline(first));
	});

	it("types into a field and dispatches input and change events", () => {
		const outline = buildPageOutline(document);
		const input = outline.blocks.find((block) => block.kind === "input");
		if (!input || input.kind !== "input") throw new Error("no input");
		const field = document.querySelector("input[name=q]") as HTMLInputElement;
		const events: string[] = [];
		field.addEventListener("input", () => events.push("input"));
		field.addEventListener("change", () => events.push("change"));

		const result = actOnRef(document, {
			ref: input.ref,
			docToken: outline.docToken,
			action: "input",
			value: "agent quality",
		});

		expect(result.ok).toBe(true);
		expect(field.value).toBe("agent quality");
		expect(events).toEqual(["input", "change"]);
	});

	it("asks for approval before a click submits a POST form", () => {
		const outline = buildPageOutline(document);
		const subscribe = outline.blocks.find(
			(block) => block.kind === "button" && block.text === "Subscribe",
		);
		if (!subscribe || subscribe.kind !== "button") throw new Error("no button");
		const submit = vi.fn((event: Event) => event.preventDefault());
		document.forms[1].addEventListener("submit", submit);

		const gated = actOnRef(document, {
			ref: subscribe.ref,
			docToken: outline.docToken,
			action: "click",
		});
		expect(gated).toMatchObject({ ok: false, needsApproval: "form-submit" });
		expect(submit).not.toHaveBeenCalled();
	});

	it("rejects a ref read from another document as a stale screen", () => {
		const outline = buildPageOutline(document);
		const link = outline.blocks.find((block) => block.kind === "link");
		if (!link || link.kind !== "link") throw new Error("no link");

		expect(() =>
			actOnRef(document, {
				ref: link.ref,
				docToken: "d-some-other-page",
				action: "click",
			}),
		).toThrow(StaleOutlineError);
	});

	it("refuses sensitive fields", () => {
		const outline = buildPageOutline(document);
		const password = outline.blocks.find(
			(block) => block.kind === "input" && block.inputType === "password",
		);
		if (!password || password.kind !== "input") throw new Error("no field");
		expect(() =>
			actOnRef(document, {
				ref: password.ref,
				docToken: outline.docToken,
				action: "input",
				value: "hunter2",
			}),
		).toThrow();
	});
});

describe("page outline controls", () => {
	/** The ref of the first block whose text or label is `name`. */
	const refOf = (outline: PageOutline, name: string): string => {
		for (const block of outline.blocks) {
			const text =
				"text" in block ? block.text : "label" in block ? block.label : "";
			if (text === name && "ref" in block && block.ref) return block.ref;
		}
		throw new Error(`no ref for ${name}`);
	};

	/** jsdom draws nothing; say what is drawn at every point. */
	const drawAt = (element: Element) => {
		Object.defineProperty(document, "elementFromPoint", {
			configurable: true,
			value: vi.fn(() => element),
		});
	};

	beforeEach(() => {
		stubLayout();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		Reflect.deleteProperty(document, "elementFromPoint");
		document.body.innerHTML = "";
	});

	it("labels the page's own controls, with their state, editors and canvases", () => {
		document.body.innerHTML = `
			<div role="switch" aria-checked="true">Dark mode</div>
			<div style="cursor: pointer">Open settings</div>
			<span tabindex="0">Menu</span>
			<label><input type="checkbox" name="remember" checked> Remember me</label>
			<div contenteditable="true" aria-label="Message">Hi</div>
			<details><summary>More</summary></details>
			<canvas aria-label="Chart"></canvas>
			<div style="cursor: pointer"><button>Inner</button></div>
		`;
		const outline = buildPageOutline(document);
		const text = formatPageOutline(outline);

		expect(text).toMatch(/\[b\d+\] switch "Dark mode" \(checked\)/);
		expect(text).toMatch(/\[b\d+\] button "Open settings"/);
		expect(text).toMatch(/\[b\d+\] button "Menu"/);
		expect(text).toMatch(/\[b\d+\] checkbox "Remember me" \(checked\)/);
		expect(text).toMatch(/\[b\d+\] input textbox "Message" value="Hi"/);
		expect(text).toMatch(/\[b\d+\] button "More" \(collapsed\)/);
		expect(text).toMatch(/\[b\d+\] canvas "Chart" 100×40 at 0,0/);
		// A clickable wrapper around a control lists the control, once.
		expect(text.match(/"Inner"/g)).toHaveLength(1);
		expect(outline.scroll.viewportWidth).toBe(window.innerWidth);
	});

	it("describes any ref with its box to picture it, and an image with its address", () => {
		document.body.innerHTML = `
			<canvas aria-label="Game"></canvas>
			<img src="/logo.png" alt="Logo" width="64" height="64">
		`;
		const outline = buildPageOutline(document);
		const canvas = actOnRef(document, {
			action: "describe",
			ref: refOf(outline, "Game"),
			docToken: outline.docToken,
		});
		expect(canvas).toMatchObject({
			ok: true,
			detail: "",
			box: {
				x: 0,
				y: 0,
				width: 100,
				height: 40,
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
			},
		});
		const image = outline.blocks.find((block) => block.kind === "image");
		if (image?.kind !== "image") throw new Error("no image block");
		expect(
			actOnRef(document, {
				action: "describe",
				ref: image.ref,
				docToken: outline.docToken,
			}),
		).toMatchObject({
			ok: true,
			detail: expect.stringMatching(/\/logo\.png$/),
		});
	});

	it("clicks with the events a pointer makes, not a bare click()", () => {
		document.body.innerHTML = `<div role="option">Apple</div>`;
		const outline = buildPageOutline(document);
		const option = document.querySelector('[role="option"]') as HTMLElement;
		const events: string[] = [];
		for (const type of [
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]) {
			option.addEventListener(type, () => events.push(type));
		}

		actOnRef(document, {
			ref: refOf(outline, "Apple"),
			docToken: outline.docToken,
			action: "click",
		});
		expect(events).toEqual([
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click",
		]);
	});

	it("clicks a viewport point and says what it landed on", () => {
		document.body.innerHTML = "<button>Save</button>";
		const outline = buildPageOutline(document);
		const button = document.querySelector("button") as HTMLButtonElement;
		drawAt(button);
		let clicked: MouseEvent | undefined;
		button.addEventListener("click", (event) => {
			clicked = event;
		});

		const result = actOnRef(document, {
			action: "click",
			x: 40,
			y: 12,
			docToken: outline.docToken,
		});
		expect(clicked).toMatchObject({ clientX: 40, clientY: 12 });
		expect(result).toMatchObject({
			ok: true,
			detail: `at (40, 12) on ${refOf(outline, "Save")} "Save"`,
		});
		expect(() =>
			actOnRef(document, { action: "click", x: 40, y: 99_999 }),
		).toThrow(/outside the viewport/);
	});

	it("clicks a point inside a ref, from its top-left corner", () => {
		document.body.innerHTML = `<canvas aria-label="Board"></canvas>`;
		const outline = buildPageOutline(document);
		const canvas = document.querySelector("canvas") as HTMLCanvasElement;
		drawAt(canvas);
		const points: Array<[number, number]> = [];
		canvas.addEventListener("click", (event) =>
			points.push([event.clientX, event.clientY]),
		);
		const ref = refOf(outline, "Board");

		actOnRef(document, { ref, action: "click", x: 30, y: 20 });
		expect(points).toEqual([[30, 20]]);
		expect(() =>
			actOnRef(document, { ref, action: "click", x: 500, y: 20 }),
		).toThrow(/100×40/);
	});

	it("asks before a click by position sends a POST form", () => {
		document.body.innerHTML = `<form method="post"><button>Pay <span>now</span></button></form>`;
		buildPageOutline(document);
		drawAt(document.querySelector("span") as HTMLElement);
		const submit = vi.fn((event: Event) => event.preventDefault());
		document.forms[0].addEventListener("submit", submit);

		const result = actOnRef(document, { action: "click", x: 5, y: 5 });
		expect(result).toMatchObject({ ok: false, needsApproval: "form-submit" });
		expect(submit).not.toHaveBeenCalled();
	});

	it("presses keys on the focused element, with Tab and Enter doing their part", () => {
		document.body.innerHTML = `<input name="q"><button>Go</button>`;
		buildPageOutline(document);
		const field = document.querySelector("input") as HTMLInputElement;
		const button = document.querySelector("button") as HTMLButtonElement;
		const keys: string[] = [];
		document.addEventListener("keydown", (event) =>
			keys.push(`${(event.target as Element).localName}:${event.key}`),
		);
		const clicks = vi.fn();
		button.addEventListener("click", clicks);
		field.focus();

		actOnRef(document, { action: "press", value: "Escape" });
		expect(keys).toEqual(["input:Escape"]);

		const tabbed = actOnRef(document, { action: "press", value: "Tab" });
		expect(document.activeElement).toBe(button);
		expect(tabbed.ok && tabbed.detail).toMatch(/^focus moved to b\d+ "Go"$/);

		actOnRef(document, { action: "press", value: "Enter" });
		expect(clicks).toHaveBeenCalledTimes(1);
		expect(() =>
			actOnRef(document, { action: "press", value: "Hyper" }),
		).toThrow(/Unknown key/);
	});

	it("toggles a checkbox to the state asked for", () => {
		document.body.innerHTML = `<label><input type="checkbox" name="news"> News</label>`;
		const outline = buildPageOutline(document);
		const box = document.querySelector("input") as HTMLInputElement;
		const ref = refOf(outline, "News");

		expect(
			actOnRef(document, { ref, action: "toggle", value: "on" }),
		).toMatchObject({ ok: true, detail: "turned on" });
		expect(box.checked).toBe(true);
		expect(
			actOnRef(document, { ref, action: "toggle", value: "on" }),
		).toMatchObject({ ok: true, detail: "already on" });
		expect(box.checked).toBe(true);
	});

	it("types into a rich-text editor", () => {
		document.body.innerHTML = `<div contenteditable="true" aria-label="Message"></div>`;
		const outline = buildPageOutline(document);
		const editor = document.querySelector("[contenteditable]") as HTMLElement;
		const inputs = vi.fn();
		editor.addEventListener("input", inputs);

		actOnRef(document, {
			ref: refOf(outline, "Message"),
			action: "input",
			value: "Hello",
		});
		expect(editor.textContent).toBe("Hello");
		expect(inputs).toHaveBeenCalled();
	});

	it("scrolls the area a ref is in, and says where it stopped", () => {
		document.body.innerHTML = `<div style="overflow-y: auto"><button>Item 1</button></div>`;
		const outline = buildPageOutline(document);
		const list = document.querySelector("div") as HTMLDivElement;
		Object.defineProperties(list, {
			scrollHeight: { value: 1000 },
			clientHeight: { value: 200 },
			scrollTop: { value: 0, writable: true },
		});
		list.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
			if (typeof options === "object") list.scrollTop = options.top ?? 0;
		}) as typeof list.scrollTo;
		const ref = refOf(outline, "Item 1");

		const result = actOnRef(document, {
			ref,
			action: "scrollScreen",
			value: "down",
		});
		expect(list.scrollTop).toBe(170);
		expect(result).toMatchObject({
			ok: true,
			detail: `${ref}'s scroll area is at 170 of 800 px down.`,
		});
	});

	it("hovers without clicking", () => {
		document.body.innerHTML = `<button aria-haspopup="menu">Account</button>`;
		const outline = buildPageOutline(document);
		const button = document.querySelector("button") as HTMLButtonElement;
		const seen: string[] = [];
		for (const type of ["mouseover", "mousemove", "click"]) {
			button.addEventListener(type, () => seen.push(type));
		}

		actOnRef(document, { ref: refOf(outline, "Account"), action: "hover" });
		expect(seen).toEqual(["mouseover", "mousemove"]);
	});
});
