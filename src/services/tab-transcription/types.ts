import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { TranscriptionSegment } from "@/types/openai-media";

export const TAB_TRANSCRIPTION = "memorall:tab-transcription";
export const TAB_TRANSCRIPTION_OFFSCREEN =
	"memorall:tab-transcription:offscreen";
export const TAB_TRANSCRIPTION_SHOW = "memorall:tab-transcription:show";
export const TAB_TRANSCRIPTION_MODE = "speech-to-text";
export const TAB_TRANSCRIPTION_PREFERENCES =
	"memorall.tab-transcription.preferences";

export interface LiveTranslationOptions {
	targetLanguage: string;
	model?: CurrentModelInfo;
	showOriginal?: boolean;
}
export interface TranscriptionLanguageOptions {
	/** null means auto-detect; omitted leaves the current setting intact. */
	language?: string | null;
	/** null turns translation off. */
	translation?: LiveTranslationOptions | null;
}
export interface TranslationModelOption {
	model: CurrentModelInfo;
	label: string;
}
export interface ChunkTranslation {
	text: string;
	status: "pending" | "done" | "failed";
	model: CurrentModelInfo;
	error?: string;
}

export type NoteStyle = "summary" | "notes" | "none";
export type SessionStatus =
	| "recording"
	| "finishing"
	| "complete"
	| "interrupted"
	| "failed";

export interface TabTranscriptionSession {
	id: string;
	title: string;
	tabId: number;
	url: string;
	startedAt: number;
	endedAt?: number;
	status: SessionStatus;
	model: CurrentModelInfo;
	language?: string;
	sourceLanguage?: string;
	translation?: LiveTranslationOptions;
	translationStatus?: "running" | "done" | "failed";
	translationError?: string;
	noteStyle: NoteStyle;
	error?: string;
	summary?: string;
	summaryStatus?: "running" | "done" | "failed";
	summaryError?: string;
	summaryModel?: CurrentModelInfo;
}

export interface TranscriptChunk {
	id: string;
	index: number;
	startMs: number;
	endMs: number;
	audioPath: string;
	status: "pending" | "done" | "failed";
	text: string;
	segments?: TranscriptionSegment[];
	error?: string;
	translations?: Record<string, ChunkTranslation>;
}

export interface TabTranscript {
	session: TabTranscriptionSession;
	chunks: TranscriptChunk[];
}

export interface SummaryProgress {
	completedParts: number;
	totalParts: number;
	round: number;
}

export type TranscriptChunkPreview = Pick<
	TranscriptChunk,
	| "id"
	| "index"
	| "startMs"
	| "endMs"
	| "status"
	| "text"
	| "error"
	| "translations"
>;

/** A bounded live view; completed audio remains in the database. */
export interface TabTranscriptionProgress {
	session: TabTranscriptionSession;
	phase:
		| "recording"
		| "saving"
		| "loading-model"
		| "transcribing"
		| "summarizing"
		| "complete"
		| "failed"
		| "interrupted";
	translatingChunks?: number;
	modelLoadPercent?: number;
	capturedMs: number;
	savedMs: number;
	transcribedMs: number;
	totalChunks: number;
	savedChunks: number;
	completedChunks: number;
	failedChunks: number;
	pendingChunks: number;
	currentChunkId?: string;
	summaryProgress?: SummaryProgress;
	/** Recent source windows and bounded delayed translation updates. */
	chunks: TranscriptChunkPreview[];
}

export type TabTranscriptionCommand =
	| { action: "status"; tabId?: number; sessionId?: string }
	| ({
			action: "configure";
			tabId?: number;
			sessionId?: string;
			noteStyle?: NoteStyle;
	  } & TranscriptionLanguageOptions)
	| { action: "options" }
	| { action: "list" }
	| { action: "get"; sessionId: string }
	| { action: "stop"; tabId?: number; noteStyle: NoteStyle }
	| {
			action: "finish-action";
			sessionId?: string;
			tabId?: number;
			operation: "summary" | "notes" | "export" | "save" | "chat";
	  }
	| {
			action: "summarize";
			sessionId: string;
			noteStyle: Exclude<NoteStyle, "none">;
	  };

export interface TabTranscriptionResponse {
	success: boolean;
	error?: string;
	session?: TabTranscriptionSession | null;
	sessions?: TabTranscriptionSession[];
	transcript?: TabTranscript;
	progress?: TabTranscriptionProgress | null;
	export?: {
		content: string;
		fileName: string;
		mimeType: string;
		title: string;
	};
	path?: string;
	translationModels?: TranslationModelOption[];
}

export const isNoteStyle = (value: unknown): value is NoteStyle =>
	value === "summary" || value === "notes" || value === "none";

export const isSessionActive = (session: TabTranscriptionSession) =>
	session.status === "recording" || session.status === "finishing";
