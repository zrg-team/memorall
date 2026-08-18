import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-core/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-core/interfaces/services/services";
import { toolRegistry } from "@/services/flows-core/registries/tool-registry";
import { animationFile } from "@/services/flows-core/tools/lottie/util";
import { readFileBytes } from "@/services/flows-core/tools/fs/util";
import type { LottieToolConfig } from "@/services/flows-core/tools/lottie/config";

const TOOL_NAME = "lottie_validate" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory, e.g. /projects/loading-spinner",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

interface LottieFinding {
	severity: "error" | "warning";
	code: string;
	message: string;
	path?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isAnimatedProp = (value: unknown): value is { a: 1; k: unknown[] } =>
	isRecord(value) && value.a === 1;

const isStaticProp = (value: unknown): value is { a?: 0; k: unknown } =>
	isRecord(value) && (value.a === undefined || value.a === 0);

const validateAnimatableProperty = (
	value: unknown,
	path: string,
	findings: LottieFinding[],
): void => {
	if (!isRecord(value) || !("k" in value)) return;

	if (isAnimatedProp(value)) {
		if (!Array.isArray(value.k)) {
			findings.push({
				severity: "error",
				code: "animated_prop_not_array",
				message: `Property "a":1 requires "k" to be an array of keyframe objects.`,
				path,
			});
			return;
		}
		for (const [i, kf] of value.k.entries()) {
			if (!isRecord(kf) || !("t" in kf) || !("s" in kf)) {
				findings.push({
					severity: "error",
					code: "keyframe_missing_fields",
					message: `Keyframe ${i} is missing required "t" (time) or "s" (start value) fields.`,
					path: `${path}.k[${i}]`,
				});
			}
		}
	} else if (isStaticProp(value)) {
		if (
			Array.isArray(value.k) &&
			isRecord(value.k[0]) &&
			"t" in (value.k[0] as Record<string, unknown>)
		) {
			findings.push({
				severity: "error",
				code: "static_prop_has_keyframes",
				message: `Property "a":0 (static) has a "k" array of keyframe objects — set "a":1 or use a plain value.`,
				path,
			});
		}
	}
};

const validateColor = (
	value: unknown,
	path: string,
	findings: LottieFinding[],
): void => {
	if (!isRecord(value) || !("c" in value)) return;
	const c = value.c as { k?: unknown };
	const colorValues = isAnimatedProp(c)
		? c.k.flatMap((kf) => (isRecord(kf) && Array.isArray(kf.s) ? kf.s : []))
		: Array.isArray(c.k)
			? c.k
			: [];

	for (const component of colorValues) {
		if (typeof component === "number" && component > 1) {
			findings.push({
				severity: "warning",
				code: "color_not_normalized",
				message: `Color value ${component} exceeds 1 — colors must be normalized 0-1 RGBA, not 0-255.`,
				path: `${path}.c`,
			});
			break;
		}
	}
};

const validateGroupItem = (
	item: unknown,
	path: string,
	findings: LottieFinding[],
): void => {
	if (!isRecord(item)) return;

	if (item.ty === "gr") {
		const it = item.it;
		if (!Array.isArray(it)) {
			findings.push({
				severity: "error",
				code: "group_missing_items",
				message: `Shape group is missing its "it" array.`,
				path,
			});
			return;
		}
		const last = it.at(-1);
		if (!isRecord(last) || last.ty !== "tr") {
			findings.push({
				severity: "error",
				code: "group_missing_transform",
				message: `Shape group's "it" array must end with a "ty":"tr" transform, even if identity.`,
				path: `${path}.it`,
			});
		}
		for (const [i, sub] of it.entries()) {
			validateColor(sub, `${path}.it[${i}]`, findings);
			if (isRecord(sub)) {
				for (const [key, propValue] of Object.entries(sub)) {
					if (key === "ty") continue;
					validateAnimatableProperty(
						propValue,
						`${path}.it[${i}].${key}`,
						findings,
					);
				}
				if (
					sub.ty === "rc" &&
					"r" in sub &&
					!(isRecord(sub.r) && "k" in sub.r)
				) {
					findings.push({
						severity: "error",
						code: "rect_roundness_not_property",
						message: `Rectangle "r" (roundness) must be a Property object like {"a":0,"k":<number>}, not a bare number. A bare number breaks PropertyFactory and silently blanks the whole composition.`,
						path: `${path}.it[${i}].r`,
					});
				}
			}
		}
	}
};

const validateLayer = (
	layer: unknown,
	index: number,
	composition: { ip: number; op: number },
	findings: LottieFinding[],
): void => {
	const path = `layers[${index}]`;
	if (!isRecord(layer)) {
		findings.push({
			severity: "error",
			code: "layer_not_object",
			message: `Layer ${index} is not an object.`,
			path,
		});
		return;
	}

	if (!("ty" in layer)) {
		findings.push({
			severity: "error",
			code: "layer_missing_ty",
			message: `Layer ${index} is missing the required "ty" (layer type) field.`,
			path,
		});
	}

	if (typeof layer.ip === "number" && typeof layer.op === "number") {
		if (layer.op <= layer.ip) {
			findings.push({
				severity: "error",
				code: "layer_ip_op_order",
				message: `Layer ${index}: "op" (${layer.op}) must be greater than "ip" (${layer.ip}).`,
				path,
			});
		}
		if (layer.ip < composition.ip || layer.op > composition.op) {
			findings.push({
				severity: "warning",
				code: "layer_outside_composition_range",
				message: `Layer ${index}: ip/op range [${layer.ip}, ${layer.op}] extends outside the composition range [${composition.ip}, ${composition.op}].`,
				path,
			});
		}
	}

	if (layer.ty !== 4) return;

	const shapes = layer.shapes;
	if (!Array.isArray(shapes)) {
		findings.push({
			severity: "error",
			code: "shape_layer_missing_shapes",
			message: `Shape layer ${index} (ty:4) is missing a "shapes" array.`,
			path,
		});
		return;
	}

	for (const [i, shape] of shapes.entries()) {
		const shapePath = `${path}.shapes[${i}]`;
		if (!isRecord(shape) || shape.ty !== "gr") {
			findings.push({
				severity: "error",
				code: "bare_shape_item",
				message: `Top-level "shapes" entries must be groups ("ty":"gr"). A bare "${isRecord(shape) ? shape.ty : typeof shape}" item here renders blank.`,
				path: shapePath,
			});
			continue;
		}
		validateGroupItem(shape, shapePath, findings);
	}
};

const validateLottieJson = (doc: unknown): LottieFinding[] => {
	const findings: LottieFinding[] = [];

	if (!isRecord(doc)) {
		return [
			{
				severity: "error",
				code: "root_not_object",
				message: "Document root must be a JSON object.",
			},
		];
	}

	for (const field of ["v", "fr", "ip", "op", "w", "h", "layers"]) {
		if (!(field in doc)) {
			findings.push({
				severity: "error",
				code: "missing_top_level_field",
				message: `Missing required top-level field "${field}".`,
			});
		}
	}

	if (!Array.isArray(doc.layers)) {
		findings.push({
			severity: "error",
			code: "layers_not_array",
			message: `"layers" must be an array.`,
		});
		return findings;
	}

	const ip = typeof doc.ip === "number" ? doc.ip : 0;
	const op = typeof doc.op === "number" ? doc.op : Number.MAX_SAFE_INTEGER;

	if (
		typeof doc.ip === "number" &&
		typeof doc.op === "number" &&
		doc.op <= doc.ip
	) {
		findings.push({
			severity: "error",
			code: "composition_ip_op_order",
			message: `Composition "op" (${doc.op}) must be greater than "ip" (${doc.ip}).`,
		});
	}

	for (const [i, layer] of doc.layers.entries()) {
		validateLayer(layer, i, { ip, op }, findings);
	}

	return findings;
};

const formatResult = (findings: LottieFinding[], file: string): string => {
	const errorCount = findings.filter((f) => f.severity === "error").length;
	const warningCount = findings.filter((f) => f.severity === "warning").length;

	const errPart =
		errorCount > 0 ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : "";
	const warnPart =
		warningCount > 0
			? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
			: "";
	const summary =
		errorCount === 0
			? `✓ Valid${warnPart ? ` (${warnPart})` : ""}`
			: `✗ ${[errPart, warnPart].filter(Boolean).join(", ")}`;

	const lines = [`Lottie lint [${file}]: ${summary}`];
	for (const f of findings) {
		const tag = f.severity === "error" ? "ERROR" : "WARNING";
		lines.push(`  ${tag} [${f.code}] ${f.message}`);
		if (f.path) lines.push(`    at: ${f.path}`);
	}

	return lines.join("\n");
};

export const createLottieValidateTool: ToolFactory<
	Input,
	Services,
	LottieToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Lint a Lottie/Bodymovin animation for structural errors (missing shape groups, missing transforms, malformed keyframes, unnormalized colors). Run after lottie_write and before lottie_show.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = animationFile(input.project_path, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return `Error: ${file} not found. Use lottie_init to create the project first.`;
		}

		const json = new TextDecoder().decode(raw);
		let doc: unknown;
		try {
			doc = JSON.parse(json);
		} catch (error) {
			return `Error: ${file} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`;
		}

		return formatResult(validateLottieJson(doc), file);
	},
});

toolRegistry.register(TOOL_NAME, createLottieValidateTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: LottieToolConfig;
		};
	}
}
