import { beforeEach, describe, expect, it, vi } from "vitest";

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
}) => ({
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

describe("memon_act describe", () => {
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
