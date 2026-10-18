import type { StudioItem } from "@/types/studio";
import { parseOCRLayout } from "./ocr-document";

/** Keep each conversion batch distinct, even when the same PDF is processed again. */
export function ocrResultData(
	items: readonly StudioItem[],
	selected?: StudioItem,
) {
	if (!selected) return null;
	const batchId = selected.generation.params?.batchId;
	const batch =
		typeof batchId === "string"
			? items.filter(
					(item) =>
						item.category === "ocr" &&
						item.conversationId === selected.conversationId &&
						item.generation.params?.batchId === batchId,
				)
			: [selected];
	const pages = batch
		.map((item) => {
			const markdown = item.parts
				.flatMap((part) =>
					part.type === "text" && part.role === "transcript" ? [part.text] : [],
				)
				.join("\n\n");
			const page = item.generation.params?.pageNumber;
			const { blocks } = parseOCRLayout(markdown);
			return {
				pageNumber: typeof page === "number" ? page : 1,
				status: item.generation.status,
				markdown,
				model: {
					id: item.generation.modelId,
					provider: item.generation.provider,
				},
				...(blocks.length ? { layout: blocks } : {}),
				...(item.generation.error ? { error: item.generation.error } : {}),
			};
		})
		.sort((left, right) => left.pageNumber - right.pageNumber);
	return {
		version: 1,
		fileName: selected.content,
		totalPages: selected.generation.params?.pageCount,
		selectedPages:
			selected.generation.params?.selectedPages ??
			pages.map((page) => page.pageNumber),
		pages,
	};
}
