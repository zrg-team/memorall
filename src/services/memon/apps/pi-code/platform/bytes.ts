/** Byte helpers standing in for the Node Buffer calls pi makes. */

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
	return encoder.encode(text).length;
}

export function utf8Encode(text: string): Uint8Array {
	return encoder.encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
