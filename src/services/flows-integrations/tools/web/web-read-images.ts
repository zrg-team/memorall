import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@memorall/agent-harness-flows/interfaces/engine/tool";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import type { ToolResultValue } from "@memorall/agent-harness-flows/interfaces/engine/tool";
import { toolRegistry } from "@memorall/agent-harness-flows/registries/tool-registry";
import { writeFileBytes } from "@memorall/agent-harness-flows/tools/fs/util";
import { filenameFromUrl } from "@memorall/agent-harness-flows/utils/download-resource";
import type { ChatCompletionContentPart } from "@/types/openai";
import { normalizeDocumentPath } from "../files/util";
import { fetchImageBytesFromBrowserSession } from "./web-fetch-image";
import { createDefaultWebErrorResult } from "./web-tool-registry";

const TOOL_NAME = "web_read_images" as const;

/**
 * Looking at the pictures on a page, without putting them through the DOM.
 *
 * A page's images used to reach the model the worst possible way: as the "text"
 * of their own `<img>` elements, because some sites hang the raw bytes there.
 * Thirty of those filled a one-million-token context with JFIF garbage that no
 * model can see anything in. The element text is now empty by design, so this is
 * the way in — the agent collects `src` URLs from `web_dom_action`, hands them
 * here, and gets back real image parts the model can actually look at.
 *
 * Fetched through the session's own tab when there is one, so images behind a
 * login or a hotlink check come back for the same reason the user can see them.
 */
const MAX_IMAGES = 8;

/**
 * Per-image byte ceiling before encoding.
 *
 * base64 inflates by a third and every image stays in the transcript for the
 * rest of the run, so a page's hero banner is worth looking at and its 20 MB
 * uncompressed original is not.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const schema = z.object({
	urls: z
		.array(z.string().url())
		.min(1)
		.max(MAX_IMAGES)
		.describe(
			`Image URLs to look at, up to ${MAX_IMAGES}. Collect them from web_dom_action (query "img" and read each src).`,
		),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Web session whose tab fetches the images. Falls back to a direct download.",
		),
	detail: z
		.enum(["auto", "low", "high"])
		.optional()
		.describe("Vision detail hint. Use 'low' when skimming many images."),
	save_dir: z
		.string()
		.optional()
		.describe(
			"Also save each image under this directory in the root filesystem, e.g. /resources/images.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "fs">;

const toDataUrl = (bytes: Uint8Array, mimeType: string): string => {
	let binary = "";
	const chunkSize = 8192;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
	}
	return `data:${mimeType};base64,${btoa(binary)}`;
};

export const createWebReadImagesTool: ToolFactory<Input, Services> = (
	services,
): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Look at images from the current page. Give it image URLs (from web_dom_action query on 'img') and it returns the pictures themselves for inspection. Use this instead of trying to read image data out of the DOM. Optionally saves them to the root filesystem.",
	schema,
	execute: async (input) => {
		try {
			const seen = new Set<string>();
			const urls = input.urls.filter((url) => {
				if (seen.has(url)) return false;
				seen.add(url);
				return true;
			});

			const images: Array<{ url: string; dataUrl: string; path?: string }> = [];
			const skipped: Array<{ url: string; reason: string }> = [];

			for (const url of urls) {
				try {
					const { bytes, mimeType } = await fetchImageBytesFromBrowserSession(
						url,
						input.sessionId,
					);
					if (bytes.length === 0) {
						skipped.push({ url, reason: "empty response" });
						continue;
					}
					if (bytes.length > MAX_IMAGE_BYTES) {
						skipped.push({
							url,
							reason: `${Math.round(bytes.length / 1024)} KB exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB per-image limit`,
						});
						continue;
					}

					let path: string | undefined;
					if (input.save_dir && services.fs) {
						path = normalizeDocumentPath(
							`${input.save_dir}/${filenameFromUrl(url, mimeType)}`,
						);
						await writeFileBytes(services.fs, path, bytes);
					}

					images.push({ url, dataUrl: toDataUrl(bytes, mimeType), path });
				} catch (error) {
					skipped.push({
						url,
						reason: error instanceof Error ? error.message : String(error),
					});
				}
			}

			const lines = [
				images.length > 0
					? `Inspect ${images.length} image${images.length === 1 ? "" : "s"} from the page:`
					: "None of the requested images could be read.",
				...images.map(
					(image, index) =>
						`${index + 1}. ${image.url}${image.path ? ` (saved to ${image.path})` : ""}`,
				),
				...(skipped.length > 0
					? [
							"",
							"Not read:",
							...skipped.map((entry) => `- ${entry.url}: ${entry.reason}`),
						]
					: []),
			];

			const content: ChatCompletionContentPart[] = [
				{ type: "text", text: lines.join("\n") },
				...images.map((image) => ({
					type: "image_url" as const,
					image_url: { url: image.dataUrl, detail: input.detail ?? "auto" },
				})),
			];

			return content as unknown as ToolResultValue;
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createWebReadImagesTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
		};
	}
}
