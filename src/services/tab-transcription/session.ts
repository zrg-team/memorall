import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { Transcription } from "@/types/openai-media";
import type { TabTranscriptStore } from "./store";
import { cleanTranscriptText } from "./text";
import { TranscriptTranslationQueue } from "./translation-queue";
import type { TranslateLiveText } from "./translation";
import type {
	NoteStyle,
	TabTranscript,
	TabTranscriptionSession,
	TranscriptChunk,
	TabTranscriptionProgress,
	SummaryProgress,
	TranscriptionLanguageOptions,
} from "./types";

export interface SessionDependencies {
	translate?: TranslateLiveText;
	prepare?: (onProgress: (percent: number) => void) => Promise<void>;
	store: TabTranscriptStore;
	transcribe: (
		model: CurrentModelInfo,
		audioPath: string,
		onDelta?: (text: string) => void,
		onModelProgress?: (percent: number | undefined) => void,
	) => Promise<Transcription>;
	summarize: (
		transcript: TabTranscript,
		style: Exclude<NoteStyle, "none">,
		onProgress?: (progress: SummaryProgress) => void,
	) => Promise<{ text: string; model: CurrentModelInfo }>;
}

/** Owns the two queues: save audio immediately, then run the local model serially. */
export class TabTranscriptionSessionRunner {
	private persistence = Promise.resolve();
	private inference = Promise.resolve();
	private finishPromise?: Promise<void>;
	private pending = 0;
	private pendingAudioMs = 0;
	private index = 0;
	private samples = 0;
	private accepting = true;
	private recentChunks: TranscriptChunk[] = [];
	private capturedMs = 0;
	private savedMs = 0;
	private transcribedMs = 0;
	private savedChunks = 0;
	private completedChunks = 0;
	private failedChunks = 0;
	private currentChunkId?: string;
	private inferenceError?: unknown;
	private modelLoadPercent?: number;
	private summaryProgress?: SummaryProgress;
	private translations?: TranscriptTranslationQueue;
	private chunksById = new Map<string, TranscriptChunk>();
	private chunkWrites = Promise.resolve();
	onFailure?: (error: Error) => void;

	prepareModel(): void {
		if (!this.deps.prepare) return;
		this.modelLoadPercent = 0;
		void this.deps
			.prepare((percent) => {
				this.modelLoadPercent = percent;
			})
			.catch((error) => {
				this.inferenceError ??= error;
			})
			.finally(() => {
				this.modelLoadPercent = undefined;
			});
	}

	constructor(
		public session: TabTranscriptionSession,
		private deps: SessionDependencies,
		chunks: TranscriptChunk[] = [],
	) {
		for (const chunk of chunks) this.chunksById.set(chunk.id, chunk);
		if (deps.translate)
			this.translations = new TranscriptTranslationQueue(
				session,
				deps.translate,
				() => [...this.chunksById.values()],
				(chunk) => this.saveChunk(chunk),
				() => this.deps.store.saveSession({ ...this.session }),
			);
		this.recentChunks = chunks.slice(-12);
		this.index = chunks.length;
		this.capturedMs = chunks.reduce(
			(end, chunk) => Math.max(end, chunk.endMs),
			0,
		);
		for (const chunk of chunks) {
			this.savedChunks++;
			this.savedMs += chunk.endMs - chunk.startMs;
			if (chunk.status === "done") {
				this.completedChunks++;
				this.transcribedMs += chunk.endMs - chunk.startMs;
			} else if (chunk.status === "failed") this.failedChunks++;
		}
	}

	getProgress(): TabTranscriptionProgress {
		const status = this.session.status;
		return {
			session: { ...this.session },
			phase:
				this.session.summaryStatus === "running"
					? "summarizing"
					: this.modelLoadPercent !== undefined
						? "loading-model"
						: status === "finishing"
							? this.currentChunkId || this.savedChunks === this.index
								? "transcribing"
								: "saving"
							: status,
			capturedMs: this.capturedMs,
			modelLoadPercent: this.modelLoadPercent,
			savedMs: this.savedMs,
			transcribedMs: this.transcribedMs,
			totalChunks: this.index,
			savedChunks: this.savedChunks,
			completedChunks: this.completedChunks,
			failedChunks: this.failedChunks,
			pendingChunks: this.pending,
			translatingChunks: this.translations?.pending ?? 0,
			currentChunkId: this.currentChunkId,
			summaryProgress: this.summaryProgress
				? { ...this.summaryProgress }
				: undefined,
			chunks: [
				...new Map(
					[
						...this.recentChunks,
						...(this.translations?.previewChunks() ?? []),
					].map((chunk) => [chunk.id, chunk]),
				).values(),
			]
				.sort((a, b) => a.index - b.index)
				.map(
					({
						id,
						index,
						startMs,
						endMs,
						status,
						text,
						error,
						translations,
					}) => ({
						id,
						index,
						startMs,
						endMs,
						status,
						text,
						error,
						translations: translations
							? structuredClone(translations)
							: undefined,
					}),
				),
		};
	}

