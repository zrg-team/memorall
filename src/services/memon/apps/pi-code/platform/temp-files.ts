/**
 * Where pi keeps the full output of a command that was too long to show the
 * model (pi writes these to os.tmpdir()). The session points this at a folder
 * in the agent's Memon home so the model can `read` it back.
 */
export interface TempFileSink {
	/** Folder the files go in. */
	dir: string;
	write(path: string, data: Uint8Array): Promise<void>;
}

export function tempFilePath(sink: TempFileSink, prefix: string): string {
	const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `${sink.dir.replace(/\/+$/, "")}/${prefix}-${id}.log`;
}

/** Collects chunks and writes them as one file on end(). */
export class TempFileStream {
	private chunks: Uint8Array[] = [];

	constructor(
		private readonly sink: TempFileSink,
		readonly path: string,
	) {}

	write(chunk: Uint8Array): void {
		this.chunks.push(chunk);
	}

	async end(): Promise<void> {
		const size = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
		const data = new Uint8Array(size);
		let offset = 0;
		for (const chunk of this.chunks) {
			data.set(chunk, offset);
			offset += chunk.length;
		}
		this.chunks = [];
		await this.sink.write(this.path, data);
	}
}
