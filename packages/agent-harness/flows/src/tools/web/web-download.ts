import z from "zod";
import type { Tool, ToolFactory } from "../../interfaces/engine/tool.js";
import { toolRegistry } from "../../registries/tool-registry.js";
import {
	optionalToolBoolean,
	optionalToolInteger,
	optionalWebString,
	webUrl,
} from "./web-input.js";
import {
	MAX_WEB_MAX_HTML_CHARS,
	MIN_WEB_MAX_HTML_CHARS,
	normalizeWebMaxHtmlChars,
} from "./max-html-chars.js";
import {
	downloadWebResource,
	saveWebResource,
	WEB_DOWNLOAD_MAX_BYTES,
	WEB_DOWNLOAD_TIMEOUT_MS,
	WEB_DOWNLOADS_DIR,
	type WebResourceServices,
} from "./web-resource.js";
import {
	createDefaultWebErrorResult,
	createWebResult,
	truncateContent,
} from "./web-tool-utils.js";

const TOOL_NAME = "web_download" as const;

const schema = z.object({
	url: webUrl().describe(
		"Address of the file to download: a PDF, image, audio, video, archive, document or any other data.",
	),
	sessionId: optionalWebString().describe(
		"Web session whose page fetches the file, so a file behind the site's login comes through. Downloads directly without one.",
	),
	file_path: optionalWebString().describe(
		`Where to save it in the root filesystem: a file path, or a folder ending in "/". Default: ${WEB_DOWNLOADS_DIR}/<filename>`,
	),
	includeText: optionalToolBoolean().describe(
		"Also return the file's readable text (a PDF's pages, a CSV). Default false.",
	),
	maxChars: optionalToolInteger().describe(
		`Limit the returned text when includeText is true. Values are clamped to ${MIN_WEB_MAX_HTML_CHARS}-${MAX_WEB_MAX_HTML_CHARS}.`,
	),
	timeoutMs: optionalToolInteger().describe(
		`Download timeout in milliseconds (default ${WEB_DOWNLOAD_TIMEOUT_MS}).`,
	),
});

type Input = z.infer<typeof schema>;

export const createWebDownloadTool: ToolFactory<Input, WebResourceServices> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Download a file from a URL — a PDF, image, audio, video, archive, spreadsheet or any other data — and save it to the root filesystem. " +
		`Pass the sessionId of the page that links to it when the file needs that site's login. Returns the saved path, type and size; files stop at ${WEB_DOWNLOAD_MAX_BYTES / 1024 / 1024} MB.`,
	schema,
	execute: async (input) => {
		try {
			if (!services.fs) {
				throw new Error("No filesystem is available to save the file to.");
			}
			const resource = await downloadWebResource(services, {
				url: input.url,
				sessionId: input.sessionId,
				timeoutMs: Math.max(1_000, input.timeoutMs ?? WEB_DOWNLOAD_TIMEOUT_MS),
			});
			const saved = await saveWebResource(services, resource, {
				filePath: input.file_path,
				readText: input.includeText ?? false,
			});
			return createWebResult({
				actionType: TOOL_NAME,
				success: true,
				requestedUrl: input.url,
				url: saved.url,
				file_path: saved.path,
				mimeType: saved.mimeType,
				size: saved.size,
				...(input.includeText
					? {
							text: saved.text
								? truncateContent(
										saved.text,
										normalizeWebMaxHtmlChars(input.maxChars),
									)
								: null,
						}
					: {}),
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebDownloadTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: WebResourceServices;
		};
	}
}
