import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { StudioItem } from "@/types/studio";
import { ImageGenerationStudio } from "../ImageGenerationStudio";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

const { generateImages, deleteItem, updateItem } = vi.hoisted(() => ({
	generateImages: vi.fn(),
	deleteItem: vi.fn(),
	updateItem: vi.fn(),
}));

vi.mock("@/main/modules/studio/services/studio-service", () => ({
	generateImages,
	isCancellation: (error: unknown) =>
		error instanceof Error && error.name === "AbortError",
}));

vi.mock("@/main/stores/studio", () => ({
	useStudioStore: (
		selector: (store: {
			deleteItem: typeof deleteItem;
			updateItem: typeof updateItem;
		}) => unknown,
	) => selector({ deleteItem, updateItem }),
}));

vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

// Stored media needs the documents filesystem; a plain <img> is enough here.
vi.mock("@/main/modules/studio/components/shared/StoredImage", () => ({
	StoredImage: ({
		path,
		alt,
		mimeType: _mimeType,
		placeholderClassName: _placeholder,
		...rest
	}: React.ImgHTMLAttributes<HTMLImageElement> & {
		path: string;
		mimeType: string;
		placeholderClassName?: string;
	}) => (
		<img src={`blob:${path}`} alt={alt} data-stored-path={path} {...rest} />
	),
	useMediaUrl: (path: string) => ({ url: `blob:${path}`, error: null }),
}));

const HOSTED: CurrentModelInfo = {
	modelId: "any-image-model",
	provider: "openai",
	serviceName: "openai",
};

const doneItem = (id: string, prompt: string, paths: string[]): StudioItem => ({
	id,
	conversationId: "session-1",
	category: "image-generation",
	content: prompt,
	parts: [
		{ type: "text", text: prompt, role: "prompt" },
		...paths.map((path) => ({
			type: "image" as const,
			image: { path, mimeType: "image/png", role: "generated" as const },
		})),
	],
	generation: {
		category: "image-generation",
		provider: "openai",
		serviceName: "openai",
		modelId: "any-image-model",
		status: "done",
		durationMs: 4200,
		params: { size: "512x512", n: paths.length },
	},
	createdAt: new Date("2026-09-01T10:00:00Z"),
});

const renderStudio = (
	overrides: Partial<React.ComponentProps<typeof ImageGenerationStudio>> = {},
) => {
	const ensureModelReady = vi.fn(async () => overrides.model ?? HOSTED);
	const view = render(
		<ImageGenerationStudio
			mode="image-generation"
			model={HOSTED}
			items={[]}
			ensureModelReady={ensureModelReady}
			isNarrow={false}
			{...overrides}
		/>,
	);
	return { ...view, ensureModelReady };
};

