/** Lives in the offscreen document so capture survives popup closure and tab navigation. */
export class TabAudioRecorder {
	private context?: AudioContext;
	private stream?: MediaStream;
	private node?: AudioWorkletNode;
	private source?: MediaStreamAudioSourceNode;
	private stopping?: Promise<void>;
	private starting?: Promise<void>;
	private flushed?: () => void;
	onEnded?: () => void;
	onChunk?: (samples: Float32Array, sampleRate: number) => void;
	onError?: (error: Error) => void;

	start(
		streamId: string,
		options?: { maxWindowSeconds?: number },
	): Promise<void> {
		this.starting ??= this.initialize(streamId, options);
		return this.starting;
	}

	private async initialize(
		streamId: string,
		options?: { maxWindowSeconds?: number },
	): Promise<void> {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					mandatory: {
						chromeMediaSource: "tab",
						chromeMediaSourceId: streamId,
					},
				} as MediaTrackConstraints,
				video: false,
			});
			if (!this.stream.getAudioTracks().length)
				throw new Error("This tab has no capturable audio.");
			this.context = new AudioContext({ sampleRate: 16000 });
			this.source = this.context.createMediaStreamSource(this.stream);
			// tabCapture suppresses the tab's original output. Restore playback exactly once.
			this.source.connect(this.context.destination);
			await this.context.audioWorklet.addModule(
				chrome.runtime.getURL("audio/tab-transcription-worklet.js"),
			);
			this.node = new AudioWorkletNode(
				this.context,
				"memorall-tab-transcription",
				{
					processorOptions: {
						maxWindowSeconds: options?.maxWindowSeconds ?? 5,
					},
				},
			);
			this.node.port.onmessage = ({ data }) => {
				if (data.type === "chunk" && data.samples instanceof ArrayBuffer) {
					this.onChunk?.(
						new Float32Array(data.samples),
						this.context!.sampleRate,
					);
				} else if (data.type === "flushed") this.flushed?.();
			};
			this.node.onprocessorerror = () =>
				this.onError?.(new Error("The audio recorder stopped unexpectedly."));
			this.source.connect(this.node);
			this.node.connect(this.context.destination);
			await this.context.resume();
			for (const track of this.stream.getAudioTracks())
				track.onended = () => this.onEnded?.();
		} catch (error) {
			await this.dispose();
			throw error;
		}
	}

	stop(): Promise<void> {
		this.stopping ??= (async () => {
			try {
				// A tab can close while getUserMedia or the worklet is still starting.
				// Wait for resource ownership before flushing and releasing it.
				try {
					await this.starting;
				} catch {
					return;
				}
				if (this.node) {
					await new Promise<void>((resolve, reject) => {
						const timer = setTimeout(
							() =>
								reject(new Error("Could not flush the final audio window.")),
							5000,
						);
						this.flushed = () => {
							clearTimeout(timer);
							resolve();
						};
						this.node!.port.postMessage("flush");
					});
				}
			} finally {
				await this.dispose();
			}
		})();
		return this.stopping;
	}

	private async dispose(): Promise<void> {
		for (const track of this.stream?.getTracks() ?? []) {
			track.onended = null;
			track.stop();
		}
		this.node?.disconnect();
		this.node?.port.close();
		this.source?.disconnect();
		if (this.context && this.context.state !== "closed")
			await this.context.close();
		this.stream = undefined;
		this.node = undefined;
		this.source = undefined;
		this.context = undefined;
	}
}
