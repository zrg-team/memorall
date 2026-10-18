import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseToolInput } from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { convertToolToOpenAI } from "@memorall/agent-harness-flows/registries/tool-registry";

vi.mock("@/services/memon/machine-registry", () => ({
	getMemonMachine: vi.fn(),
}));

import { getMemonMachine } from "@/services/memon/machine-registry";
import { createMemonActTool } from "../memon-act";

const PICTURE = "data:image/png;base64,AAAA";

/** The computer as describe uses it. */
const fakeMachine = (options: {
	looks: boolean;
	capture?: () => Promise<unknown>;
	/** The image the Viewer shows in front, if any. */
	viewer?: string;
}) => ({
	fileRefPath: vi.fn(() => "/agents/Bot/shots/hero.png"),
	resolvePath: vi.fn((path: string) =>
		path.startsWith("~/") ? `/agents/Bot/${path.slice(2)}` : path,
	),
	isFolder: vi.fn(async () => false),
	openFolder: vi.fn(async () => {}),
	pictureOfFile: vi.fn(async () => ({
		dataUrl: PICTURE,
		width: 640,
		height: 360,
	})),
	viewerImage: () => options.viewer ?? null,
	home: "/agents/Bot",
	beginRun: vi.fn(),
	waitForAgentTurn: async () => "ready",
	runAgentAction: async (
		_label: string,
		_target: unknown,
		body: () => Promise<unknown>,
	) => body(),
	readScreen: () => "screen",
	snapshot: () => ({ revision: 1, focusedWindowId: null, windows: [] }),
	findWindow: () => undefined,
	captureRef: vi.fn(
		options.capture ??
			(async () => ({ dataUrl: PICTURE, width: 880, height: 594 })),
	),
	modelAcceptsImages: async () => options.looks,
	savePicture: vi.fn(async () => "/agents/Bot/Pictures/b1-picture.png"),
	browserAction: vi.fn(async () => ({
		ok: true,
		action: "describe",
		ref: "b1",
		detail: "http://localhost:8347/logo.png",
	})),
});

const describeRef = async (machine: ReturnType<typeof fakeMachine>) => {
	vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
	return createMemonActTool().execute(
		{ ref: "b1", action: "describe" },
		undefined,
	);
};

describe("memon_act arguments", () => {
	const parse = (input: unknown) => {
		const tool = createMemonActTool();
		return parseToolInput<Parameters<typeof tool.execute>[0]>(
			tool.schema,
			input,
			tool.name,
		);
	};

	it("executes a click with unused screenshot and tab placeholders", async () => {
		const machine = fakeMachine({ looks: true });
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const input = parse({
			ref: "b23",
			action: "click",
			text: "",
			path: "",
			x: 0,
			y: 0,
			capture: "view",
			region: { x: 0, y: 0, width: 0, height: 0 },
			to: "",
			submit: false,
			direction: "down",
			tab: 0,
		});
		const result = await createMemonActTool().execute(input, undefined);
		expect(machine.browserAction).toHaveBeenCalledWith({
			ref: "b23",
			action: "click",
			x: 0,
			y: 0,
		});
		expect(result).toMatchObject({
			structuredContent: { ok: true },
			content: expect.stringContaining("Clicked b23"),
		});
	});

	it("needs only an action and ref to click, and preserves empty text to clear a field", () => {
		expect(parse({ action: "click", ref: "b23" })).toEqual({
			action: "click",
			ref: "b23",
		});
		expect(parse({ action: "type", ref: "b2", text: "", tab: 0 }).text).toBe(
			"",
		);
	});

	it.each(["width", "height"] as const)(
		"explains how to fix an invalid screenshot region %s",
		(dimension) => {
			expect(() =>
				parse({
					action: "screenshot",
					region: { x: 0, y: 0, width: 10, height: 10, [dimension]: 0 },
				}),
			).toThrow(
				`region.${dimension}: screenshot: ${dimension} must be at least 1 CSS pixel; omit region to capture the current view.`,
			);
		},
	);

	it.each(["select_tab", "close_tab"] as const)(
		"validates tab numbers only for %s",
		(action) => {
			for (const tab of [0, -1, 1.5]) {
				expect(() => parse({ action, tab })).toThrow(
					`${action}: tab must be a whole number starting at 1, as listed on the screen.`,
				);
			}
			expect(parse({ action, tab: 1 }).tab).toBe(1);
			expect(
				parse({ action, tab: 1, region: { x: 0, y: 0, width: 0, height: 0 } })
					.tab,
			).toBe(1);
			// Missing tab numbers still get the runtime's list of open tabs.
			expect(parse({ action })).toEqual({ action });
		},
	);

	it("keeps the advertised parameters as an object with only action required", () => {
		const parameters = convertToolToOpenAI({
			...createMemonActTool(),
			execute: async () => "",
		}).function.parameters;
		expect(parameters).toMatchObject({
			type: "object",
			required: ["action"],
			properties: {
				region: { type: "object" },
				tab: { type: "number" },
			},
		});
	});
});