describe("ImageGenerationStudio", () => {
	beforeEach(() => {
		generateImages.mockReset();
		deleteItem.mockReset();
		updateItem.mockReset();
		generateImages.mockResolvedValue(doneItem("new", "x", []));
	});

	it("generates with the chosen size and count after loading the model", async () => {
		const user = userEvent.setup();
		const order: string[] = [];
		const { ensureModelReady } = renderStudio();
		ensureModelReady.mockImplementation(async () => {
			order.push("ensure");
			return HOSTED;
		});
		generateImages.mockImplementation(async () => {
			order.push("generate");
			return doneItem("new", "x", []);
		});

		await user.type(
			screen.getByPlaceholderText("Describe the image you want"),
			"A lighthouse at night",
		);
		await user.click(screen.getByRole("button", { name: "Image settings" }));
		const settings = document.querySelector<HTMLElement>(
			"[data-image-settings]",
		);
		expect(settings).not.toBeNull();
		await user.click(
			within(settings as HTMLElement).getByRole("button", {
				name: /1024×1024/,
			}),
		);
		await user.click(
			(settings as HTMLElement).querySelector(
				'[data-image-count-option="3"]',
			) as HTMLElement,
		);
		await user.keyboard("{Escape}");
		await user.click(screen.getByRole("button", { name: "Generate" }));

		await waitFor(() => expect(generateImages).toHaveBeenCalledTimes(1));
		expect(order).toEqual(["ensure", "generate"]);
		expect(generateImages).toHaveBeenCalledWith(
			expect.objectContaining({
				model: HOSTED,
				prompt: "A lighthouse at night",
				size: "1024x1024",
				n: 3,
				signal: expect.any(AbortSignal),
			}),
		);
		// Optional fields left at their defaults are not sent.
		const request = generateImages.mock.calls[0]?.[0];
		expect(request.quality).toBeUndefined();
		expect(request.seed).toBeUndefined();
	});

	it("submits with Ctrl+Enter and fills the prompt from an example", async () => {
		const user = userEvent.setup();
		renderStudio();
		await user.click(
			document.querySelector("[data-image-example]") as HTMLElement,
		);
		const textarea = screen.getByPlaceholderText(
			"Describe the image you want",
		) as HTMLTextAreaElement;
		expect(textarea.value.length).toBeGreaterThan(0);
		await user.keyboard("{Control>}{Enter}{/Control}");
		await waitFor(() => expect(generateImages).toHaveBeenCalledTimes(1));
		// "auto" size and a single image leave the choice to the server.
		expect(generateImages.mock.calls[0]?.[0]).toMatchObject({
			size: undefined,
			n: undefined,
		});
	});

	it("renders finished images and opens them in a lightbox", async () => {
		const user = userEvent.setup();
		renderStudio({
			items: [
				doneItem("a", "A red fox", ["images/fox-1.png", "images/fox-2.png"]),
				doneItem("b", "A blue whale", ["images/whale.png"]),
			],
		});

		expect(document.querySelectorAll("[data-generated-image]")).toHaveLength(3);
		expect(screen.getAllByAltText("A red fox")).toHaveLength(2);

		await user.click(
			document.querySelectorAll<HTMLElement>(
				"[data-open-image]",
			)[1] as HTMLElement,
		);
		const lightbox = await screen.findByRole("dialog");
		expect(
			lightbox
				.querySelector("[data-lightbox-image]")
				?.getAttribute("data-stored-path"),
		).toBe("images/fox-2.png");

		await user.keyboard("{ArrowRight}");
		expect(
			lightbox
				.querySelector("[data-lightbox-image]")
				?.getAttribute("data-stored-path"),
		).toBe("images/whale.png");

		await user.click(
			within(lightbox).getByRole("button", { name: "Next image" }),
		);
		expect(
			lightbox
				.querySelector("[data-lightbox-image]")
				?.getAttribute("data-stored-path"),
		).toBe("images/fox-1.png");

		await user.keyboard("{Escape}");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("offers the same optional settings for any model and sends only what is set", async () => {
		const user = userEvent.setup();
		const local: CurrentModelInfo = {
			modelId: "org/any-local-model",
			provider: "transformer-media",
			serviceName: "transformer-media",
		};
		renderStudio({ model: local });

		await user.click(screen.getByRole("button", { name: "Image settings" }));
		const settings = document.querySelector<HTMLElement>(
			"[data-image-settings]",
		);
		expect(settings?.querySelector("[data-image-count]")).not.toBeNull();
		expect(settings?.querySelector("[data-image-sizes]")).not.toBeNull();
		await user.type(
			within(settings as HTMLElement).getByLabelText("Seed"),
			"42",
		);
		await user.keyboard("{Escape}");

		await user.type(
			screen.getByPlaceholderText("Describe the image you want"),
			"A cat",
		);
		await user.click(screen.getByRole("button", { name: "Generate" }));
		await waitFor(() => expect(generateImages).toHaveBeenCalledTimes(1));
		expect(generateImages.mock.calls[0]?.[0]).toMatchObject({
			model: local,
			size: undefined,
			n: undefined,
			seed: 42,
		});
	});

	it("reuses a prompt and deletes an item", async () => {
		const user = userEvent.setup();
		renderStudio({ items: [doneItem("a", "A red fox", ["images/fox-1.png"])] });

		await user.click(
			screen.getByRole("button", { name: "Reuse prompt and settings" }),
		);
		expect(
			(
				screen.getByPlaceholderText(
					"Describe the image you want",
				) as HTMLTextAreaElement
			).value,
		).toBe("A red fox");

		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(deleteItem).toHaveBeenCalledWith("image-generation", "a");
	});

	it("adds a comment on an image from the lightbox", async () => {
		const user = userEvent.setup();
		renderStudio({ items: [doneItem("a", "A red fox", ["images/fox.png"])] });

		await user.click(
			document.querySelector<HTMLElement>(
				"[data-comment-image]",
			) as HTMLElement,
		);
		const lightbox = await screen.findByRole("dialog");
		const panel = lightbox.querySelector<HTMLElement>(
			"[data-image-comment-panel]",
		);
		expect(panel).not.toBeNull();

		await user.type(
			within(panel as HTMLElement).getByPlaceholderText("What should change?"),
			"Warmer light{Enter}",
		);

		expect(updateItem).toHaveBeenCalledWith(
			"image-generation",
			"a",
			expect.objectContaining({
				parts: expect.arrayContaining([
					expect.objectContaining({
						type: "image_comments",
						imagePath: "images/fox.png",
						comments: [expect.objectContaining({ text: "Warmer light" })],
					}),
				]),
			}),
		);
	});

	it("generates the next image from an image and its comments", async () => {
		const user = userEvent.setup();
		const item = doneItem("a", "A red fox", ["images/fox.png"]);
		item.parts.push({
			type: "image_comments",
			imagePath: "images/fox.png",
			comments: [{ id: "c1", text: "Make it night", createdAt: 1 }],
		});
		renderStudio({ items: [item] });

		expect(
			document.querySelector("[data-image-comments-bar]")?.textContent,
		).toContain("1 comment");
		await user.click(
			document.querySelector<HTMLElement>(
				"[data-image-generate-next-tile]",
			) as HTMLElement,
		);

		await waitFor(() => expect(generateImages).toHaveBeenCalledTimes(1));
		const request = generateImages.mock.calls[0]![0];
		expect(request.references).toEqual([
			{ kind: "file", path: "images/fox.png", mimeType: "image/png" },
		]);
		expect(request.mask).toBeUndefined();
		expect(request.n).toBeUndefined();
		expect(request.prompt).toContain("Original prompt: A red fox");
		expect(request.prompt).toContain("1. (whole image) Make it night");
		expect(request.inputParts).toEqual([
			{
				type: "image_feedback",
				feedback: {
					basePrompt: "A red fox",
					source: {
						itemId: "a",
						path: "images/fox.png",
						mimeType: "image/png",
					},
					comments: [{ id: "c1", text: "Make it night", createdAt: 1 }],
				},
			},
		]);
		// The notes now belong to the follow-up, not the source image.
		expect(updateItem).toHaveBeenCalledWith("image-generation", "a", {
			parts: item.parts.filter((part) => part.type !== "image_comments"),
		});
	});
});
