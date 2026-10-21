/* Fixed PCM windows, each independently decodable as WAV. No MediaRecorder fragments. */
class TabTranscriptionProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const maximum = Math.min(
			5,
			Math.max(2, Number(options?.processorOptions?.maxWindowSeconds) || 5),
		);
		this.windowSize = Math.round(sampleRate * maximum);
		this.minimumSize = Math.round(sampleRate * 1.5);
		this.pauseSize = Math.ceil(sampleRate * 0.35);
		this.quiet = 0;
		this.voiced = false;
		this.buffer = new Float32Array(this.windowSize);
		this.offset = 0;
		this.stopped = false;
		this.port.onmessage = ({ data }) => {
			if (data === "flush") {
				this.stopped = true;
				this.emit();
				this.port.postMessage({ type: "flushed" });
			}
		};
	}
	emit() {
		if (!this.offset) return;
		const samples = this.buffer.slice(0, this.offset);
		this.port.postMessage({ type: "chunk", samples: samples.buffer }, [
			samples.buffer,
		]);
		this.offset = 0;
		this.quiet = 0;
		this.voiced = false;
	}
	process(inputs) {
		if (this.stopped) return false;
		const channels = inputs[0];
		if (!channels?.length) return true;
		for (let frame = 0; frame < channels[0].length; frame++) {
			let mono = 0;
			for (const channel of channels) mono += channel[frame] || 0;
			mono /= channels.length;
			this.buffer[this.offset++] = mono;
			// Pause-aware buffering, not a speech classifier. Quiet speech is still
			// captured by the maximum window; no samples are dropped.
			if (Math.abs(mono) >= 0.008) {
				this.voiced = true;
				this.quiet = 0;
			} else this.quiet++;
			if (
				this.offset === this.windowSize ||
				(this.voiced &&
					this.offset >= this.minimumSize &&
					this.quiet >= this.pauseSize)
			)
				this.emit();
		}
		// Outputs stay silent; the source is also connected directly for normal playback.
		return true;
	}
}
registerProcessor("memorall-tab-transcription", TabTranscriptionProcessor);
