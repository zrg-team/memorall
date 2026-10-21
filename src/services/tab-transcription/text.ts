/** Hide ASR control tokens in partial text and recordings saved by older versions. */
export function cleanTranscriptText(text: string): string {
	return text
		.replace(
			/<\|(?:\d+(?:\.\d+)?|startoftranscript|endoftext|notimestamps|transcribe|translate|nospeech|[a-z]{2,3})\|>/gi,
			"",
		)
		.replace(/<\|[^>]*$/, "")
		.replace(/[\t ]{2,}/g, " ")
		.trim();
}
