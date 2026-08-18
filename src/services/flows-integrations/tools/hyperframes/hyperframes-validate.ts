import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import type { HyperframesToolConfig } from "./config";
import {
	lintHyperframeHtml,
	type HyperframeLintResult,
} from "@hyperframes/core/lint";
import { unresolvedLocalImageReferences } from "./composition-preprocessor";
import { compositionFile, normalizeProjectPath } from "./util";
import { readFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";

const TOOL_NAME = "hyperframes_validate" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"Absolute path to the project directory, e.g. /projects/product-launch",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

// Codes that are always noise in the extension context:
// - external_script_dependency: fix hint says "no action needed" for CDN-based compositions
// - missing_gsap_script: runner auto-injects GSAP based on usage detection
// - invalid_inline_script_syntax: CSP eval() false-positive; our preprocessor handles this
// - pointer_events_none: intentional for .grain overlay elements
const SUPPRESSED_CODES = new Set([
	"external_script_dependency",
	"missing_gsap_script",
	"invalid_inline_script_syntax",
	"pointer_events_none",
]);

const filterFindings = (result: HyperframeLintResult): HyperframeLintResult => {
	const findings = result.findings.filter(
		(f) => !SUPPRESSED_CODES.has(f.code ?? ""),
	);
	const errorCount = findings.filter((f) => f.severity === "error").length;
	const warningCount = findings.filter((f) => f.severity === "warning").length;
	return {
		...result,
		findings,
		ok: errorCount === 0,
		errorCount,
		warningCount,
	};
};

type HyperframeFinding = HyperframeLintResult["findings"][number];

const recountFindings = (
	result: HyperframeLintResult,
): HyperframeLintResult => {
	const errorCount = result.findings.filter(
		(f) => f.severity === "error",
	).length;
	const warningCount = result.findings.filter(
		(f) => f.severity === "warning",
	).length;
	return {
		...result,
		ok: errorCount === 0,
		errorCount,
		warningCount,
	};
};

const scanBalanced = (
	text: string,
	start: number,
	open: string,
	close: string,
): { body: string; end: number } | null => {
	let depth = 0;
	let quote: string | null = null;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const char = text[i];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}

		if (char === open) depth++;
		if (char === close) depth--;
		if (depth === 0) {
			return { body: text.slice(start + 1, i), end: i };
		}
	}

	return null;
};

const hyperShaderInitObjects = (html: string): string[] => {
	const objects: string[] = [];
	const pattern = /HyperShader\s*\.\s*init\s*\(/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(html))) {
		let index = pattern.lastIndex;
		while (/\s/.test(html[index] ?? "")) index++;
		if (html[index] !== "{") continue;
		const balanced = scanBalanced(html, index, "{", "}");
		if (balanced) objects.push(balanced.body);
	}
	return objects;
};

const extractArrayProperty = (
	objectText: string,
	property: string,
): string | null => {
	const pattern = new RegExp(`(?:^|[,\\{])\\s*${property}\\s*:\\s*\\[`, "m");
	const match = pattern.exec(objectText);
	if (!match) return null;
	const bracketIndex = match.index + match[0].lastIndexOf("[");
	return scanBalanced(objectText, bracketIndex, "[", "]")?.body ?? null;
};

const countTopLevelArrayItems = (arrayBody: string): number => {
	if (!arrayBody.trim()) return 0;

	let depth = 0;
	let quote: string | null = null;
	let escaped = false;
	let count = 1;

	for (let i = 0; i < arrayBody.length; i++) {
		const char = arrayBody[i];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}

		if (char === "{" || char === "[" || char === "(") depth++;
		if (char === "}" || char === "]" || char === ")") depth--;
		if (char === "," && depth === 0) count++;
	}

	return count;
};

