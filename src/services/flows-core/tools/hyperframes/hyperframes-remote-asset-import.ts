import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { writeFlowFileBytes } from "flow-core/utils/fs-utils";
import {
	createDefaultWebErrorResult,
	createWebResult,
} from "flow-core/tools/web/web-tool-utils";
import {
	downloadResourceBytes,
	filenameFromUrl,
} from "flow-core/utils/download-resource";
import { normalizeProjectPath } from "flow-core/tools/hyperframes/util";

const TOOL_NAME = "hyperframes_remote_asset_import" as const;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe(
			"HyperFrames project directory, e.g. /workspaces/product-launch.",
		),
	url: z.string().url().describe("Remote image or SVG URL to import."),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Deprecated. Remote asset import downloads the candidate URL directly.",
		),
	asset_path: z
		.string()
		.optional()
		.describe(
			"Optional relative path inside the project's resources folder, e.g. images/hero.jpg. Do not include project_path.",
		),
});

type Input = z.infer<typeof schema>;

const sanitizeFilename = (filename: string): string => {
	const cleaned = filename
		.replace(/[?#].*$/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned || `asset-${crypto.randomUUID()}`;
};

const normalizeResourceAssetPath = (
	assetPath: string | undefined,
	defaultFilename: string,
): string => {
	const raw = (assetPath?.trim() || `images/${defaultFilename}`)
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/^resources\/+/i, "");
	const parts = raw.split("/").filter(Boolean);
	if (!parts.length) return `images/${defaultFilename}`;
	if (parts.some((part) => part === "." || part === "..")) {
		throw new Error(
			"asset_path must stay inside the project resources folder.",
		);
	}
	return parts
		.map((part, index) =>
			index === parts.length - 1 ? sanitizeFilename(part) : part,
		)
		.join("/");
};

type Services = Pick<AllServices, "fs">;

export const createHyperframesRemoteAssetImportTool: ToolFactory<
	Input,
	Services
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Import a remote image/SVG into a HyperFrames project's resources folder. Takes project_path and saves under {project_path}/resources/..., returning the relative ./resources/... src to use in index.html.",
	schema,
	execute: async (input) => {
		try {
			const projectPath = normalizeProjectPath(input.project_path);
			const { bytes, mimeType, finalUrl } = await downloadResourceBytes({
				url: input.url,
				allowedMimeTypes: ["image/*"],
			});
			const defaultFilename = sanitizeFilename(
				filenameFromUrl(input.url, mimeType),
			);
			const assetPath = normalizeResourceAssetPath(
				input.asset_path,
				defaultFilename,
			);
			const filePath = `${projectPath}/resources/${assetPath}`;
			if (!services.fs) {
				throw new Error("Filesystem service is not available.");
			}
			await writeFlowFileBytes(services.fs, filePath, bytes);

			return createWebResult({
				actionType: TOOL_NAME,
				success: true,
				project_path: projectPath,
				file_path: filePath,
				html_src: `./resources/${assetPath}`,
				mimeType,
				size: bytes.length,
				url: input.url,
				finalUrl,
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesRemoteAssetImportTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: { input: Input; services: Services };
	}
}
