/**
 * The few Node `Buffer` reads pi-tui's image helpers use, over a plain
 * Uint8Array so the TUI runs without a Buffer polyfill.
 */
export class ByteBuffer extends Uint8Array {
	static fromBase64(value: string): ByteBuffer {
		const binary = atob(value);
		const bytes = new ByteBuffer(binary.length);
		for (let index = 0; index < binary.length; index++) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	}

	static toBase64(value: string): string {
		let binary = "";
		for (const byte of new TextEncoder().encode(value)) {
			binary += String.fromCharCode(byte);
		}
		return btoa(binary);
	}

	readUInt16BE(offset: number): number {
		return (this[offset] << 8) | this[offset + 1];
	}

	readUInt16LE(offset: number): number {
		return this[offset] | (this[offset + 1] << 8);
	}

	readUInt32BE(offset: number): number {
		return (
			((this[offset] << 24) >>> 0) +
			(this[offset + 1] << 16) +
			(this[offset + 2] << 8) +
			this[offset + 3]
		);
	}

	readUInt32LE(offset: number): number {
		return (
			(this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16)) +
			((this[offset + 3] << 24) >>> 0)
		);
	}

	ascii(start: number, end: number): string {
		return String.fromCharCode(...this.subarray(start, end));
	}
}
