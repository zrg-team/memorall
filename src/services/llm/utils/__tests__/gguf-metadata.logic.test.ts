import { describe, expect, it, vi } from "vitest";
import {
	describeGgufArchitecture,
	kvBytesPerToken,
	parseGgufMetadata,
	probeGgufArchitecture,
} from "../../../../../public/runner/utils/gguf-metadata.js";

// ---------------------------------------------------------------------------
// A minimal GGUF writer, so the parser is tested against real bytes rather than
// a hand-waved fixture.
// ---------------------------------------------------------------------------

const TYPE = {
	UINT32: 4,
	STRING: 8,
	ARRAY: 9,
} as const;

class Writer {
	private parts: Uint8Array[] = [];

	u32(value: number) {
		const b = new Uint8Array(4);
		new DataView(b.buffer).setUint32(0, value, true);
		this.parts.push(b);
		return this;
	}

	u64(value: number) {
		const b = new Uint8Array(8);
		new DataView(b.buffer).setBigUint64(0, BigInt(value), true);
		this.parts.push(b);
		return this;
	}

	str(value: string) {
		const bytes = new TextEncoder().encode(value);
		this.u64(bytes.length);
		this.parts.push(bytes);
		return this;
	}

	raw(bytes: Uint8Array) {
		this.parts.push(bytes);
		return this;
	}

	build(): ArrayBuffer {
		const total = this.parts.reduce((n, p) => n + p.length, 0);
		const out = new Uint8Array(total);
		let at = 0;
		for (const part of this.parts) {
			out.set(part, at);
			at += part.length;
		}
		return out.buffer;
	}
}

type Entry = [string, number, unknown];

function buildGguf(entries: Entry[], { version = 3 } = {}): ArrayBuffer {
	const w = new Writer();
	w.u32(0x46554747).u32(version).u64(0).u64(entries.length);
	for (const [key, type, value] of entries) {
		w.str(key).u32(type);
		if (type === TYPE.STRING) w.str(value as string);
		else if (type === TYPE.UINT32) w.u32(value as number);
		else if (type === TYPE.ARRAY) {
			const [itemType, items] = value as [number, unknown[]];
			w.u32(itemType).u64(items.length);
			for (const item of items) {
				if (itemType === TYPE.UINT32) w.u32(item as number);
				else if (itemType === TYPE.STRING) w.str(item as string);
			}
		}
	}
	return w.build();
}

const LLAMA_ENTRIES: Entry[] = [
	["general.architecture", TYPE.STRING, "llama"],
	["llama.block_count", TYPE.UINT32, 32],
	["llama.context_length", TYPE.UINT32, 8192],
	["llama.embedding_length", TYPE.UINT32, 4096],
	["llama.attention.head_count", TYPE.UINT32, 32],
	["llama.attention.head_count_kv", TYPE.UINT32, 8],
];

describe("parseGgufMetadata", () => {
	it("reads key/value metadata out of real GGUF bytes", () => {
		const meta = parseGgufMetadata(buildGguf(LLAMA_ENTRIES));

		expect(meta["general.architecture"]).toBe("llama");
		expect(meta["llama.block_count"]).toBe(32);
		expect(meta["llama.attention.head_count_kv"]).toBe(8);
	});

	it("skips values the caller does not want without materialising them", () => {
		// A real tokenizer token list is megabytes of strings; walking past it
		// without decoding is what keeps the probe to a single ranged read.
		const withTokens = buildGguf([
			...LLAMA_ENTRIES,
			[
				"tokenizer.ggml.tokens",
				TYPE.ARRAY,
				[TYPE.STRING, Array.from({ length: 500 }, (_, i) => `token-${i}`)],
			],
		]);

		const meta = parseGgufMetadata(
			withTokens,
			(key) => key.startsWith("llama.") || key === "general.architecture",
		);

		expect(meta["llama.block_count"]).toBe(32);
		expect(meta["tokenizer.ggml.tokens"]).toBeUndefined();
	});

	it("rejects a file that is not GGUF", () => {
		const notGguf = new Writer().u32(0xdeadbeef).u32(3).u64(0).u64(0).build();

		expect(() => parseGgufMetadata(notGguf)).toThrow(/Not a GGUF file/);
	});

	it("rejects a GGUF version it cannot read", () => {
		expect(() => parseGgufMetadata(buildGguf([], { version: 1 }))).toThrow(
			/Unsupported GGUF version/,
		);
	});
});

