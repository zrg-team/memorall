import type { TabTranscript, TabTranscriptionProgress } from "./types";

export function formatTranscriptionTime(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 60)
		.toString()
		.padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function storedTranscriptProgress({
	session,
	chunks,
}: TabTranscript): TabTranscriptionProgress {
	const done = chunks.filter((chunk) => chunk.status === "done");
	const failed = chunks.filter((chunk) => chunk.status === "failed");
	return {
		session,
		phase:
			session.summaryStatus === "running"
				? "summarizing"
				: session.status === "finishing"
					? "transcribing"
					: session.status,
		capturedMs: chunks.reduce((end, chunk) => Math.max(end, chunk.endMs), 0),
		savedMs: chunks.reduce(
			(total, chunk) => total + chunk.endMs - chunk.startMs,
			0,
		),
		transcribedMs: done.reduce(
			(total, chunk) => total + chunk.endMs - chunk.startMs,
			0,
		),
		totalChunks: chunks.length,
		savedChunks: chunks.length,
		completedChunks: done.length,
		failedChunks: failed.length,
		pendingChunks: chunks.length - done.length - failed.length,
		translatingChunks: session.translation
			? chunks.filter(
					(chunk) =>
						chunk.status === "done" &&
						chunk.text &&
						(!chunk.translations?.[session.translation!.targetLanguage] ||
							chunk.translations[session.translation!.targetLanguage].status ===
								"pending"),
				).length
			: 0,
		chunks,
	};
}

export function describeTranscriptionProgress(
	progress: TabTranscriptionProgress,
): string {
	if (progress.phase === "loading-model")
		return `Preparing transcription model · ${Math.round(progress.modelLoadPercent ?? 0)}%`;
	if (progress.phase === "summarizing") {
		const parts = progress.summaryProgress;
		return parts
			? `Creating ${progress.session.noteStyle === "notes" ? "meeting notes" : "summary"} · ${parts.completedParts}/${parts.totalParts} parts complete`
			: "Transcript saved. Creating summary or notes…";
	}
	if (progress.currentChunkId) {
		const current = progress.chunks.find(
			(chunk) => chunk.id === progress.currentChunkId,
		);
		return `Transcribing segment ${(current?.index ?? 0) + 1} of ${progress.totalChunks}${progress.phase === "recording" ? " · Recording continues" : ""}`;
	}
	return {
		recording: "Recording tab audio…",
		saving: "Saving the final audio segment…",
		transcribing: `Finishing transcription · ${progress.pendingChunks} segments waiting`,
		complete: "Transcript saved",
		failed: "Recording stopped with an error",
		interrupted: "Recording was interrupted",
	}[progress.phase];
}
