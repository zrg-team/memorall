export const DEFAULT_OCR_INSTRUCTIONS =
	"Transcribe all text in this document as Markdown, preserving tables, headings, formulas and reading order. Return only the transcription, without commentary or a surrounding code fence.";

export const OCR_LAYOUT_INSTRUCTIONS =
	"Transcribe this document as Markdown. Before each content block, include ![label](x1,y1,x2,y2) with its bounding box normalized to 0–1000. Preserve tables, headings, formulas and reading order. Return only the transcription.";

/** An explicit instruction, including an empty image-only prompt, is authoritative. */
export function ocrInstructions(options: {
	instructions?: string;
	grounding?: boolean;
	local?: boolean;
}): string {
	return (
		options.instructions ??
		(options.grounding
			? OCR_LAYOUT_INSTRUCTIONS
			: options.local
				? ""
				: DEFAULT_OCR_INSTRUCTIONS)
	);
}