describe("memon_act describe", () => {
	it("uses the image path in text when the optional path is blank", async () => {
		const machine = fakeMachine({ looks: true });
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		await createMemonActTool().execute(
			{ action: "describe", path: "", text: "~/assets/hero.webp" },
			undefined,
		);
		expect(machine.pictureOfFile).toHaveBeenCalledWith(
			"/agents/Bot/assets/hero.webp",
		);
	});

	it("inspects the exact image path returned by search without guessing a screen ref", async () => {
		const machine = fakeMachine({ looks: true });
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const result = await createMemonActTool().execute(
			{ action: "describe", path: "~/assets/portraits.webp" },
			undefined,
		);
		expect(machine.pictureOfFile).toHaveBeenCalledWith(
			"/agents/Bot/assets/portraits.webp",
		);
		expect(machine.fileRefPath).not.toHaveBeenCalled();
		expect(machine.captureRef).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			content: [{ type: "text" }, { type: "image_url" }],
		});
	});
	it.each([true, false])(
		"opens a folder ref for browsing instead of trying to describe it, vision %s",
		async (looks) => {
			const machine = fakeMachine({ looks });
			machine.fileRefPath.mockReturnValue("/agents/Bot/ttv");
			machine.isFolder.mockResolvedValue(true);
			vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
			const result = await createMemonActTool().execute(
				{ action: "describe", ref: "f3" },
				undefined,
			);
			expect(machine.openFolder).toHaveBeenCalledWith("/agents/Bot/ttv");
			expect(machine.pictureOfFile).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				content: expect.stringContaining("Opened folder ~/ttv in Files."),
			});
			expect(result).not.toHaveProperty("isError", true);
		},
	);
	beforeEach(() => {
		vi.mocked(getMemonMachine).mockReset();
	});

	it("hands a model that takes images a picture of the ref, a canvas included", async () => {
		const machine = fakeMachine({ looks: true });
		const result = await describeRef(machine);
		expect(machine.captureRef).toHaveBeenCalledWith("b1");
		expect(result).toMatchObject({
			content: [
				{
					type: "text",
					text: "The picture of b1 (880×594) is attached: look at it.\n\nscreen",
				},
				{ type: "image_url", image_url: { url: PICTURE, detail: "auto" } },
			],
		});
		expect(machine.savePicture).not.toHaveBeenCalled();
	});

	it("hands over an image in Files, by its ref or as the Viewer shows it", async () => {
		const machine = fakeMachine({ looks: true });
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const result = await createMemonActTool().execute(
			{ ref: "f3", action: "describe" },
			undefined,
		);
		expect(machine.fileRefPath).toHaveBeenCalledWith("f3");
		expect(machine.pictureOfFile).toHaveBeenCalledWith(
			"/agents/Bot/shots/hero.png",
		);
		expect(result).toMatchObject({
			content: [
				{
					type: "text",
					text: "The picture of ~/shots/hero.png (640×360) is attached: look at it.\n\nscreen",
				},
				{ type: "image_url", image_url: { url: PICTURE, detail: "auto" } },
			],
		});

		const viewing = fakeMachine({
			looks: true,
			viewer: "/agents/Bot/chart.webp",
		});
		vi.mocked(getMemonMachine).mockResolvedValue(viewing as never);
		await createMemonActTool().execute({ action: "describe" }, undefined);
		expect(viewing.pictureOfFile).toHaveBeenCalledWith(
			"/agents/Bot/chart.webp",
		);
		expect(viewing.captureRef).not.toHaveBeenCalled();
	});

	it("pictures the whole page without a ref, and points a model that cannot look at captions", async () => {
		const machine = fakeMachine({ looks: true });
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const page = await createMemonActTool().execute(
			{ action: "describe" },
			undefined,
		);
		expect(machine.captureRef).toHaveBeenCalledWith(undefined);
		expect(page).toMatchObject({
			content: [
				{
					type: "text",
					text: expect.stringContaining(
						"The picture of the page (880×594) is attached",
					),
				},
				{ type: "image_url" },
			],
		});

		const blind = fakeMachine({ looks: false });
		vi.mocked(getMemonMachine).mockResolvedValue(blind as never);
		const file = await createMemonActTool().execute(
			{ ref: "f3", action: "describe" },
			undefined,
		);
		expect(blind.pictureOfFile).not.toHaveBeenCalled();
		expect(file).toMatchObject({
			content: expect.stringContaining(
				'memon_studio { action: "run", tool: "image_tools", path: "~/shots/hero.png" } can caption it.',
			),
		});

		await expect(
			createMemonActTool().execute(
				{ ref: "e1", action: "describe" },
				undefined,
			),
		).resolves.toMatchObject({
			content: expect.stringContaining("describe takes a page ref (b9)"),
		});
	});

	it("saves the picture to Files for a model that cannot look", async () => {
		const machine = fakeMachine({ looks: false });
		const result = await describeRef(machine);
		expect(machine.savePicture).toHaveBeenCalledWith(PICTURE, "b1-picture");
		expect(result).toMatchObject({
			content: expect.stringContaining(
				"Saved a picture of b1 (880×594) to ~/Pictures/b1-picture.png. The chat's model cannot look at images;",
			),
		});
	});

	it("still gives an image's address when its picture cannot be taken", async () => {
		const machine = fakeMachine({
			looks: true,
			capture: async () => {
				throw new Error("the image is from another site");
			},
		});
		const result = await describeRef(machine);
		expect(result).toMatchObject({
			content: expect.stringContaining(
				"No picture of b1 (the image is from another site). Image b1 source: http://localhost:8347/logo.png.",
			),
		});
	});
});

