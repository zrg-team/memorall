import { concatFloat32 } from "@/services/llm/utils/media-encoding";

export interface VoiceActivityOptions {
	/** Louder than this starts a turn. */
	startRms: number;
	/** Quieter than this counts as silence. */
	endRms: number;
	/** This much silence ends the turn. */
	endSilenceMs: number;
	/** Audio kept from before the turn, so the first word is not cut. */
	preRollMs: number;
	/** A turn never runs longer than this. */
	maxTurnMs: number;
}

export const DEFAULT_VOICE_ACTIVITY: VoiceActivityOptions = {
	startRms: 0.02,
	endRms: 0.012,
	endSilenceMs: 900,
	preRollMs: 300,
	maxTurnMs: 30_000,
};

export type VoiceActivityEvent = "speech-start" | "turn-end";

const rmsOf = (samples: Float32Array) => {
	if (samples.length === 0) return 0;
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.sqrt(sum / samples.length);
};

/** Splits a microphone stream into spoken turns by loudness. */
export class VoiceActivityDetector {
	private speaking = false;
	private preRoll: Float32Array[] = [];
	private preRollMs = 0;
	private turn: Float32Array[] = [];
	private silenceMs = 0;
	private turnMs = 0;

	constructor(
		private readonly options: VoiceActivityOptions = DEFAULT_VOICE_ACTIVITY,
	) {}

	push(samples: Float32Array, sampleRate: number): VoiceActivityEvent | null {
		const ms = (samples.length / sampleRate) * 1000;
		const rms = rmsOf(samples);

		if (!this.speaking) {
			this.preRoll.push(samples);
			this.preRollMs += ms;
			while (this.preRollMs - ms > this.options.preRollMs) {
				const dropped = this.preRoll.shift();
				if (!dropped) break;
				this.preRollMs -= (dropped.length / sampleRate) * 1000;
			}
			if (rms <= this.options.startRms) return null;
			this.speaking = true;
			this.turn = this.preRoll;
			this.preRoll = [];
			this.preRollMs = 0;
			this.turnMs = ms;
			this.silenceMs = 0;
			return "speech-start";
		}

		this.turn.push(samples);
		this.turnMs += ms;
		this.silenceMs = rms < this.options.endRms ? this.silenceMs + ms : 0;
		return this.silenceMs >= this.options.endSilenceMs ||
			this.turnMs >= this.options.maxTurnMs
			? "turn-end"
			: null;
	}

	/** The finished turn's audio; the detector is ready for the next one. */
	takeTurn(): Float32Array {
		const samples = concatFloat32(this.turn);
		this.reset();
		return samples;
	}

	reset(): void {
		this.speaking = false;
		this.preRoll = [];
		this.preRollMs = 0;
		this.turn = [];
		this.silenceMs = 0;
		this.turnMs = 0;
	}
}
