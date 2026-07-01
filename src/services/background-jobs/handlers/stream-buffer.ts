/**
 * Helper class to buffer streaming content and emit when threshold is reached.
 */
export class StreamBuffer {
	private buffer = "";
	private wordCount = 0;
	private readonly minWords: number;
	private readonly onEmit: (content: string) => void;

	constructor(minWords: number, onEmit: (content: string) => void) {
		this.minWords = minWords;
		this.onEmit = onEmit;
	}

	add(content: string): void {
		this.buffer += content;

		const trimmed = this.buffer.trim();
		this.wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

		if (this.wordCount >= this.minWords) {
			this.flush();
		}
	}

	flush(): void {
		if (this.buffer) {
			this.onEmit(this.buffer);
			this.buffer = "";
			this.wordCount = 0;
		}
	}

	peek(): string {
		return this.buffer;
	}
}
