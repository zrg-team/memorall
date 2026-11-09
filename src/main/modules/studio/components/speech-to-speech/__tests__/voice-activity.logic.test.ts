import { describe, expect, it } from "vitest";
import { VoiceActivityDetector } from "../voice-activity";

const RATE = 1000;
/** 100 ms of audio at a steady amplitude. */
const frame = (amplitude: number) => new Float32Array(100).fill(amplitude);
const LOUD = 0.1;
const QUIET = 0;

describe("VoiceActivityDetector", () => {
	it("stays quiet until someone speaks", () => {
		const detector = new VoiceActivityDetector();
		for (let index = 0; index < 50; index++) {
			expect(detector.push(frame(QUIET), RATE)).toBeNull();
		}
	});

	it("starts on speech and ends after a long enough pause", () => {
		const detector = new VoiceActivityDetector();
		expect(detector.push(frame(LOUD), RATE)).toBe("speech-start");
		for (let index = 0; index < 8; index++) {
			expect(detector.push(frame(QUIET), RATE)).toBeNull();
		}
		expect(detector.push(frame(QUIET), RATE)).toBe("turn-end");
	});

	it("does not end the turn on a short pause", () => {
		const detector = new VoiceActivityDetector();
		detector.push(frame(LOUD), RATE);
		for (let index = 0; index < 5; index++) detector.push(frame(QUIET), RATE);
		expect(detector.push(frame(LOUD), RATE)).toBeNull();
		for (let index = 0; index < 8; index++) {
			expect(detector.push(frame(QUIET), RATE)).toBeNull();
		}
		expect(detector.push(frame(QUIET), RATE)).toBe("turn-end");
	});

	it("keeps a little audio from before the turn", () => {
		const detector = new VoiceActivityDetector();
		for (let index = 0; index < 20; index++) detector.push(frame(QUIET), RATE);
		detector.push(frame(LOUD), RATE);
		for (let index = 0; index < 9; index++) detector.push(frame(QUIET), RATE);
		const samples = detector.takeTurn();
		// The speech, its 900 ms of trailing silence and the 300 ms pre-roll.
		expect(samples.length).toBe(100 + 900 + 300);
	});

	it("ends a turn that never pauses", () => {
		const detector = new VoiceActivityDetector({
			startRms: 0.02,
			endRms: 0.012,
			endSilenceMs: 900,
			preRollMs: 0,
			maxTurnMs: 500,
		});
		expect(detector.push(frame(LOUD), RATE)).toBe("speech-start");
		for (let index = 0; index < 3; index++) {
			expect(detector.push(frame(LOUD), RATE)).toBeNull();
		}
		expect(detector.push(frame(LOUD), RATE)).toBe("turn-end");
	});

	it("is ready for another turn after one is taken", () => {
		const detector = new VoiceActivityDetector();
		detector.push(frame(LOUD), RATE);
		detector.takeTurn();
		expect(detector.push(frame(QUIET), RATE)).toBeNull();
		expect(detector.push(frame(LOUD), RATE)).toBe("speech-start");
	});
});
