import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import type { HyperframesToolConfig } from "./config";
// The browser entry: the same rules without the Node-only project linting
// (fs, child_process, module) that core/lint pulls in since 0.8.
import {
	lintHyperframeHtml,
	type HyperframeLintResult,
} from "@hyperframes/lint/browser";
import { unresolvedLocalImageReferences } from "./composition-preprocessor";
import {
	HYPERFRAMES_BUNDLED_FONTS,
	unbundledFontFamilies,
	usedFontFamilies,
} from "./fonts";
import {
	DESIGN_SPEC_FILES,
	designTokens,
	normalizeHex,
	parseDesignSpec,
} from "./frame-presets";
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

// Codes that are always noise for compositions the Memorall runner plays:
// - missing_gsap_script / missing_three_script: the runner loads GSAP and
//   Three.js when the composition uses them; compositions carry no script tags.
// - nested_structure_needs_subcomposition: scenes wrap their content in
//   .scene-content by design (every init template does).
const SUPPRESSED_CODES = new Set([
	"missing_gsap_script",
	"missing_three_script",
	"nested_structure_needs_subcomposition",
]);

// The renderer substitutes a generic font for an undeclared family: a look
// problem, not a broken video, and upstream's hint (captured .woff2 files)
// does not apply here.
//
// Scene visibility toggles (`tl.set("#s2", { autoAlpha: 1 }, ...)`) were how
// compositions worked before HyperFrames 0.8; the runtime now shows each clip
// in its data-start window by itself, and such toggles still render the same,
// so projects written that way keep showing while the agent cleans them up.
const adjustFinding = (finding: HyperframeFinding): HyperframeFinding => {
	if (finding.code === "font_family_without_font_face") {
		return {
			...finding,
			severity: "warning",
			fixHint: `Use a bundled font, which renders the same in preview and MP4: ${HYPERFRAMES_BUNDLED_FONTS.join(", ")}. Other families fall back to a generic font.`,
		};
	}
	if (finding.code === "gsap_animates_clip_element") {
		return {
			...finding,
			severity: "warning",
			fixHint:
				"Delete this tween: the runtime shows a clip only inside its data-start/data-duration window. Animate a child element (e.g. .scene-content) for fades.",
		};
	}
	return finding;
};

