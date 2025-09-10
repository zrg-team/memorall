export type ContentSourceType =
	| "webpage"
	| "selection"
	| "user_input"
	| "raw_text"
	| "file_upload";

export interface ReadabilityArticle {
	title: string;
	content: string;
	textContent: string;
	length: number;
	excerpt: string;
	byline?: string;
	dir?: string;
	lang?: string;
	siteName?: string;
}

export interface PageMetadata {
	url: string;
	title: string;
	favicon?: string;
	description?: string;
	ogImage?: string;
	timestamp: string;
	domain: string;
}

export interface SelectionMetadata {
	selectedText: string;
	selectionContext?: string; // Surrounding text for context
	pageUrl: string;
	pageTitle: string;
	timestamp: string;
	selectionRange?: {
		startOffset: number;
		endOffset: number;
	};
}

export interface UserInputMetadata {
	inputMethod: "chat" | "direct" | "voice"; // How the user provided the content
	timestamp: string;
	prompt?: string; // The user's prompt/question if any
	context?: string; // Any additional context provided
}

export interface RememberedContent {
	id: string;
	sourceType: ContentSourceType;
	sourceUrl?: string;
	originalUrl?: string;
	title: string;
	rawContent: string;
	cleanContent: string;
	textContent: string;
	sourceMetadata: PageMetadata | SelectionMetadata | UserInputMetadata;
	extractionMetadata: ReadabilityArticle | Record<string, unknown>;
	embedding?: number[];
	tags?: string[];
	notes?: string;
	createdAt: string;
	updatedAt: string;
}

export interface NewRememberedContent {
	sourceType: ContentSourceType;
	sourceUrl?: string;
	originalUrl?: string;
	title: string;
	rawContent: string;
	cleanContent: string;
	textContent: string;
	sourceMetadata: PageMetadata | SelectionMetadata | UserInputMetadata;
	extractionMetadata: ReadabilityArticle | Record<string, unknown>;
	embedding?: number[];
	tags?: string[];
	notes?: string;
}

export interface RememberThisMessage {
	type: "REMEMBER_THIS";
	tabId: number;
	url: string;
}

export interface RememberNowMessage {
	type: "REMEMBER_NOW";
	tabId: number;
	url: string;
	selectedText: string;
	selectionContext?: string;
}

export interface LetRememberMessage {
	type: "LET_REMEMBER";
	userInput: string;
	context?: string;
}

export interface ContentExtractedMessage {
	type: "CONTENT_EXTRACTED";
	tabId: number;
	data: {
		html: string;
		url: string;
		title: string;
		metadata: PageMetadata;
		sourceType: ContentSourceType;
		article?: ReadabilityArticle;
	};
}

export interface SelectionExtractedMessage {
	type: "SELECTION_EXTRACTED";
	tabId: number;
	data: {
		selectedText: string;
		selectionContext?: string;
		url: string;
		title: string;
		sourceMetadata: SelectionMetadata;
	};
}

export interface RememberThisResponse {
	success: boolean;
	error?: string;
	pageId?: string;
	warning?: string;
}