const countSceneIds = (arrayBody: string): number => {
	const matches = [...arrayBody.matchAll(/(["'])(.*?)\1/g)];
	return matches.length || countTopLevelArrayItems(arrayBody);
};

const hyperShaderFindings = (html: string): HyperframeFinding[] => {
	const findings: HyperframeFinding[] = [];
	for (const objectText of hyperShaderInitObjects(html)) {
		const scenes = extractArrayProperty(objectText, "scenes");
		const transitions = extractArrayProperty(objectText, "transitions");
		if (scenes === null || transitions === null) continue;

		const sceneCount = countSceneIds(scenes);
		const transitionCount = countTopLevelArrayItems(transitions);
		if (sceneCount !== transitionCount + 1) {
			findings.push({
				severity: "error",
				code: "hypershader_scene_transition_count",
				message: `HyperShader.init() expected scenes.length === transitions.length + 1, got scenes=${sceneCount}, transitions=${transitionCount}.`,
				fixHint:
					"Remove the extra transition or add the missing scene ID so each shader group has exactly one fewer transition than scenes.",
				snippet: `scenes.length=${sceneCount}; transitions.length=${transitionCount}`,
			});
		}
	}
	return findings;
};

const tailwindSafetyFindings = (html: string): HyperframeFinding[] => {
	const findings: HyperframeFinding[] = [];

	if (
		/<script\b[^>]*\bsrc=["'][^"']*cdn\.tailwindcss\.com[^"']*["'][^>]*>/i.test(
			html,
		) ||
		/<link\b[^>]*\bhref=["'][^"']*tailwind(?:\.min)?\.css[^"']*["'][^>]*>/i.test(
			html,
		)
	) {
		findings.push({
			severity: "warning",
			code: "manual_tailwind_loader",
			message:
				"Tailwind should be authored as classes only; the HyperFrames runner loads Tailwind for preview.",
			fixHint:
				"Remove manual Tailwind script/link tags; the preview runner always loads Tailwind with preflight disabled.",
		});
	}

	if (
		/(?:className|classList\s*\.\s*add|setAttribute\s*\(\s*["']class["'])[\s\S]{0,160}(?:\+|`[\s\S]*\$\{)/i.test(
			html,
		)
	) {
		findings.push({
			severity: "warning",
			code: "dynamic_tailwind_class",
			message:
				"Dynamic class construction is unreliable with Tailwind browser compilation.",
			fixHint:
				"Use literal class strings in HTML so Tailwind can discover every utility before preview/export.",
		});
	}

	if (/\bclass=["'][^"']*\banimate-[^\s"']+/i.test(html)) {
		findings.push({
			severity: "warning",
			code: "tailwind_animation_class",
			message:
				"Tailwind animation utilities are not deterministic for HyperFrames seeking and MP4 export.",
			fixHint: "Use GSAP timeline tweens for all scene animation.",
		});
	}

	if (/<style\b[\s\S]*?\banimation\s*:[\s\S]*?<\/style>/i.test(html)) {
		findings.push({
			severity: "warning",
			code: "css_animation_property",
			message:
				"CSS animation properties are not controlled by the HyperFrames timeline.",
			fixHint:
				"Move time-based motion into GSAP so preview scrubbing and export remain deterministic.",
		});
	}

	return findings;
};

const assetFindings = async (
	html: string,
	dfs: NonNullable<Services["fs"]>,
	projectPath: string,
	rootPath?: string,
	resourceRoots?: string[],
	fsConfig?: HyperframesToolConfig,
): Promise<HyperframeFinding[]> => {
	const missing = await unresolvedLocalImageReferences(
		html,
		dfs,
		projectPath,
		rootPath,
		resourceRoots,
		fsConfig,
	);
	return missing.map((ref) => ({
		severity: "error",
		code: "missing_local_image_asset",
		message: `Local image asset could not be resolved: ${ref}`,
		fixHint:
			"Import the asset into the project resources folder or update the reference to an existing resource path.",
		snippet: ref,
	}));
};

export const lintHyperframesComposition = async (
	html: string,
	dfs: NonNullable<Services["fs"]>,
	projectPath: string,
	rootPath?: string,
	resourceRoots?: string[],
	fsConfig?: HyperframesToolConfig,
): Promise<HyperframeLintResult> => {
	const base = filterFindings(await lintHyperframeHtml(html));
	const findings = [
		...base.findings,
		...hyperShaderFindings(html),
		...tailwindSafetyFindings(html),
		...(await assetFindings(
			html,
			dfs,
			projectPath,
			rootPath,
			resourceRoots,
			fsConfig,
		)),
	];
	return recountFindings({ ...base, findings });
};

const formatResult = (result: HyperframeLintResult, file: string): string => {
	const errPart =
		result.errorCount > 0
			? `${result.errorCount} error${result.errorCount === 1 ? "" : "s"}`
			: "";
	const warnPart =
		result.warningCount > 0
			? `${result.warningCount} warning${result.warningCount === 1 ? "" : "s"}`
			: "";
	const summary = result.ok
		? `✓ Valid${warnPart ? ` (${warnPart})` : ""}`
		: `✗ ${[errPart, warnPart].filter(Boolean).join(", ")}`;

	const lines = [`HyperFrames lint [${file}]: ${summary}`];

	for (const f of result.findings) {
		const tag = f.severity === "error" ? "ERROR" : "WARNING";
		const code = f.code ? ` [${f.code}]` : "";
		lines.push(`  ${tag}${code} ${f.message}`);
		if (f.selector) lines.push(`    selector: ${f.selector}`);
		if (f.fixHint) lines.push(`    Fix: ${f.fixHint}`);
		if (f.snippet) lines.push(`    > ${f.snippet.trim()}`);
	}

	return lines.join("\n");
};

export const createHyperframesValidateTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Lint a HyperFrames composition for structural errors (missing timeline, broken scene windows, invalid attributes). Run after hyperframes_write and before hyperframes_show.",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) return "Error: fs service not available.";

		const file = compositionFile(input.project_path, config?.rootPath);
		let raw: Uint8Array;
		try {
			raw = await readFileBytes(dfs, file, config);
		} catch {
			return `Error: ${file} not found. Use hyperframes_write to create the project first.`;
		}

		const html = new TextDecoder().decode(raw);
		try {
			return formatResult(
				await lintHyperframesComposition(
					html,
					dfs,
					normalizeProjectPath(input.project_path, config?.rootPath),
					config?.rootPath,
					config?.resourceRoots,
					config,
				),
				file,
			);
		} catch (error) {
			return `Linter error: ${error instanceof Error ? error.message : String(error)}`;
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesValidateTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
