/* Posts microphone input as mono PCM frames. */
class PcmCaptureProcessor extends AudioWorkletProcessor {
	process(inputs) {
		const channel = inputs[0]?.[0];
		if (channel?.length) this.port.postMessage(channel.slice(0));
		return true;
	}
}
registerProcessor("memorall-pcm-capture", PcmCaptureProcessor);
