import type { TabTranscriptionSession, TranscriptChunk } from "./types";
import type { TranslateLiveText } from "./translation";

/** Translation never holds up audio persistence or the source recognizer.
 * A generation change cancels old work, so switching languages cannot paint stale
 * output into the new language. Each finished translation is durable on its chunk.
 */
export class TranscriptTranslationQueue {
	private tail = Promise.resolve();
	private generation = 0;
	private abort?: AbortController;
	private failure?: string;
	private scheduled = new Set<string>();
	private jobs: { priority: boolean; run: () => Promise<void> }[] = [];
	pending = 0;
	private updates: TranscriptChunk[] = [];
	private current?: TranscriptChunk;
	previewChunks() {
		return [...this.updates, ...(this.current ? [this.current] : [])];
	}
	constructor(
		private session: TabTranscriptionSession,
		private translate: TranslateLiveText,
		private chunks: () => TranscriptChunk[],
		private saveChunk: (chunk: TranscriptChunk) => Promise<void>,
		private saveSession: () => Promise<void>,
	) {}

	reset() {
		this.generation++;
		this.abort?.abort();
		this.scheduled.clear();
		this.failure = undefined;
		this.session.translationError = undefined;
		this.session.translationStatus = undefined;
	}

	enqueue(chunk: TranscriptChunk, priority = true): void {
		const options = this.session.translation;
		if (!options?.model || chunk.status !== "done" || !chunk.text.trim())
			return;
		const model = options.model;
		const language = options.targetLanguage;
		const key = `${chunk.id}:${language}:${model.serviceName}:${model.modelId}`;
		const existing = chunk.translations?.[language];
		if (
			this.scheduled.has(key) ||
			(existing?.status === "done" &&
				existing.model.modelId === model.modelId &&
				existing.model.serviceName === model.serviceName)
		)
			return;
		const generation = this.generation;
		this.scheduled.add(key);
		this.pending++;
		this.session.translationStatus = "running";
		const run = () =>
			Promise.resolve()
				.then(async () => {
					if (generation !== this.generation) return;
					if (this.failure) {
						(chunk.translations ??= {})[language] = {
							model,
							text: "",
							status: "failed",
							error: this.failure,
						};
						await this.saveChunk(chunk);
						this.updates = [
							...this.updates.filter((item) => item.id !== chunk.id),
							chunk,
						].slice(-12);
						return;
					}
					const abort = new AbortController();
					this.abort = abort;
					this.current = chunk;
					const timer = setTimeout(
						() =>
							abort.abort(
								new Error("Translation took too long. Try a faster model."),
							),
						30000,
					);
					const translation = {
						text: "",
						status: "pending" as "pending" | "done" | "failed",
						model,
						error: undefined as string | undefined,
					};
					(chunk.translations ??= {})[language] = translation;
					try {
						await this.saveChunk(chunk);
						if (generation !== this.generation) return;
						abort.signal.throwIfAborted();
						const context = this.chunks()
							.filter(
								(item) => item.index < chunk.index && item.status === "done",
							)
							.sort((a, b) => a.index - b.index)
							.slice(-2)
							.map((item) => item.text)
							.join(" ")
							.slice(-500);
						const stopped = new Promise<never>((_resolve, reject) =>
							abort.signal.addEventListener(
								"abort",
								() => reject(abort.signal.reason),
								{ once: true },
							),
						);
						const text = await Promise.race([
							stopped,
							this.translate({
								model,
								targetLanguage: language,
								text: chunk.text,
								context,
								sessionId: this.session.id,
								title: this.session.title,
								signal: abort.signal,
								onDelta: (text) => {
									if (generation === this.generation && !abort.signal.aborted)
										translation.text = text;
								},
							}),
						]);
						if (generation !== this.generation) return;
						abort.signal.throwIfAborted();
						translation.text = text;
						translation.status = "done";
					} catch (error) {
						if (generation !== this.generation) return;
						translation.status = "failed";
						translation.error =
							error instanceof Error ? error.message : String(error);
						this.session.translationError = translation.error;
						this.failure = translation.error;
					} finally {
						clearTimeout(timer);
						if (this.abort === abort) this.abort = undefined;
						if (this.current === chunk) this.current = undefined;
					}
					if (generation === this.generation) {
						await this.saveChunk(chunk);
						this.updates = [
							...this.updates.filter((item) => item.id !== chunk.id),
							chunk,
						].slice(-12);
					}
				})
				.catch((error) => {
					if (generation === this.generation) {
						this.session.translationError = String(error);
						this.failure = String(error);
					}
				})
				.finally(async () => {
					this.pending--;
					if (generation === this.generation) this.scheduled.delete(key);
					if (!this.pending && this.session.translation) {
						this.session.translationStatus = this.session.translationError
							? "failed"
							: "done";
						await this.saveSession().catch(() => {});
					}
				});
		this.jobs.push({ priority, run });
		this.tail = this.tail.then(async () => {
			const live = this.jobs.findIndex((job) => job.priority);
			const [job] = this.jobs.splice(live >= 0 ? live : 0, 1);
			await job?.run();
		});
	}

	drain() {
		return this.tail;
	}
}
