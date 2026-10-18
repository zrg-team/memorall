export type OCRPageSelection = "current" | "all" | "custom";

/** Accept individual pages and inclusive ranges; process in document order. */
export function parseOCRPages(value: string, totalPages: number): number[] {
	const segments = value.replace(/[–—]/g, "-").split(",");
	const pages = new Set<number>();
	for (const segment of segments) {
		const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(segment);
		if (!match)
			throw new Error("Enter page numbers or ranges, for example: 1, 3-5.");
		const first = Number(match[1]);
		const last = match[2] ? Number(match[2]) : first;
		if (
			!Number.isSafeInteger(first) ||
			!Number.isSafeInteger(last) ||
			first < 1 ||
			last > totalPages ||
			first > last
		) {
			throw new Error(
				`Choose pages between 1 and ${totalPages}, with each range in ascending order.`,
			);
		}
		for (let page = first; page <= last; page++) pages.add(page);
	}
	return [...pages].sort((left, right) => left - right);
}

export function resolveOCRPages(
	selection: OCRPageSelection,
	currentPage: number,
	totalPages: number,
	customPages: string,
): number[] {
	if (selection === "all")
		return Array.from({ length: totalPages }, (_, index) => index + 1);
	return parseOCRPages(
		selection === "custom" ? customPages : String(currentPage),
		totalPages,
	);
}
