import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { StudioItem } from "@/types/studio";
import { ImageToolsStudio } from "../ImageToolsStudio";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { defaultValue?: string }) =>
			options?.defaultValue ?? key,
	}),
}));

const { runImageTool, saveStudioInput, deleteItem, navigate } = vi.hoisted(
	() => ({
		runImageTool: vi.fn(),
		saveStudioInput: vi.fn(),
		deleteItem: vi.fn(),
		navigate: vi.fn(),
	}),
);

vi.mock("react-router-dom", async (importOriginal) => ({
	...(await importOriginal<typeof import("react-router-dom")>()),
	useNavigate: () => navigate,
}));

vi.mock("@/main/modules/studio/services/studio-service", () => ({
	runImageTool,
	saveStudioInput,
	isCancellation: (error: unknown) =>
		error instanceof Error && error.name === "AbortError",
}));

vi.mock("@/main/stores/studio", () => ({
	useStudioStore: (
		selector: (store: { deleteItem: typeof deleteItem }) => unknown,
	) => selector({ deleteItem }),
}));

vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

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

const DETECTOR: CurrentModelInfo = {
	modelId: "org/any-detector",
	provider: "transformer-media",
	serviceName: "transformer-media",
};

/** What the runner reports for a model: its pipeline task, nothing else. */
const infoFor = (model: CurrentModelInfo, imageTask: string) =>
	({
		id: model.modelId,
		object: "model",
		created: 0,
		owned_by: model.provider,
		loaded: false,
		imageTask,
	}) as React.ComponentProps<typeof ImageToolsStudio>["modelInfo"];

const detectionItem: StudioItem = {
	id: "det-1",
	conversationId: "session-1",
	category: "image-tools",
	content: "street.jpg",
	parts: [
		{
			type: "image",
			image: {
				path: "inputs/street.jpg",
				mimeType: "image/jpeg",
				role: "input",
			},
		},
		{
			type: "detections",
			detections: [
				{
					label: "person",
					score: 0.97,
					box: { xmin: 100, ymin: 100, xmax: 300, ymax: 500 },
				},
				{
					label: "person",
					score: 0.88,
					box: { xmin: 400, ymin: 120, xmax: 560, ymax: 480 },
				},
				{
					label: "bicycle",
					score: 0.71,
					box: { xmin: 600, ymin: 300, xmax: 900, ymax: 560 },
				},
			],
		},
	],
	generation: {
		category: "image-tools",
		provider: "transformer-media",
		serviceName: "transformer-media",
		modelId: DETECTOR.modelId,
		status: "done",
		imageTask: "object-detection",
		params: { task: "object-detection", threshold: 0.5 },
		durationMs: 900,
	},
	createdAt: new Date("2026-09-01T10:00:00Z"),
};

const renderStudio = (
	overrides: Partial<React.ComponentProps<typeof ImageToolsStudio>> = {},
) => {
	const ensureModelReady = vi.fn(async () => overrides.model ?? DETECTOR);
	const view = render(
		<ImageToolsStudio
			mode="image-tools"
			model={DETECTOR}
			modelInfo={infoFor(DETECTOR, "object-detection")}
			items={[]}
			ensureModelReady={ensureModelReady}
			isNarrow={false}
			{...overrides}
		/>,
	);
	return { ...view, ensureModelReady };
};

const fileInput = () =>
	document.querySelector<HTMLInputElement>(
		"[data-image-file-input]",
	) as HTMLInputElement;

