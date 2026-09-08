// Read a GGUF file's metadata header without downloading the weights.
//
// Sizing a context window needs the model's KV-cache cost per token, which the
// reviewed catalogue carries as a hand-computed `kvBytesPerToken`. Any model
// outside that catalogue — every custom Hugging Face repo — had no figure at
// all, so the runner asked for a blind default and relied on the load failing
// to find a size that fits.
//
// GGUF puts all of its key/value metadata at the head of the file, so a ranged
// GET of the first megabyte is normally enough to read the architecture
// parameters the KV formula needs.
//
// Format: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md

const GGUF_MAGIC = 0x46554747; // "GGUF", little-endian
const HEADER_BYTES_FIRST_TRY = 1024 * 1024;
const HEADER_BYTES_RETRY = 8 * 1024 * 1024;

const TYPE = {
	UINT8: 0,
	INT8: 1,
	UINT16: 2,
	INT16: 3,
	UINT32: 4,
	INT32: 5,
	FLOAT32: 6,
	BOOL: 7,
	STRING: 8,
	ARRAY: 9,
	UINT64: 10,
	INT64: 11,
	FLOAT64: 12,
};

const FIXED_WIDTH = {
	[TYPE.UINT8]: 1,
	[TYPE.INT8]: 1,
	[TYPE.UINT16]: 2,
	[TYPE.INT16]: 2,
	[TYPE.UINT32]: 4,
	[TYPE.INT32]: 4,
	[TYPE.FLOAT32]: 4,
	[TYPE.BOOL]: 1,
	[TYPE.UINT64]: 8,
	[TYPE.INT64]: 8,
	[TYPE.FLOAT64]: 8,
};

/** Raised when the header runs past the bytes we fetched. */
class TruncatedError extends Error {}

class Reader {
	constructor(buffer) {
		this.view = new DataView(buffer);
		this.offset = 0;
	}

	require(bytes) {
		if (this.offset + bytes > this.view.byteLength) {
			throw new TruncatedError("GGUF header extends past the fetched range");
		}
	}

	u32() {
		this.require(4);
		const value = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return value;
	}

	u64() {
		this.require(8);
		const value = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		if (value > Number.MAX_SAFE_INTEGER) {
			throw new Error("GGUF length exceeds a safe integer");
		}
		return Number(value);
	}

	string() {
		const length = this.u64();
		this.require(length);
		const bytes = new Uint8Array(this.view.buffer, this.offset, length);
		this.offset += length;
		return new TextDecoder().decode(bytes);
	}

	scalar(type) {
		const width = FIXED_WIDTH[type];
		if (width === undefined) return undefined;
		this.require(width);
		const { view, offset } = this;
		this.offset += width;
		switch (type) {
			case TYPE.UINT8:
				return view.getUint8(offset);
			case TYPE.INT8:
				return view.getInt8(offset);
			case TYPE.UINT16:
				return view.getUint16(offset, true);
			case TYPE.INT16:
				return view.getInt16(offset, true);
			case TYPE.UINT32:
				return view.getUint32(offset, true);
			case TYPE.INT32:
				return view.getInt32(offset, true);
			case TYPE.FLOAT32:
				return view.getFloat32(offset, true);
			case TYPE.BOOL:
				return view.getUint8(offset) !== 0;
			case TYPE.UINT64:
			case TYPE.INT64:
				return Number(
					type === TYPE.UINT64
						? view.getBigUint64(offset, true)
						: view.getBigInt64(offset, true),
				);
			case TYPE.FLOAT64:
				return view.getFloat64(offset, true);
			default:
				return undefined;
		}
	}

	/**
	 * One metadata value. `wanted` says whether the caller needs it: a value it
	 * does not need is skipped without materialising it, which matters because
	 * `tokenizer.ggml.tokens` alone can be megabytes of strings.
	 */
	value(type, wanted) {
		if (type === TYPE.STRING) {
			if (wanted) return this.string();
			const length = this.u64();
			this.require(length);
			this.offset += length;
			return undefined;
		}

		if (type === TYPE.ARRAY) {
			const itemType = this.u32();
			const count = this.u64();
			const width = FIXED_WIDTH[itemType];

			if (width !== undefined && !wanted) {
				this.require(width * count);
				this.offset += width * count;
				return undefined;
			}
			const items = [];
			for (let index = 0; index < count; index++) {
				const item = this.value(itemType, wanted);
				if (wanted) items.push(item);
			}
			return wanted ? items : undefined;
		}

		return this.scalar(type);
	}
}

/**
 * Parse GGUF key/value metadata out of a header buffer.
 * @param {ArrayBuffer} buffer
 * @param {(key: string) => boolean} isWanted Values the caller will actually read.
 * @returns {Record<string, unknown>}
 */
