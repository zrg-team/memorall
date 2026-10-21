import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

function worklet(options?: unknown) {
	let Processor: any;
	const output: any[] = [];
	runInNewContext(
		readFileSync("public/audio/tab-transcription-worklet.js", "utf8"),
		{
			sampleRate: 10,
			Float32Array,
			AudioWorkletProcessor: class {
				port = { postMessage: (data: unknown) => output.push(data) };
			},
			registerProcessor: (_name: string, processor: unknown) => {
				Processor = processor;
			},
		},
	);
	return { processor: new Processor(options), output };
}

describe("tab audio worklet", () => {
	it("uses a shorter bounded window for cloud recognition", () => {
		const { processor, output } = worklet({
			processorOptions: { maxWindowSeconds: 3 },
		});
		processor.process([[new Float32Array(70).fill(0.1)]]);
		expect(output).toHaveLength(2);
		expect(new Float32Array(output[0].samples)).toHaveLength(30);
		processor.port.onmessage({ data: "flush" });
		expect(new Float32Array(output[2].samples)).toHaveLength(10);
	});
	it("emits at a natural pause after 1.5 seconds and preserves every sample", () => {
		const { processor, output } = worklet();
		processor.process([[new Float32Array(15).fill(0.1)]]);
		expect(output).toHaveLength(0);
		processor.process([[new Float32Array(4)]]);
		expect(output).toHaveLength(1);
		expect(new Float32Array(output[0].samples)).toHaveLength(19);
		processor.process([[new Float32Array(9).fill(0.1)]]);
		processor.port.onmessage({ data: "flush" });
		expect(new Float32Array(output[1].samples)).toEqual(
			new Float32Array(9).fill(0.1),
		);
		expect(output[2]).toEqual({ type: "flushed" });
	});
	it("mixes stereo and emits exact contiguous windows and a final partial window", () => {
		const { processor, output } = worklet();
		processor.process([
			[new Float32Array(125).fill(0.5), new Float32Array(125).fill(-0.25)],
		]);
		expect(output).toHaveLength(2);
		expect(new Float32Array(output[0].samples)).toEqual(
			new Float32Array(50).fill(0.125),
		);
		processor.port.onmessage({ data: "flush" });
		expect(new Float32Array(output[1].samples)).toEqual(
			new Float32Array(50).fill(0.125),
		);
		expect(new Float32Array(output[2].samples)).toEqual(
			new Float32Array(25).fill(0.125),
		);
		expect(output[3]).toEqual({ type: "flushed" });
		expect(processor.process([[new Float32Array(10)]])).toBe(false);
	});
	it("flushes empty and exact windows without adding duplicate samples", () => {
		const { processor, output } = worklet();
		processor.process([[new Float32Array(100).fill(1)]]);
		processor.port.onmessage({ data: "flush" });
		expect(output.map((item) => item.type)).toEqual([
			"chunk",
			"chunk",
			"flushed",
		]);
		processor.port.onmessage({ data: "flush" });
		expect(output.filter((item) => item.type === "chunk")).toHaveLength(2);
	});
});
