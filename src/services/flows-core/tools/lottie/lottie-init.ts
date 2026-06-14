import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { animationFile } from "flow-core/tools/lottie/util";
import { readFileBytes, writeFileBytes } from "flow-core/tools/fs/util";
import type { LottieToolConfig } from "flow-core/tools/lottie/config";

const TOOL_NAME = "lottie_init" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path for the new project under the workspace root, e.g. /workspaces/loading-spinner. " +
				"Choose a meaningful slug. Never use generic names like 'default' or 'untitled'.",
		),
	width: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Composition width in px (default 512)"),
	height: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Composition height in px (default 512)"),
	frame_rate: z
		.number()
		.positive()
		.optional()
		.describe("Frames per second (default 60)"),
	duration_frames: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Total frames, e.g. 90 for 1.5s @ 60fps (default 90)"),
	force: z
		.boolean()
		.optional()
		.describe("Overwrite if the project already exists"),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

const buildSkeleton = (
	width: number,
	height: number,
	frameRate: number,
	durationFrames: number,
): object => ({
	v: "5.9.0",
	fr: frameRate,
	ip: 0,
	op: durationFrames,
	w: width,
	h: height,
	nm: "New Animation",
	ddd: 0,
	assets: [],
	layers: [
		{
			ty: 4,
			nm: "Background",
			ind: 1,
			ip: 0,
			op: durationFrames,
			st: 0,
			ks: {
				o: { a: 0, k: 100 },
				r: { a: 0, k: 0 },
				p: { a: 0, k: [width / 2, height / 2, 0] },
				a: { a: 0, k: [0, 0, 0] },
				s: { a: 0, k: [100, 100, 100] },
			},
			shapes: [
				{
					ty: "gr",
					it: [
						{
							ty: "rc",
							p: { a: 0, k: [0, 0] },
							s: { a: 0, k: [width, height] },
							r: { a: 0, k: 0 },
						},
						{
							ty: "fl",
							c: { a: 0, k: [0.1, 0.1, 0.12, 1] },
							o: { a: 0, k: 100 },
						},
						{
							ty: "tr",
							p: { a: 0, k: [0, 0] },
							a: { a: 0, k: [0, 0] },
							s: { a: 0, k: [100, 100] },
							r: { a: 0, k: 0 },
							o: { a: 0, k: 100 },
						},
					],
				},
			],
		},
	],
});

export const createLottieInitTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Initialise a new Lottie/Bodymovin animation project. Writes animation.json with a minimal valid skeleton (background layer wrapped in a shape group). Use force: true to overwrite an existing project.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = animationFile(input.project_path, config?.rootPath);

		if (!input.force) {
			try {
				await readFileBytes(dfs, file, config);
				return `Error: ${file} already exists. Use force: true to overwrite.`;
			} catch {
				// Does not exist - proceed
			}
		}

		const skeleton = buildSkeleton(
			input.width ?? 512,
			input.height ?? 512,
			input.frame_rate ?? 60,
			input.duration_frames ?? 90,
		);

		await writeFileBytes(
			dfs,
			file,
			JSON.stringify(skeleton, null, 2),
			true,
			config,
		);

		return `Initialised: ${file}. Edit with lottie_write, validate with lottie_validate, preview with lottie_show.`;
	},
});

toolRegistry.register(TOOL_NAME, createLottieInitTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
