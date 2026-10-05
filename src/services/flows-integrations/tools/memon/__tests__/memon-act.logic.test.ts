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