export function parseGgufMetadata(buffer, isWanted = () => true) {
	const reader = new Reader(buffer);

	if (reader.u32() !== GGUF_MAGIC) {
		throw new Error("Not a GGUF file");
	}
	const version = reader.u32();
	if (version < 2 || version > 3) {
		throw new Error(`Unsupported GGUF version: ${version}`);
	}
	reader.u64(); // tensor count, not needed
	const kvCount = reader.u64();

	const metadata = {};
	for (let index = 0; index < kvCount; index++) {
		const key = reader.string();
		const type = reader.u32();
		const value = reader.value(type, isWanted(key));
		if (value !== undefined) metadata[key] = value;
	}
	return metadata;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

/**
 * The architecture numbers the KV formula needs, from parsed GGUF metadata.
 * @param {Record<string, unknown>} metadata
 */
export function describeGgufArchitecture(metadata) {
	const arch = metadata["general.architecture"];
	if (typeof arch !== "string") return null;

	const read = (suffix) => metadata[`${arch}.${suffix}`];
	const blockCount = read("block_count");
	const headCount = read("attention.head_count");
	const embeddingLength = read("embedding_length");
	const trainedContext = read("context_length");

	if (typeof blockCount !== "number" || blockCount <= 0) return null;

	// head_count_kv is per-layer on hybrid and sliding-window models, where some
	// layers keep no KV cache at all. Summing the per-layer counts is what makes
	// those models size correctly instead of being charged for every layer.
	const rawKvHeads = read("attention.head_count_kv");
	const kvHeadsPerLayer = Array.isArray(rawKvHeads)
		? rawKvHeads
		: typeof rawKvHeads === "number"
			? new Array(blockCount).fill(rawKvHeads)
			: typeof headCount === "number"
				? new Array(blockCount).fill(headCount)
				: null;
	if (!kvHeadsPerLayer || kvHeadsPerLayer.length === 0) return null;

	const fallbackHeadDim =
		typeof embeddingLength === "number" &&
		typeof headCount === "number" &&
		headCount > 0
			? embeddingLength / headCount
			: undefined;
	const keyLength = read("attention.key_length") ?? fallbackHeadDim;
	const valueLength = read("attention.value_length") ?? keyLength;

	if (typeof keyLength !== "number" || typeof valueLength !== "number") {
		return null;
	}

	return {
		architecture: arch,
		blockCount,
		kvHeadsPerLayer,
		keyLength,
		valueLength,
		trainedContext:
			typeof trainedContext === "number" && trainedContext > 0
				? trainedContext
				: undefined,
	};
}

/**
 * Bytes of KV cache one token costs.
 *
 * K and V are stored separately per layer, so the cost is the summed per-layer
 * head count times the key and value head dimensions, times the cache element
 * width (f16 by default in llama.cpp).
 *
 * @param {{ blockCount?: number, kvHeadsPerLayer: number[], keyLength: number, valueLength: number } | null | undefined} architecture
 * @param {number} [bytesPerElement] 2 for f16, 1 for q8_0, 0.5 for q4_0.
 */
export function kvBytesPerToken(architecture, bytesPerElement = 2) {
	if (!architecture) return undefined;
	const { kvHeadsPerLayer, keyLength, valueLength } = architecture;
	const headsAcrossLayers = sum(kvHeadsPerLayer);
	const bytes =
		headsAcrossLayers * (keyLength + valueLength) * bytesPerElement;
	return Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
}

const WANTED_SUFFIXES = [
	"block_count",
	"context_length",
	"embedding_length",
	"attention.head_count",
	"attention.head_count_kv",
	"attention.key_length",
	"attention.value_length",
];

function isWantedKey(key) {
	if (key === "general.architecture") return true;
	return WANTED_SUFFIXES.some((suffix) => key.endsWith(`.${suffix}`));
}

/** Total file size from a 206 response's `Content-Range: bytes 0-N/TOTAL`. */
function contentRangeTotal(response) {
	const header = response.headers?.get?.("content-range");
	const total = typeof header === "string" ? header.split("/")[1] : undefined;
	const parsed = Number(total);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * @typedef {object} ProbedArchitecture
 * @property {string} architecture
 * @property {number} blockCount
 * @property {number[]} kvHeadsPerLayer
 * @property {number} keyLength
 * @property {number} valueLength
 * @property {number} [trainedContext]
 * @property {number} [fileSizeBytes] Whole-file size, from the ranged response.
 */

/**
 * Fetch just enough of a GGUF to read its architecture metadata.
 *
 * Escalates the ranged read once: conventionally the architecture keys precede
 * the tokenizer's multi-megabyte token list, but writers are free to reorder.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<ProbedArchitecture | null>}
 */
export async function probeGgufArchitecture(url, options = {}) {
	const doFetch = options.fetchImpl ?? fetch;

	for (const byteCount of [HEADER_BYTES_FIRST_TRY, HEADER_BYTES_RETRY]) {
		const response = await doFetch(url, {
			headers: { Range: `bytes=0-${byteCount - 1}` },
			signal: options.signal,
		});
		if (!response.ok) {
			throw new Error(`GGUF header request failed (${response.status})`);
		}
		const buffer = await response.arrayBuffer();
		try {
			const architecture = describeGgufArchitecture(
				parseGgufMetadata(buffer, isWantedKey),
			);
			// The ranged response already tells us how big the weights are, which
			// is the other half of a memory estimate for a model no catalogue
			// entry covers.
			return architecture
				? { ...architecture, fileSizeBytes: contentRangeTotal(response) }
				: architecture;
		} catch (error) {
			// Only a short read is worth escalating; a malformed file is not.
			if (!(error instanceof TruncatedError)) throw error;
			// A server may return less than the range asked for, so trust the
			// file's own size over the size of the request when deciding whether
			// reading further could possibly help.
			const total = contentRangeTotal(response);
			const moreToRead =
				total !== undefined
					? buffer.byteLength < total
					: buffer.byteLength >= byteCount;
			if (!moreToRead) throw error;
		}
	}
	return null;
}

export const __testing = { TruncatedError, TYPE };