	append(samples: Float32Array, sampleRate: number): void {
		if (!this.accepting || !samples.length) return;
		// Preserve the two-minute budget when using shorter capture windows.
		const durationMs = (samples.length / sampleRate) * 1000;
		if (this.pendingAudioMs + durationMs > 120_000 || this.pending >= 120) {
			this.fail(
				new Error(
					"The local model could not keep up. Recording stopped; saved audio and transcript chunks are available.",
				),
			);
			return;
		}
		const chunk: TranscriptChunk = {
			id: this.deps.store.newId(),
			index: this.index++,
			startMs: (this.samples / sampleRate) * 1000,
			endMs: ((this.samples + samples.length) / sampleRate) * 1000,
			audioPath: "",
			status: "pending",
			text: "",
		};
		this.chunksById.set(chunk.id, chunk);
		this.samples += samples.length;
		this.capturedMs = chunk.endMs;
		this.recentChunks.push(chunk);
		if (this.recentChunks.length > 12) this.recentChunks.shift();
		this.pending++;
		this.pendingAudioMs += durationMs;
		const hasAudio = samples.some((sample) => sample !== 0);
		const saved = this.persistence.then(async () => {
			chunk.audioPath = await this.deps.store.saveAudio(samples, sampleRate);
			await this.saveChunk(chunk);
			this.savedChunks++;
			this.savedMs += chunk.endMs - chunk.startMs;
		});
		this.persistence = saved.catch((error) => this.fail(error));
		this.inference = this.inference
			.then(async () => {
				await saved;
				this.currentChunkId = chunk.id;
				try {
					if (hasAudio && this.inferenceError) throw this.inferenceError;
					const result = hasAudio
						? await this.deps.transcribe(
								this.session.model,
								chunk.audioPath,
								(text) => {
									chunk.text = cleanTranscriptText(text);
								},
								(percent) => {
									this.modelLoadPercent = percent;
								},
							)
						: { text: "", segments: undefined };
					chunk.status = "done";
					chunk.text = cleanTranscriptText(result.text);
					if (
						!this.session.sourceLanguage &&
						"language" in result &&
						typeof result.language === "string"
					)
						this.session.language = result.language;
					// Segment timestamps are relative to the session, not the individual WAV window.
					chunk.segments = result.segments?.map((segment) => ({
						...segment,
						text: cleanTranscriptText(segment.text),
						start: segment.start + chunk.startMs / 1000,
						end: segment.end + chunk.startMs / 1000,
					}));
				} catch (error) {
					this.inferenceError ??= error;
					chunk.status = "failed";
					chunk.error = error instanceof Error ? error.message : String(error);
					this.fail(error);
				}
				await this.saveChunk(chunk);
				this.translations?.enqueue(chunk);
			})
			.catch((error) => {
				chunk.status = "failed";
				chunk.error = error instanceof Error ? error.message : String(error);
				this.fail(error);
			})
			.finally(() => {
				this.pending--;
				this.pendingAudioMs -= durationMs;
				this.modelLoadPercent = undefined;
				if (this.currentChunkId === chunk.id) this.currentChunkId = undefined;
				if (chunk.status === "done") {
					this.completedChunks++;
					this.transcribedMs += chunk.endMs - chunk.startMs;
				} else this.failedChunks++;
			});
	}

	private saveChunk(chunk: TranscriptChunk): Promise<void> {
		const write = this.chunkWrites.then(() =>
			this.deps.store.saveChunk(this.session.id, structuredClone(chunk)),
		);
		this.chunkWrites = write.catch(() => {});
		return write;
	}

	async configure(options: TranscriptionLanguageOptions): Promise<void> {
		if (options.language !== undefined) {
			this.session.sourceLanguage = options.language ?? undefined;
			this.session.language = options.language ?? undefined;
		}
		if (options.translation !== undefined) {
			this.translations?.reset();
			this.session.translation = options.translation ?? undefined;
		}
		await this.deps.store.saveSession({ ...this.session });
		if (this.session.translation && options.translation !== undefined) {
			const saved = await this.deps.store.get(this.session.id);
			for (const chunk of saved.chunks)
				if (!this.chunksById.has(chunk.id))
					this.chunksById.set(chunk.id, chunk);
			const ordered = [...this.chunksById.values()].sort(
				(a, b) => a.index - b.index,
			);
			const latest = ordered.at(-1)?.index ?? 0;
			for (const chunk of ordered)
				this.translations?.enqueue(
					chunk,
					this.session.status === "recording" && chunk.index >= latest - 1,
				);
			await this.deps.store.saveSession({ ...this.session });
		}
	}

	private fail(reason: unknown): void {
		const error = reason instanceof Error ? reason : new Error(String(reason));
		this.accepting = false;
		this.session.error ??= error.message;
		this.onFailure?.(error);
	}

	/** The caller flushes the recorder's final partial window before calling finish. */
	finish(style: NoteStyle): Promise<void> {
		if (this.finishPromise) return this.finishPromise;
		this.accepting = false;
		this.finishPromise = this.finalize(style);
		return this.finishPromise;
	}

	private async finalize(style: NoteStyle): Promise<void> {
		this.session.status = "finishing";
		this.session.endedAt = Date.now();
		this.session.noteStyle = style;
		await this.deps.store.saveSession({ ...this.session });
		await this.persistence;
		await this.inference;
		await this.translations?.drain();
		await this.chunkWrites;
		this.session.status = this.session.error ? "failed" : "complete";
		await this.deps.store.saveSession({ ...this.session });
		if (style !== "none") await this.summarize(style);
	}

	async summarize(style: Exclude<NoteStyle, "none">): Promise<void> {
		this.session.noteStyle = style;
		this.session.summaryStatus = "running";
		this.session.summaryError = undefined;
		this.summaryProgress = undefined;
		await this.deps.store.saveSession({ ...this.session });
		try {
			const result = await this.deps.summarize(
				await this.deps.store.get(this.session.id),
				style,
				(progress) => {
					this.summaryProgress = progress;
				},
			);
			this.session.summary = result.text;
			this.session.summaryModel = result.model;
			this.session.summaryStatus = "done";
		} catch (error) {
			this.session.summaryStatus = "failed";
			this.session.summaryError =
				error instanceof Error ? error.message : String(error);
		}
		await this.deps.store.saveSession({ ...this.session });
	}
}
