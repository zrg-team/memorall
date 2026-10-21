import type { TabTranscript } from "./types";
import { cleanTranscriptText } from "./text";
import { formatTranscriptionTime } from "./progress";
import { transcriptLanguage } from "./languages";

export function exportTabTranscript({ session, chunks }: TabTranscript) {
	const title = session.title.replace(/\s+/g, " ").trim() || "Tab transcript";
	const name =
		title
			.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
			.slice(0, 80)
			.replace(/[. ]+$/, "") || "tab-transcript";
	const body = chunks
		.map(
			(chunk) =>
				`[${formatTranscriptionTime(chunk.startMs)}–${formatTranscriptionTime(chunk.endMs)}] ${chunk.status === "done" ? cleanTranscriptText(chunk.text) || "[No speech]" : `[Untranscribed audio: ${chunk.error || "unavailable"}]`}`,
		)
		.join("\n\n");
	const target = session.translation?.targetLanguage;
	const translated = target
		? `\n\n## Translation — ${transcriptLanguage(target)?.name || target}\n\n${chunks
				.map((chunk) => {
					const translated = chunk.translations?.[target];
					return `[${formatTranscriptionTime(chunk.startMs)}–${formatTranscriptionTime(chunk.endMs)}] ${translated?.status === "done" ? translated.text : chunk.status === "done" && !chunk.text ? "[No speech]" : `[Translation ${translated?.status === "failed" ? "unavailable" : "pending"}]`}`;
				})
				.join("\n\n")}`
		: "";
	return {
		title,
		fileName: `${name}-${session.id.replace(/[^a-z0-9-]/gi, "").slice(0, 8)}.md`,
		mimeType: "text/markdown",
		content: `# ${title}\n\n${session.url}\n\n${new Date(session.startedAt).toISOString()}\n\n${session.summary ? `## ${session.noteStyle === "notes" ? "Meeting notes" : "Summary"}\n\n${session.summary}\n\n` : ""}## Transcript\n\n${body}${translated}`,
	};
}
