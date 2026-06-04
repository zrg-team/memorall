import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { normalizeDocumentPath } from "../documents/util";
import { writeFileBytes } from "flow-core/tools/fs/util";
import {
	fetchImageFromSession,
	getLatestTabSession,
	createDefaultWebErrorResult,
	createWebResult,
} from "./web-tool-registry";
import {
	decodeBase64Bytes,
	downloadResourceBytes,
	filenameFromUrl,
} from "flow-core/utils/download-resource";

const TOOL_NAME = "web_fetch_image" as const;

export const fetchImageBytesFromBrowserSession = async (
	url: string,
	sessionId?: string,
): Promise<{
	sessionId: string;
	bytes: Uint8Array;
	mimeType: string;
}> => {
	const resolvedSessionId = sessionId ?? getLatestTabSession()?.sessionId;
	if (!resolvedSessionId) {
		const downloaded = await downloadResourceBytes({
			url,
			allowedMimeTypes: ["image/*"],
		});
		return {
			sessionId: "",
			bytes: downloaded.bytes,
			mimeType: downloaded.mimeType,
		};
	}

	const { base64, mimeType } = await fetchImageFromSession(
		resolvedSessionId,
		url,
	);

	return {
		sessionId: resolvedSessionId,
		bytes: decodeBase64Bytes(base64),
		mimeType,
	};
};

const schema = z.object({
	url: z.string().url().describe("Image URL to fetch and store in /documents."),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Optional active web session whose tab fetches the image. Uses direct fetch when no tab session is available.",
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
		"Fetch an image from a URL and save it to /documents. Uses an active web session when available, otherwise downloads directly. Returns the stored file path.",
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
