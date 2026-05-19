import z from "zod";
import type {
	Tool,
	ToolFactory,
	AllServices,
} from "@/services/flows/interfaces/tool";
import { toolRegistry } from "@/services/flows/tool-registry";
import { normalizeDocumentPath } from "../documents/util";
import {
	fetchImageFromSession,
	getLatestTabSession,
	createDefaultWebErrorResult,
	createWebResult,
} from "./web-tool-registry";

const TOOL_NAME = "web_fetch_image" as const;

const MIME_TO_EXT: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/gif": ".gif",
	"image/webp": ".webp",
	"image/svg+xml": ".svg",
	"image/bmp": ".bmp",
	"image/tiff": ".tiff",
};

const extFromMime = (mimeType: string): string =>
	MIME_TO_EXT[mimeType] ?? ".png";

const filenameFromUrl = (url: string, mimeType: string): string => {
	try {
		const { pathname } = new URL(url);
		const base = pathname.split("/").filter(Boolean).pop() ?? "";
		if (base && /\.\w{2,5}$/.test(base)) return base;
	} catch {
		// invalid URL — fall through
	}
	return `image-${crypto.randomUUID()}${extFromMime(mimeType)}`;
};

const ensureFolderExists = async (
	dfs: NonNullable<AllServices["documentFileSystem"]>,
	folderPath: string,
): Promise<void> => {
	if (folderPath === "/" || !folderPath) return;
	const segments = folderPath.split("/").filter(Boolean);
	let currentPath = "/";
	for (const segment of segments) {
		const nextPath = `${currentPath === "/" ? "" : currentPath}/${segment}`;
		try {
			await dfs.createFolder(segment, currentPath);
		} catch {
			// folder already exists — continue
		}
		currentPath = nextPath;
	}
};

const schema = z.object({
	url: z.string().url().describe("Image URL to fetch and store in /documents."),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Active web session whose tab fetches the image. Uses the most-recent tab session if omitted.",
		),
	file_path: z
		.string()
		.optional()
		.describe(
			"Where to save the image inside /documents. Default: /resources/images/<filename>",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "documentFileSystem">;

export const createWebFetchImageTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Fetch an image from a URL via the active web session's browser tab and save it to /documents. Returns the stored file path. Requires an open web session (tab or window mode).",
	schema,
	execute: async (input) => {
		const dfs = services.documentFileSystem;
		if (!dfs) {
			return createDefaultWebErrorResult(
				new Error("Document filesystem service is not available."),
			);
		}

		try {
			// Resolve which session to use
			let resolvedSessionId: string | undefined = input.sessionId;
			if (!resolvedSessionId) {
				const latest = getLatestTabSession();
				if (!latest) {
					return createDefaultWebErrorResult(
						new Error(
							"No active browser tab session found. Open a web session with web_open first.",
						),
					);
				}
				resolvedSessionId = latest.sessionId;
			}

			// Fetch image bytes via content script in the session's tab
			const { base64, mimeType } = await fetchImageFromSession(
				resolvedSessionId,
				input.url,
			);

			// Decode base64 → Uint8Array
			const binaryStr = atob(base64);
			const bytes = new Uint8Array(binaryStr.length);
			for (let i = 0; i < binaryStr.length; i++) {
				bytes[i] = binaryStr.charCodeAt(i);
			}

			// Resolve output path
			const filename = filenameFromUrl(input.url, mimeType);
			const rawPath = input.file_path ?? `/resources/images/${filename}`;
			const filePath = normalizeDocumentPath(rawPath);
			const lastSlash = filePath.lastIndexOf("/");
			const parentPath = lastSlash > 0 ? filePath.substring(0, lastSlash) : "/";
			const fileName = filePath.substring(lastSlash + 1) || filename;

			await ensureFolderExists(dfs, parentPath);

			const file = new File([bytes], fileName, { type: mimeType });
			await dfs.uploadFile(file, parentPath);

			return createWebResult({
				actionType: "web_fetch_image",
				success: true,
				file_path: filePath,
				mimeType,
				size: bytes.length,
				url: input.url,
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebFetchImageTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