describe("ImageToolsStudio", () => {
	beforeEach(() => {
		runImageTool.mockReset();
		saveStudioInput.mockReset();
		deleteItem.mockReset();
		navigate.mockReset();
		saveStudioInput.mockResolvedValue({
			kind: "file",
			path: "inputs/photo.png",
			mimeType: "image/png",
		});
		runImageTool.mockResolvedValue(detectionItem);
	});

	it("saves an uploaded image and runs the active task with the threshold", async () => {
		const user = userEvent.setup();
		const { ensureModelReady } = renderStudio();

		// The task picker in the composer toolbar lists every task, marking the
		// active one.
		const trigger = document.querySelector<HTMLElement>(
			"[data-image-tool-task-trigger]",
		) as HTMLElement;
		expect(trigger.getAttribute("data-image-tool-task-trigger")).toBe(
			"object-detection",
		);
		await user.click(trigger);
		expect(
			document
				.querySelector('[data-image-tool-task="object-detection"]')
				?.getAttribute("aria-pressed"),
		).toBe("true");
		await user.keyboard("{Escape}");
		fireEvent.change(
			document.querySelector("[data-threshold-slider]") as HTMLElement,
			{
				target: { value: "0.7" },
			},
		);

		const file = new File(["png-bytes"], "photo.png", { type: "image/png" });
		await user.upload(fileInput(), file);

		await waitFor(() => expect(runImageTool).toHaveBeenCalledTimes(1));
		expect(saveStudioInput).toHaveBeenCalledWith(file, "image");
		expect(ensureModelReady).toHaveBeenCalled();
		expect(runImageTool).toHaveBeenCalledWith(
			expect.objectContaining({
				model: DETECTOR,
				task: "object-detection",
				threshold: 0.7,
				fileName: "photo.png",
				image: {
					kind: "file",
					path: "inputs/photo.png",
					mimeType: "image/png",
				},
			}),
		);
		expect(screen.getByText("photo.png")).toBeTruthy();

		// Running again on the same staged image does not save it twice.
		await user.click(screen.getByRole("button", { name: "Run" }));
		await waitFor(() => expect(runImageTool).toHaveBeenCalledTimes(2));
		expect(saveStudioInput).toHaveBeenCalledTimes(1);
	});

	it("offers the model's tasks in the empty state and opens the picker", async () => {
		const user = userEvent.setup();
		renderStudio();
		const suggestions = document.querySelectorAll<HTMLElement>(
			"[data-image-tool-suggestion]",
		);
		expect(
			Array.from(suggestions).map((element) =>
				element.getAttribute("data-image-tool-suggestion"),
			),
		).toEqual(["object-detection"]);
		const click = vi.spyOn(fileInput(), "click");
		await user.click(suggestions[0] as HTMLElement);
		expect(click).toHaveBeenCalled();
	});

	it("rejects files over 20 MB", async () => {
		const user = userEvent.setup();
		renderStudio();
		const big = new File(["x"], "huge.png", { type: "image/png" });
		Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
		await user.upload(fileInput(), big);

		expect(screen.getByRole("alert").textContent).toMatch(/limit/);
		expect(saveStudioInput).not.toHaveBeenCalled();
		expect(runImageTool).not.toHaveBeenCalled();
	});

	it("draws detection boxes scaled to the displayed image and lists labels", async () => {
		renderStudio({ items: [detectionItem] });

		const result = document.querySelector<HTMLElement>(
			"[data-detection-result]",
		) as HTMLElement;
		const frame = result.firstElementChild as HTMLElement;
		const image = within(result).getByAltText("street.jpg") as HTMLImageElement;
		Object.defineProperty(image, "naturalWidth", { value: 1000 });
		Object.defineProperty(image, "naturalHeight", { value: 600 });
		Object.defineProperty(frame, "clientWidth", {
			value: 500,
			configurable: true,
		});
		Object.defineProperty(frame, "clientHeight", {
			value: 300,
			configurable: true,
		});
		fireEvent.load(image);

		const boxes = await waitFor(() => {
			const found = result.querySelectorAll<HTMLElement>(
				"[data-detection-box]",
			);
			expect(found).toHaveLength(3);
			return found;
		});
		const first = boxes[0] as HTMLElement;
		expect(first.style.left).toBe("50px");
		expect(first.style.top).toBe("50px");
		expect(first.style.width).toBe("100px");
		expect(first.style.height).toBe("200px");
		expect(first.textContent).toContain("person 97%");

		const counts = result.querySelector(
			"[data-detection-counts]",
		) as HTMLElement;
		expect(counts.textContent).toContain("person×2");
		expect(counts.textContent).toContain("bicycle×1");

		fireEvent.mouseEnter(
			result.querySelector('[data-detection-row="2"]') as HTMLElement,
		);
		expect(boxes[0]?.className).toContain("opacity-25");
		expect(boxes[2]?.className).toContain("opacity-100");
	});

	it("shows the switch-model hint for a task the model cannot run", async () => {
		const user = userEvent.setup();
		renderStudio();
		expect(document.querySelector("[data-switch-model-hint]")).toBeNull();

		await user.click(
			document.querySelector("[data-image-tool-task-trigger]") as HTMLElement,
		);
		await user.click(screen.getByRole("button", { name: /Remove background/ }));
		expect(
			document
				.querySelector("[data-image-tool-task-trigger]")
				?.getAttribute("data-image-tool-task-trigger"),
		).toBe("background-removal");
		const hint = document.querySelector<HTMLElement>(
			"[data-switch-model-hint]",
		);
		expect(hint?.textContent).toContain(
			"Switch to a model that can remove backgrounds",
		);
		expect(
			screen.getByRole("button", { name: "Run" }).hasAttribute("disabled"),
		).toBe(true);

		// An upload for an unsupported task is staged, not run.
		await user.upload(
			fileInput(),
			new File(["png"], "photo.png", { type: "image/png" }),
		);
		expect(runImageTool).not.toHaveBeenCalled();

		await user.click(
			within(hint as HTMLElement).getByRole("button", {
				name: /Choose a model/,
			}),
		);
		expect(navigate).toHaveBeenCalledWith("/llm?category=image-tools");
	});

	it("renders caption text for an image-to-text model", async () => {
		const captioner: CurrentModelInfo = {
			...DETECTOR,
			modelId: "org/any-captioner",
		};
		const captionItem: StudioItem = {
			...detectionItem,
			id: "cap-1",
			content: "a street",
			parts: [
				detectionItem.parts[0] as StudioItem["parts"][number],
				{ type: "text", text: "A busy street at dusk", role: "caption" },
			],
			generation: {
				...detectionItem.generation,
				modelId: captioner.modelId,
				imageTask: "image-to-text",
				params: { task: "image-to-text" },
			},
		};
		renderStudio({
			model: captioner,
			modelInfo: infoFor(captioner, "image-to-text"),
			items: [captionItem],
		});

		expect(
			document
				.querySelector("[data-image-tool-task-trigger]")
				?.getAttribute("data-image-tool-task-trigger"),
		).toBe("image-to-text");
		expect(document.querySelector("[data-threshold]")).toBeNull();
		const text = document.querySelector(
			'[data-tool-text="image-to-text"]',
		) as HTMLElement;
		expect(text.textContent).toBe("A busy street at dusk");
		expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
	});

	it("renders classification labels with scores", () => {
		const classifier: CurrentModelInfo = {
			...DETECTOR,
			modelId: "org/any-classifier",
		};
		renderStudio({
			model: classifier,
			modelInfo: infoFor(classifier, "image-classification"),
			items: [
				{
					...detectionItem,
					id: "cls-1",
					parts: [
						detectionItem.parts[0] as StudioItem["parts"][number],
						{ type: "labels", labels: [{ label: "tabby cat", score: 0.91 }] },
					],
					generation: {
						...detectionItem.generation,
						modelId: classifier.modelId,
						imageTask: "image-classification",
						params: { task: "image-classification" },
					},
				},
			],
		});

		const labels = document.querySelector("[data-tool-labels]") as HTMLElement;
		expect(labels.textContent).toContain("tabby cat");
		expect(labels.textContent).toContain("91%");
	});
});
