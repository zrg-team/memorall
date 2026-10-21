import type {
	NoteStyle,
	TabTranscriptionProgress,
	TabTranscriptionSession,
	TranscriptionLanguageOptions,
	TranslationModelOption,
} from "@/services/tab-transcription/types";

export interface TranscriptionViewState {
	progress: TabTranscriptionProgress | null;
	session: TabTranscriptionSession | null;
	error?: string;
}
export interface TranscriptionViewActions {
	configure?: (options: TranscriptionLanguageOptions) => Promise<void>;
	getTranslationModels?: () => Promise<TranslationModelOption[]>;
	stop: (style: NoteStyle) => Promise<void>;
	perform: (
		action: "summary" | "notes" | "save" | "download" | "chat" | "copy",
	) => Promise<string | void>;
	openStudio: (sessionId?: string) => void | Promise<void>;
	/** Dismiss the floating surface without ending the recording. */
	close?: () => void;
}
export interface TranscriptionView {
	update: (state: TranscriptionViewState, reveal?: boolean) => void;
	destroy: () => void;
}
export type MountTranscriptionView = (
	actions: TranscriptionViewActions,
) => Promise<TranscriptionView>;
