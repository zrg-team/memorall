const IV_LENGTH = 12;

function textToBytes(input: string): Uint8Array {
	return new TextEncoder().encode(input);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	const out = new Uint8Array(a.length + b.length);
	out.set(a, 0);
	out.set(b, a.length);
	return out;
}

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
	const uint8Array =
		bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const binary = String.fromCharCode(...uint8Array);
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest("SHA-256", input as any);
	return new Uint8Array(digest);
}

export async function deriveAesKeyFromString(
	secret: string,
): Promise<CryptoKey> {
	const material = await sha256Bytes(textToBytes(secret));
	return crypto.subtle.importKey(
		"raw",
		material as any,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function deriveAesKeyFromCombined(
	strongPassword: string,
	fixedKey: string,
): Promise<CryptoKey> {
	const combined = textToBytes(strongPassword + fixedKey);
	const digest = await sha256Bytes(combined);
	return crypto.subtle.importKey(
		"raw",
		digest as any,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export function generateStrongPasswordBase64(length = 32): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytesToBase64(bytes.buffer);
}

export async function encryptStringAes(
	plaintext: string,
	key: CryptoKey,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const plaintextBytes = textToBytes(plaintext);
	const enc = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		plaintextBytes as any,
	);
	// prefix IV to ciphertext for storage
	const result = concatBytes(iv, new Uint8Array(enc));
	return bytesToBase64(result);
}

export async function decryptStringAes(
	ciphertextB64: string,
	key: CryptoKey,
): Promise<string> {
	const data = base64ToBytes(ciphertextB64);
	const iv = data.slice(0, IV_LENGTH);
	const ct = data.slice(IV_LENGTH);
	const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
	return new TextDecoder().decode(dec);
}