const filterFindings = (result: HyperframeLintResult): HyperframeLintResult => {
	const findings = result.findings
		.filter((f) => !SUPPRESSED_CODES.has(f.code ?? ""))
		.map(adjustFinding);
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
	const inits = hyperShaderInitObjects(html);
	// Every call draws on the same #gl-canvas and the same per-composition
	// state, so only the last call's transitions show.
	if (inits.length > 1) {
		findings.push({
			severity: "error",
			code: "multiple_hypershader_init",
			message: `HyperShader.init() is called ${inits.length} times; it supports one call per composition, and only the last call's transitions show.`,
			fixHint:
				"Call HyperShader.init() once: list consecutive scenes in order in `scenes`, with one transition per boundary between them (a transition without `shader` is a crossfade). Put the shader moments on adjacent boundaries, and leave every other cut to the scenes' data-start windows.",
			snippet: `HyperShader.init() calls: ${inits.length}`,
		});
	}
	for (const objectText of inits) {
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
				"Remove manual Tailwind script/link tags; the preview runner always loads Tailwind v4 (with its preflight and the hf-* theme).",
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

// Upstream's font rule reads font-family declarations only; compositions set
// their families through custom properties (--font-display) as well.
const fontFindings = (
	html: string,
	reported: HyperframeFinding[],
): HyperframeFinding[] => {
	const alreadyReported = reported
		.filter((finding) => finding.code === "font_family_without_font_face")
		.map((finding) => finding.message.toLowerCase());
	const missing = unbundledFontFamilies(html).filter(
		(family) =>
			!alreadyReported.some((message) =>
				message.includes(family.toLowerCase()),
			),
	);
	if (missing.length === 0) return [];
	return [
		{
			severity: "warning",
			code: "font_family_without_font_face",
			message: `Font ${missing.length === 1 ? "family" : "families"} not bundled with HyperFrames: ${missing.join(", ")}. Text falls back to a generic font in the preview and the MP4.`,
			fixHint: `Use a bundled font, which renders the same in preview and MP4: ${HYPERFRAMES_BUNDLED_FONTS.join(", ")}.`,
		},
	];
};

const HEX_COLOR =
	/(?<![\w&])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![0-9a-z])/gi;

/** The project's design spec, the first that exists: frame.md → design.md → DESIGN.md. */
const readDesignSpec = async (
	dfs: NonNullable<Services["fs"]>,
	projectPath: string,
	fsConfig?: HyperframesToolConfig,
): Promise<{ name: string; text: string } | null> => {
	for (const name of DESIGN_SPEC_FILES) {
		try {
			const bytes = await readFileBytes(
				dfs,
				`${projectPath}/${name}`,
				fsConfig,
			);
			return { name, text: new TextDecoder().decode(bytes) };
		} catch {
			// Try the next one.
		}
	}
	return null;
};

/**
 * Design adherence: with a spec in the project, its colors and fonts are the
 * brand. Colors written in the markup and styles (scripts aside) that are not
 * in its palette, and fonts not in its typography, are reported.
 */
const designFindings = async (
	html: string,
	dfs: NonNullable<Services["fs"]>,
	projectPath: string,
	fsConfig?: HyperframesToolConfig,
): Promise<HyperframeFinding[]> => {
	const spec = await readDesignSpec(dfs, projectPath, fsConfig);
	if (!spec) return [];
	const tokens = designTokens(parseDesignSpec(spec.text));
	const findings: HyperframeFinding[] = [];
	const palette = new Set(
		Object.values(tokens.colors)
			.map(normalizeHex)
			.filter((value): value is string => Boolean(value)),
	);
	if (palette.size > 0) {
		const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
		const off = new Set<string>();
		for (const match of markup.matchAll(HEX_COLOR)) {
			const color = normalizeHex(match[0]);
			if (color && !palette.has(color)) off.add(match[0]);
		}
		if (off.size > 0) {
			findings.push({
				severity: "warning",
				code: "off_palette_color",
				message: `${off.size} color${off.size === 1 ? "" : "s"} not in ${spec.name}'s palette: ${[...off].slice(0, 8).join(", ")}${off.size > 8 ? ", …" : ""}.`,
				fixHint: `Use ${spec.name}'s colors verbatim (or var(--c-<name>)): ${Object.entries(
					tokens.colors,
				)
					.map(([name, value]) => `${name} ${value}`)
					.join(", ")}.`,
			});
		}
	}
	if (tokens.families.length > 0) {
		const allowed = new Set(
			tokens.families.map((family) => family.toLowerCase()),
		);
		const offFonts = usedFontFamilies(html).filter(
			(family) => !allowed.has(family.toLowerCase()),
		);
		if (offFonts.length > 0) {
			findings.push({
				severity: "warning",
				code: "off_spec_font",
				message: `Font${offFonts.length === 1 ? "" : "s"} not in ${spec.name}'s typography: ${offFonts.join(", ")}.`,
				fixHint: `${spec.name} sets the type: ${tokens.families.join(", ")}.`,
			});
		}
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
		...fontFindings(html, base.findings),
		...(await designFindings(
			html,
			dfs,
			normalizeProjectPath(projectPath, rootPath),
			fsConfig,
		)),
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

export const formatLintResult = (
	result: HyperframeLintResult,
	file: string,
): string => {
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

/**
 * Lints a composition that was just saved, for the write and edit tools to
 * report alongside the save: one tool call instead of write then validate.
 */
export const lintSavedComposition = async (
	html: string,
	dfs: NonNullable<Services["fs"]>,
	projectPath: string,
	file: string,
	config?: HyperframesToolConfig,
): Promise<string> => {
	try {
		const result = await lintHyperframesComposition(
			html,
			dfs,
			normalizeProjectPath(projectPath, config?.rootPath),
			config?.rootPath,
			config?.resourceRoots,
			config,
		);
		const report = formatLintResult(result, file);
		return result.ok
			? report
			: `${report}\nFix these errors with hyperframes_edit before hyperframes_show.`;
	} catch (error) {
		return `Linter error: ${error instanceof Error ? error.message : String(error)}`;
	}
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
			return formatLintResult(
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
