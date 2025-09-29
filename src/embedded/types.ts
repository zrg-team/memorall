export interface ChatMessage {
	id: string;
	content: string;
	role: "user" | "assistant";
	timestamp: Date;
	reasoning?: string;
	sources?: Array<{ title: string; url: string }>;
	isStreaming?: boolean;
}

export interface SelectionData {
	selectedText: string;
	selectionContext: string;
	pageUrl: string;
	pageTitle: string;
	timestamp: string;
	selectionRange?: {
		startOffset: number;
		endOffset: number;
	};
}

export interface PageMetadata {
	url: string;
	title: string;
	favicon: string;
	description: string;
	ogImage: string;
	timestamp: string;
	domain: string;
	siteName: string;
}

export interface ReadableContent {
	title: string;
	content: string;
	textContent: string;
	length: number;
	excerpt: string;
	byline: string;
	dir: string;
	lang: string;
	siteName: string;
}

export interface ExtractedPageData {
	html: string;
	url: string;
	title: string;
	metadata: PageMetadata;
	topicId: string | null;
	article: ReadableContent;
}

export interface ExtractedSelectionData {
	selectedText: string;
	selectionContext: string;
	url: string;
	title: string;
	sourceMetadata: SelectionData;
}

export interface RememberContext {
	context?: string;
	pageUrl: string;
	pageTitle: string;
	timestamp: string;
}

export interface ChatModalProps {
	context?: string;
	mode?: "general" | "topic";
	pageUrl: string;
	pageTitle: string;
	onClose: () => void;
}

export interface TopicSelectorProps {
	context: string;
	pageUrl: string;
	pageTitle: string;
	onClose: () => void;
}

export interface BackgroundMessage {
	type: string;
	tabId?: number;
	url?: string;
	context?: string;
	selectedText?: string;
	topicId?: string;
	mode?: "general" | "topic";
	showTopicSelector?: boolean;
	contextData?: RememberContext;
	data?: ExtractedPageData | ExtractedSelectionData;
}

export interface MessageResponse {
	success: boolean;
	error?: string;
	jobId?: string;
	topics?: Array<{ id: string; name: string; description?: string }>;
}
