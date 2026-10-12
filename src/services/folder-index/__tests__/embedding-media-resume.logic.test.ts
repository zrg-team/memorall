import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractEmbeddingChunks, textChunks } from "../embedding/chunks";
import type { IndexedFileInfo } from "../types";
const mocks = vi.hoisted(() => ({
	buffers: vi.fn(),
	dispose: vi.fn(),
	duration: 85,
}));
vi.mock("mediabunny", () => ({
	ALL_FORMATS: [],
	BlobSource: class {},
	CanvasSink: class {},
	Input: class {
		getPrimaryAudioTrack = async () => ({
			canDecode: async () => true,
			computeDuration: async () => mocks.duration,
		});
		dispose = mocks.dispose;
	},
	AudioBufferSink: class {
		buffers = mocks.buffers;
	},
}));
const file: IndexedFileInfo = {
	path: "/Work/music.mp3",
	name: "music.mp3",
	documentType: "other",
	mimeType: "audio/mpeg",
	size: 4,
	modifiedAt: "before",
};
describe("resuming native content extraction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.duration = 85;
	});
	it("seeks past completed audio windows before decoding, rather than decoding discarded chunks", async () => {
		mocks.buffers.mockImplementation(async function* (start: number) {
			yield {
				timestamp: start,
				buffer: {
					numberOfChannels: 1,
					sampleRate: 16000,
					length: 16,
					duration: 0.001,
					getChannelData: () => new Float32Array(16),
				},
			};
		});
		const chunks = [];
		for await (const chunk of extractEmbeddingChunks(file, new Uint8Array(4), {
			skipChunks: 2,
		}))
			chunks.push(chunk);
		expect(chunks.map((chunk) => chunk.location)).toEqual([
			{ startSeconds: 56, endSeconds: 85 },
		]);
		expect(mocks.buffers).toHaveBeenCalledTimes(1);
		expect(mocks.buffers).toHaveBeenCalledWith(56, 85);
		expect(mocks.dispose).toHaveBeenCalled();
	});
	it("keeps the original text offsets after skipping saved chunks", async () => {
		const text = "Content paragraph. ".repeat(500),
			expected = [...textChunks(text, "long.txt")].slice(2);
		const chunks = [];
		for await (const chunk of extractEmbeddingChunks(
			{
				...file,
				name: "long.txt",
				mimeType: "text/plain",
				documentType: "text",
			},
			new TextEncoder().encode(text),
			{ skipChunks: 2 },
		))
			chunks.push(chunk);
		expect(chunks).toEqual(expected);
	});
	it("rejects oversized media before decoding or allocating its sample windows", async () => {
		mocks.duration = 100_000;
		const iterator = extractEmbeddingChunks(file, new Uint8Array(4));
		await expect(iterator.next()).rejects.toThrow("2000-chunk limit");
		expect(mocks.buffers).not.toHaveBeenCalled();
		expect(mocks.dispose).toHaveBeenCalled();
	});
});
