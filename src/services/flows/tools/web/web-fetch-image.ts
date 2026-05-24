import z from "zod";
import type { Tool, ToolFactory, AllServices } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import { normalizeDocumentPath } from "../documents/util";
import { writeFileBytes } from "../fs/util";
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

export const extFromMime = (mimeType: string): string =>
	MIME_TO_EXT[mimeType] ?? ".png";

export const filenameFromUrl = (url: string, mimeType: string): string => {
	try {
		const { pathname } = new URL(url);
		const base = pathname.split("/").filter(Boolean).pop() ?? "";
		if (base && /\.\w{2,5}$/.test(base)) return base;
	} catch {
		// invalid URL — fall through
	}
	return `image-${crypto.randomUUID()}${extFromMime(mimeType)}`;
};

export const fetchImageBytesFromBrowserSession = async (
	url: string,
	sessionId?: string,
): Promise<{
	sessionId: string;
	bytes: Uint8Array;
	mimeType: string;
}> => {
	let resolvedSessionId: string | undefined = sessionId;
	if (!resolvedSessionId) {
		const latest = getLatestTabSession();
		if (!latest) {
			throw new Error(
				"No active browser tab session found. Open a web session with web_open first.",
			);
		}
		resolvedSessionId = latest.sessionId;
	}

	const { base64, mimeType } = await fetchImageFromSession(
		resolvedSessionId,
		url,
	);
	const binaryStr = atob(base64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) {
		bytes[i] = binaryStr.charCodeAt(i);
	}

	return { sessionId: resolvedSessionId, bytes, mimeType };
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
type Services = Pick<AllServices, "fs">;

export const createWebFetchImageTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Fetch an image from a URL via the active web session's browser tab and save it to /documents. Returns the stored file path. Requires an open web session (tab or window mode).",
	schema,
	execute: async (input) => {
		const dfs = services.fs;
		if (!dfs) {
			return createDefaultWebErrorResult(
				new Error("Document filesystem service is not available."),
			);
		}

		try {
			const { bytes, mimeType } = await fetchImageBytesFromBrowserSession(
				input.url,
				input.sessionId,
			);

			// Resolve output path
			const filename = filenameFromUrl(input.url, mimeType);
			const rawPath = input.file_path ?? `/resources/images/${filename}`;
			const filePath = normalizeDocumentPath(rawPath);
			await writeFileBytes(dfs, filePath, bytes);

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
