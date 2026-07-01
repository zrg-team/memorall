import { describe, expect, it } from "vitest";

import {
	decryptStringAes,
	deriveAesKeyFromCombined,
	deriveAesKeyFromString,
	encryptStringAes,
	generateStrongPasswordBase64,
	sha256Bytes,
} from "../aes";

describe("AES utilities", () => {
	it("hashes input to SHA-256 bytes", async () => {
		const digest = await sha256Bytes(new TextEncoder().encode("memorall"));

		expect(digest).toHaveLength(32);
		expect(Array.from(digest).some((byte) => byte !== 0)).toBe(true);
	});

	it("derives usable AES keys and round-trips encrypted text", async () => {
		const key = await deriveAesKeyFromString("passkey");
		const encrypted = await encryptStringAes("secret text", key);

		expect(encrypted).toEqual(expect.any(String));
		expect(encrypted).not.toContain("secret text");
		await expect(decryptStringAes(encrypted, key)).resolves.toBe("secret text");
	});

	it("derives combined keys from master and fixed secrets", async () => {
		const key = await deriveAesKeyFromCombined("strong-password", "fixed-key");
		const encrypted = await encryptStringAes("provider-config", key);

		await expect(decryptStringAes(encrypted, key)).resolves.toBe(
			"provider-config",
		);
	});

	it("generates random base64 passwords at the requested byte length", () => {
		const first = generateStrongPasswordBase64(16);
		const second = generateStrongPasswordBase64(16);

		expect(
			Uint8Array.from(atob(first), (char) => char.charCodeAt(0)),
		).toHaveLength(16);
		expect(first).not.toBe(second);
	});
});
