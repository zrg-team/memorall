import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import { logInfo } from "@/utils/logger";
import { normalizeDocumentPath } from "../files/util";
import { writeFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";
import {
	fetchImageFromSession,
	captureImageFromSession,
	getTabSessionForUrl,
	createDefaultWebErrorResult,
	createWebResult,
} from "./web-tool-registry";
import {
	decodeBase64Bytes,
	downloadResourceBytes,
	filenameFromUrl,
} from "@memorall/agent-harness-flows/utils/download-resource";

const TOOL_NAME = "web_fetch_image" as const;

const downloadDirectly = async (
	url: string,
): Promise<{ sessionId: string; bytes: Uint8Array; mimeType: string }> => {
	const downloaded = await downloadResourceBytes({
		url,
		allowedMimeTypes: ["image/*"],
	});
	return {
		sessionId: "",
		bytes: downloaded.bytes,
		mimeType: downloaded.mimeType,
	};
};

/**
 * Get an image, preferring a page's own tab but never depending on one.
 *
 * A session is an optimisation, not a requirement: fetching from inside the tab
 * sends the site's cookies and its own Referer, which is how images behind a
 * login or a hotlink check come back at all. A plain download works for
 * everything else.
 *
 * It used to fall back only when no session existed. If one did exist but its
 * tab was gone — the user closed it, or the ten-minute inactivity close reaped
 * it — the session path threw "The browser web session tab was closed." and the
 * whole call failed, on an image that a direct download would have returned. The
 * candidate session is a guess (the most recently used tab, which may have
 * nothing to do with this URL), so it must never be the only way through.
 */
export const fetchImageBytesFromBrowserSession = async (
	url: string,
	sessionId?: string,
): Promise<{
	sessionId: string;
	bytes: Uint8Array;
	mimeType: string;
}> => {
	const resolvedSessionId = sessionId ?? getTabSessionForUrl(url)?.sessionId;
	if (!resolvedSessionId) {
		return downloadDirectly(url);
	}

	try {
		const { base64, mimeType } = await fetchImageFromSession(
			resolvedSessionId,
			url,
		);
		return {
			sessionId: resolvedSessionId,
			bytes: decodeBase64Bytes(base64),
			mimeType,
		};
	} catch (sessionError) {
		logInfo(
			`Image fetch through session ${resolvedSessionId} failed; downloading directly.`,
			sessionError,
		);
		let directError: unknown;
		try {
			return await downloadDirectly(url);
		} catch (error) {
			directError = error;
		}

		// Neither request could be made to look like the page's own. Let the page
		// open the image in a tab — that navigation carries its Referer — and read
		// what the browser rendered. Measured to be the only route that works on a
		// host with hotlink protection.
		try {
			const captured = await captureImageFromSession(resolvedSessionId, url);
			return {
				sessionId: resolvedSessionId,
				bytes: decodeBase64Bytes(captured.base64),
				mimeType: captured.mimeType,
			};
		} catch (captureError) {
			const reason = (error: unknown) =>
				error instanceof Error ? error.message : String(error);
			throw new Error(
				`Could not read ${url}. Through the page session: ${reason(sessionError)}. Downloading directly: ${reason(directError)}. Opening it in a tab: ${reason(captureError)}.`,
			);
		}
	}
};

const schema = z.object({
	url: z
		.string()
		.url()
		.describe("Image URL to fetch and store in the root filesystem."),
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
			"Where to save the image inside the root filesystem. Default: /resources/images/<filename>",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

export const createWebFetchImageTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Fetch an image from a URL and save it to the root filesystem. Uses an active web session when available, otherwise downloads directly. Returns the stored file path.",
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
