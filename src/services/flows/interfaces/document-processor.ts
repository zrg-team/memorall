export interface DocumentPage {
	pageNumber: number;
	text: string;
	markdown?: string;
}

export interface ProcessedDocument {
	title?: string;
	pages: DocumentPage[];
	totalPages: number;
	metadata?: Record<string, unknown>;
}

export interface IDocumentProcessor {
	processPDF(data: ArrayBuffer): Promise<ProcessedDocument>;
	formatAsText(
		doc: ProcessedDocument,
		options?: { pageRange?: [number, number] },
	): string;
	formatAsMarkdown(
		doc: ProcessedDocument,
		options?: { pageRange?: [number, number] },
	): string;
}