describe("describeGgufArchitecture", () => {
	it("derives the attention shape a KV estimate needs", () => {
		const arch = describeGgufArchitecture(
			parseGgufMetadata(buildGguf(LLAMA_ENTRIES)),
		);

		expect(arch).toMatchObject({
			architecture: "llama",
			blockCount: 32,
			keyLength: 128, // 4096 embedding / 32 heads
			valueLength: 128,
			trainedContext: 8192,
		});
		expect(arch?.kvHeadsPerLayer).toHaveLength(32);
	});

	it("prefers explicit key and value lengths over the embedding fallback", () => {
		const arch = describeGgufArchitecture(
			parseGgufMetadata(
				buildGguf([
					...LLAMA_ENTRIES,
					["llama.attention.key_length", TYPE.UINT32, 192],
					["llama.attention.value_length", TYPE.UINT32, 128],
				]),
			),
		);

		expect(arch?.keyLength).toBe(192);
		expect(arch?.valueLength).toBe(128);
	});

	it("keeps per-layer KV head counts for hybrid models", () => {
		// Granite-4 and LFM2 interleave attention with layers that hold no KV
		// cache at all; charging every layer would badly over-estimate them.
		const arch = describeGgufArchitecture(
			parseGgufMetadata(
				buildGguf([
					["general.architecture", TYPE.STRING, "granitehybrid"],
					["granitehybrid.block_count", TYPE.UINT32, 4],
					["granitehybrid.embedding_length", TYPE.UINT32, 1024],
					["granitehybrid.attention.head_count", TYPE.UINT32, 8],
					[
						"granitehybrid.attention.head_count_kv",
						TYPE.ARRAY,
						[TYPE.UINT32, [0, 4, 0, 4]],
					],
				]),
			),
		);

		expect(arch?.kvHeadsPerLayer).toEqual([0, 4, 0, 4]);
	});

	it("returns nothing when the architecture is unreadable", () => {
		expect(describeGgufArchitecture({})).toBeNull();
		expect(
			describeGgufArchitecture({ "general.architecture": "llama" }),
		).toBeNull();
	});
});

describe("kvBytesPerToken", () => {
	it("matches the standard formula for a dense model", () => {
		const arch = describeGgufArchitecture(
			parseGgufMetadata(buildGguf(LLAMA_ENTRIES)),
		);

		// 2 (K+V) × 32 layers × 8 kv heads × 128 dim × 2 bytes (f16)
		expect(kvBytesPerToken(arch)).toBe(2 * 32 * 8 * 128 * 2);
	});

	it("charges a hybrid model only for the layers that hold a cache", () => {
		const arch = {
			blockCount: 4,
			kvHeadsPerLayer: [0, 4, 0, 4],
			keyLength: 128,
			valueLength: 128,
		};

		expect(kvBytesPerToken(arch)).toBe(8 * (128 + 128) * 2);
	});

	it("scales with the cache element width", () => {
		const arch = {
			blockCount: 1,
			kvHeadsPerLayer: [8],
			keyLength: 128,
			valueLength: 128,
		};

		const atF16 = kvBytesPerToken(arch, 2) ?? 0;
		expect(atF16).toBeGreaterThan(0);
		expect(kvBytesPerToken(arch, 1)).toBe(atF16 / 2);
	});

	it("returns nothing for an unknown architecture", () => {
		expect(kvBytesPerToken(null)).toBeUndefined();
	});
});

describe("probeGgufArchitecture", () => {
	const rangedFetch = (buffer: ArrayBuffer) =>
		vi.fn(async () => ({
			ok: true,
			status: 206,
			arrayBuffer: async () => buffer,
		}));

	it("reads a model's shape from one ranged request", async () => {
		const buffer = buildGguf(LLAMA_ENTRIES);
		const fetchImpl = rangedFetch(buffer);

		const arch = await probeGgufArchitecture("https://hf.co/m.gguf", {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(arch?.blockCount).toBe(32);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect((init.headers as Record<string, string>).Range).toMatch(/^bytes=0-/);
	});

	it("reports the file size, which is the weight estimate for an uncatalogued model", () => {
		// The ranged response already says how big the whole file is, so nothing
		// extra has to be fetched to estimate the weights.
		const buffer = buildGguf(LLAMA_ENTRIES);
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			status: 206,
			headers: { get: () => `bytes 0-${buffer.byteLength - 1}/987654321` },
			arrayBuffer: async () => buffer,
		}));

		return probeGgufArchitecture("https://hf.co/m.gguf", {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		}).then((arch) => {
			expect(arch?.fileSizeBytes).toBe(987654321);
		});
	});

	it("surfaces a failed range request", async () => {
		const fetchImpl = vi.fn(async () => ({ ok: false, status: 403 }));

		await expect(
			probeGgufArchitecture("https://hf.co/m.gguf", {
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow(/403/);
	});

	it("escalates the range once when the header runs past the first read", async () => {
		const full = buildGguf([
			[
				"tokenizer.ggml.tokens",
				TYPE.ARRAY,
				[TYPE.STRING, Array.from({ length: 200 }, (_, i) => `t${i}`)],
			],
			...LLAMA_ENTRIES,
		]);
		let call = 0;
		const fetchImpl = vi.fn(async () => {
			call += 1;
			// First read returns a short prefix while Content-Range advertises a
			// much larger file — what a 1MB range over a big metadata block does.
			const bytes = call === 1 ? full.slice(0, 64) : full;
			return {
				ok: true,
				status: 206,
				headers: {
					get: () => `bytes 0-${bytes.byteLength - 1}/${full.byteLength}`,
				},
				arrayBuffer: async () => bytes,
			};
		});

		const arch = await probeGgufArchitecture("https://hf.co/m.gguf", {
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(arch?.blockCount).toBe(32);
	});

	it("does not retry a file that is simply not GGUF", async () => {
		const junk = new Writer().u32(0xdeadbeef).u32(3).u64(0).u64(0).build();
		const fetchImpl = rangedFetch(junk);

		await expect(
			probeGgufArchitecture("https://hf.co/m.gguf", {
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow(/Not a GGUF file/);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
