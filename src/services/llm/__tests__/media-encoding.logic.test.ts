import { describe, expect, it } from "vitest";
import { AsyncEventQueue } from "../utils/async-event-queue";
import {
	PcmChunkBatcher,
	base64ToBytes,
	bytesToBase64,
	encodeWav,
	float32ToPcm16,
	pcm16ToFloat32,
} from "../utils/media-encoding";

describe("media encoding", () => {
	it("round-trips bytes through base64, including data URLs", () => {
		const bytes = new Uint8Array(70_000).map((_, index) => index % 256);
		const encoded = bytesToBase64(bytes);
		expect(base64ToBytes(encoded)).toEqual(bytes);
		expect(base64ToBytes(`data:audio/wav;base64,${encoded}`)).toEqual(bytes);
	});

	it("round-trips PCM within 16-bit precision and clamps overflow", () => {
		const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
		const decoded = pcm16ToFloat32(float32ToPcm16(samples));
		expect(decoded[1]).toBeCloseTo(0.5, 3);
		expect(decoded[2]).toBeCloseTo(-0.5, 3);
		expect(decoded[5]).toBeCloseTo(1, 3);
		expect(decoded[6]).toBeCloseTo(-1, 3);
	});

	it("writes a valid mono 16-bit WAV header", () => {
		const wav = encodeWav(new Float32Array(480), 48_000);
		const view = new DataView(wav.buffer);
		const ascii = (offset: number) =>
			String.fromCharCode(...wav.subarray(offset, offset + 4));

		expect(ascii(0)).toBe("RIFF");
		expect(ascii(8)).toBe("WAVE");
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(48_000);
		expect(view.getUint16(34, true)).toBe(16);
		expect(view.getUint32(40, true)).toBe(960);
		expect(wav.byteLength).toBe(44 + 960);
	});

	it("batches 80 ms frames into ~400 ms chunks and flushes the tail", () => {
		const rate = 48_000;
		const frame = () => new Float32Array(rate * 0.08);
		const batcher = new PcmChunkBatcher(rate, 400);

		const emitted: number[] = [];
		for (let index = 0; index < 12; index++) {
			const batch = batcher.push(frame());
			if (batch) emitted.push(batch.length);
		}
		const tail = batcher.flush();

		expect(emitted).toEqual([rate * 0.4, rate * 0.4]);
		expect(tail?.length).toBe(rate * 0.16);
		expect(batcher.flush()).toBeNull();
	});
});

describe("AsyncEventQueue", () => {
	it("delivers pushed values in order, before and after a reader waits", async () => {
		const queue = new AsyncEventQueue<number>();
		queue.push(1);
		const reading = (async () => {
			const values: number[] = [];
			for await (const value of queue) values.push(value);
			return values;
		})();
		await Promise.resolve();
		queue.push(2);
		queue.push(3);
		queue.end();
		expect(await reading).toEqual([1, 2, 3]);
	});

	it("surfaces a failure to the waiting reader", async () => {
		const queue = new AsyncEventQueue<number>();
		const reading = queue.next();
		queue.fail(new Error("runner crashed"));
		await expect(reading).rejects.toThrow("runner crashed");
	});
});