describe("memon_act scroll", () => {
	beforeEach(() => {
		vi.mocked(getMemonMachine).mockReset();
	});

	const scroll = async (
		focused: { app: "files" | "browser"; moved?: boolean },
		direction?: "down" | "bottom",
	) => {
		const machine = {
			...fakeMachine({ looks: false }),
			focusedTextWindow: () => null,
			scrollWindow: vi.fn(() =>
				focused.app === "browser"
					? null
					: { app: focused.app, moved: focused.moved ?? true },
			),
		};
		machine.browserAction.mockResolvedValue({
			ok: true,
			action: "scrollScreen",
			ref: "",
			detail: "The page is at 680 of 4000 px down.",
		});
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const result = await createMemonActTool().execute(
			{ action: "scroll", ...(direction ? { direction } : {}) },
			undefined,
		);
		return { machine, result };
	};

	it("pages the focused window's list, not the page behind it", async () => {
		const { machine, result } = await scroll({ app: "files" }, "bottom");
		expect(machine.scrollWindow).toHaveBeenCalledWith("bottom");
		expect(machine.browserAction).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			content: expect.stringContaining("Scrolled Files to the bottom."),
		});

		const atEnd = await scroll({ app: "files", moved: false });
		expect(atEnd.result).toMatchObject({
			content: expect.stringContaining("Files cannot scroll down any further."),
		});
	});

	it("points a click by x, y with no page open at the refs of the window in front", async () => {
		const machine = {
			...fakeMachine({ looks: false }),
			snapshot: () => ({
				revision: 1,
				focusedWindowId: "w42",
				windows: [{ id: "w42", app: "files" }],
				browser: { tabs: [], activeTabId: null },
			}),
		};
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const result = await createMemonActTool().execute(
			{ action: "click", x: 200, y: 200 },
			undefined,
		);
		expect(machine.browserAction).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			isError: true,
			content: expect.stringContaining(
				"click by x, y acts on a Browser page, and no page is open. Files is in front: act on it by a ref from the screen",
			),
		});
	});

	it("scrolls the page when the Browser is in front", async () => {
		const { machine, result } = await scroll({ app: "browser" });
		expect(machine.browserAction).toHaveBeenCalledWith({
			action: "scrollScreen",
			value: "down",
			ref: undefined,
		});
		expect(result).toMatchObject({
			content: expect.stringContaining("The page is at 680 of 4000 px down."),
		});
	});
});

