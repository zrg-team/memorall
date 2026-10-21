import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabAudioRecorder } from "./tab-audio-recorder";

let context: any;
let node: any;
const mocks = vi.hoisted(() => ({
	stop: vi.fn(),
	getUserMedia: vi.fn(),
	addModule: vi.fn(),
	close: vi.fn(),
	connect: vi.fn(),
	disconnect: vi.fn(),
	portClose: vi.fn(),
}));

describe("offscreen tab audio recorder", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.stubGlobal("chrome", {
			runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
		});
		mocks.getUserMedia.mockResolvedValue({
			getAudioTracks: () => [track],
			getTracks: () => [track],
		});
		vi.stubGlobal("navigator", {
			mediaDevices: { getUserMedia: mocks.getUserMedia },
		});
		vi.stubGlobal(
			"AudioContext",
			class {
				sampleRate = 16000;
				state = "running";
				destination = {};
				audioWorklet = { addModule: mocks.addModule };
				constructor() {
					context = this;
				}
				createMediaStreamSource() {
					return { connect: mocks.connect, disconnect: mocks.disconnect };
				}
				resume = vi.fn(async () => {});
				close = mocks.close;
			},
		);
		vi.stubGlobal(
			"AudioWorkletNode",
			class {
				port = {
					onmessage: (_event: any) => {},
					close: mocks.portClose,
					postMessage: vi.fn(() => {
						this.port.onmessage({
							data: {
								type: "chunk",
								samples: new Float32Array([0.1, 0.2]).buffer,
							},
						});
						this.port.onmessage({ data: { type: "flushed" } });
					}),
				};
				constructor() {
					node = this;
				}
				connect = vi.fn();
				disconnect = mocks.disconnect;
			},
		);
	});
	const track = { stop: mocks.stop, onended: null as (() => void) | null };

	it("preserves playback and delivers the final samples before releasing capture", async () => {
		const recorder = new TabAudioRecorder();
		recorder.onChunk = vi.fn();
		await recorder.start("one-use-stream-id");
		expect(mocks.getUserMedia).toHaveBeenCalledWith({
			audio: {
				mandatory: {
					chromeMediaSource: "tab",
					chromeMediaSourceId: "one-use-stream-id",
				},
			},
			video: false,
		});
		expect(mocks.connect.mock.calls).toEqual([[context.destination], [node]]);
		expect(mocks.addModule).toHaveBeenCalledWith(
			"chrome-extension://test/audio/tab-transcription-worklet.js",
		);
		const stopping = recorder.stop();
		expect(recorder.stop()).toBe(stopping);
		await stopping;
		expect(recorder.onChunk).toHaveBeenCalledWith(
			expect.any(Float32Array),
			16000,
		);
		expect(mocks.stop).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
		expect(mocks.portClose).toHaveBeenCalledOnce();
	});

	it("releases the stream if worklet setup fails", async () => {
		mocks.addModule.mockRejectedValue(new Error("Asset unavailable"));
		await expect(new TabAudioRecorder().start("id")).rejects.toThrow(
			"Asset unavailable",
		);
		expect(mocks.stop).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
	});

	it("does not leak capture when a tab closes before the worklet finishes loading", async () => {
		let ready!: () => void;
		mocks.addModule.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					ready = resolve;
				}),
		);
		const recorder = new TabAudioRecorder();
		const starting = recorder.start("id");
		await vi.waitFor(() => expect(mocks.addModule).toHaveBeenCalled());
		const stopping = recorder.stop();
		expect(mocks.stop).not.toHaveBeenCalled();
		ready();
		await starting;
		await stopping;
		expect(mocks.stop).toHaveBeenCalledOnce();
		expect(mocks.close).toHaveBeenCalledOnce();
	});

	it("notifies the owner when the captured tab ends", async () => {
		const recorder = new TabAudioRecorder();
		recorder.onEnded = vi.fn();
		await recorder.start("id");
		track.onended?.();
		expect(recorder.onEnded).toHaveBeenCalledOnce();
		await recorder.stop();
		expect(track.onended).toBeNull();
	});
});