describe("memon_act screenshot", () => {
	const shooter = (activeTabId: string | null) => ({
		...fakeMachine({ looks: true }),
		snapshot: () => ({
			revision: 1,
			focusedWindowId: null,
			windows: [],
			browser: { tabs: [], activeTabId },
		}),
		saveScreenshot: vi.fn(async () => ({
			id: 1,
			path: "/agents/Bot/Pictures/example.com-b4-2026-10-16-14-03-22.png",
			width: 2560,
			height: 1600,
		})),
	});

	beforeEach(() => {
		vi.mocked(getMemonMachine).mockReset();
	});

	it("saves the current view by default, or a ref, and says where", async () => {
		const machine = shooter("tab1");
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		const view = await createMemonActTool().execute(
			{ action: "screenshot" },
			undefined,
		);
		expect(machine.saveScreenshot).toHaveBeenLastCalledWith({
			ref: undefined,
			to: undefined,
			fullPage: false,
			area: undefined,
		});
		expect(view).toMatchObject({
			content: expect.stringContaining(
				"Saved a screenshot of the current view (2560×1600 px)",
			),
		});

		const element = await createMemonActTool().execute(
			{ action: "screenshot", ref: "b4", to: "~/shots" },
			undefined,
		);
		expect(machine.saveScreenshot).toHaveBeenLastCalledWith({
			ref: "b4",
			to: "~/shots",
			fullPage: false,
			area: undefined,
		});
		// A file for the user: no picture handed to the model.
		expect(element).toMatchObject({
			content: expect.stringContaining(
				"Saved a screenshot of b4 (2560×1600 px) to ~/Pictures/example.com-b4-2026-10-16-14-03-22.png.",
			),
		});
		expect(machine.captureRef).not.toHaveBeenCalled();
	});

	it("takes the whole page, or a region of the view or of the page", async () => {
		const machine = shooter("tab1");
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		machine.saveScreenshot.mockResolvedValueOnce({
			id: 2,
			path: "/agents/Bot/Pictures/example.com-page-2026-10-16-14-03-22.png",
			width: 1280,
			height: 16_384,
			cut: true,
		} as never);
		const whole = await createMemonActTool().execute(
			{ action: "screenshot", capture: "page" },
			undefined,
		);
		expect(machine.saveScreenshot).toHaveBeenLastCalledWith({
			ref: undefined,
			to: undefined,
			fullPage: true,
			area: undefined,
		});
		expect(whole).toMatchObject({
			content: expect.stringContaining(
				"Saved a screenshot of the whole page (1280×16384 px) to ~/Pictures/example.com-page-2026-10-16-14-03-22.png. The page is longer than a picture keeps",
			),
		});

		// As the screen gives places: "[b9] canvas 800×600 at 0,120".
		const region = { x: 0, y: 120, width: 800, height: 600 };
		const part = await createMemonActTool().execute(
			{ action: "screenshot", region },
			undefined,
		);
		expect(machine.saveScreenshot).toHaveBeenLastCalledWith({
			ref: undefined,
			to: undefined,
			fullPage: false,
			area: region,
		});
		expect(part).toMatchObject({
			content: expect.stringContaining(
				"Saved a screenshot of the view's region 800×600 at 0,120",
			),
		});

		await createMemonActTool().execute(
			{ action: "screenshot", capture: "page", region },
			undefined,
		);
		expect(machine.saveScreenshot).toHaveBeenLastCalledWith({
			ref: undefined,
			to: undefined,
			fullPage: true,
			area: region,
		});
	});

	it("takes a ref on its own", async () => {
		const machine = shooter("tab1");
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
		for (const input of [
			{ ref: "b4", capture: "page" as const },
			{ ref: "b4", region: { x: 0, y: 0, width: 10, height: 10 } },
		]) {
			await expect(
				createMemonActTool().execute(
					{ action: "screenshot", ...input },
					undefined,
				),
			).resolves.toMatchObject({
				content: expect.stringContaining("not both"),
			});
		}
		expect(machine.saveScreenshot).not.toHaveBeenCalled();
	});

	it("needs a page, and takes only page refs", async () => {
		const blank = shooter(null);
		vi.mocked(getMemonMachine).mockResolvedValue(blank as never);
		await expect(
			createMemonActTool().execute({ action: "screenshot" }, undefined),
		).resolves.toMatchObject({
			content: expect.stringContaining("no page is open"),
		});
		await expect(
			createMemonActTool().execute(
				{ action: "screenshot", ref: "f3" },
				undefined,
			),
		).resolves.toMatchObject({
			content: expect.stringContaining("screenshot takes a page ref (b9)"),
		});
		expect(blank.saveScreenshot).not.toHaveBeenCalled();
	});
});
