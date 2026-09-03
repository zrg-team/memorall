/*
 * A quiet ambient bed for the promo, synthesised here so the video has no
 * third-party audio to license: a slow four-chord pad, a soft sub, and a
 * sparse pluck arpeggio, through a cheap comb reverb. Writes music.wav next
 * to this file (60 s, 44.1 kHz, stereo, 16-bit).
 */
const fs = require("node:fs");
const path = require("node:path");

const SR = 44100;
const DURATION = 60;
const N = SR * DURATION;

const midi = (m) => 440 * 2 ** ((m - 69) / 12);
// Am9 - Fmaj7 - Cmaj9 - G6, four seconds each, then hold. Warm, unresolved.
const CHORDS = [
	[45, 52, 55, 59, 64], // A2 E3 G3 B3 E4
	[41, 48, 52, 57, 60], // F2 C3 E3 A3 C4
	[48, 52, 55, 59, 62], // C3 E3 G3 B3 D4
	[43, 50, 55, 59, 64], // G2 D3 G3 B3 E4
];
const CHORD_SECONDS = 4;
const CROSSFADE = 1.4;

const left = new Float64Array(N);
const right = new Float64Array(N);

const chordAt = (t) => Math.floor(t / CHORD_SECONDS) % CHORDS.length;
const chordWeight = (t, index) => {
	// Triangle crossfade between neighbouring chords.
	const local = t % CHORD_SECONDS;
	const current = chordAt(t);
	const previous = (current + CHORDS.length - 1) % CHORDS.length;
	if (index === current) return Math.min(1, local / CROSSFADE);
	if (index === previous) return Math.max(0, 1 - local / CROSSFADE);
	return 0;
};

// Pad: each chord tone as three slightly detuned voices with a little harmonic body.
const voice = (f, t, detune) => {
	const phase = 2 * Math.PI * f * (1 + detune) * t;
	return Math.sin(phase) + 0.28 * Math.sin(2 * phase + 0.4) + 0.08 * Math.sin(3 * phase);
};
for (let i = 0; i < N; i++) {
	const t = i / SR;
	let pad = 0;
	for (let c = 0; c < CHORDS.length; c++) {
		const w = chordWeight(t, c);
		if (w <= 0) continue;
		for (const [k, m] of CHORDS[c].entries()) {
			const f = midi(m);
			const swell = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.11 * t + k);
			pad += w * swell * (voice(f, t, 0) + voice(f, t, 0.0032) + voice(f, t, -0.0027)) / 3;
		}
	}
	pad *= 0.11;
	// Sub: the chord root an octave down.
	const current = chordAt(t);
	const sub = 0.16 * Math.sin(2 * Math.PI * midi(CHORDS[current][0] - 12) * t) * Math.min(1, chordWeight(t, current) + 0.4);
	left[i] = pad + sub;
	right[i] = pad + sub;
}

// Pluck arpeggio: one note every half beat at ~72 bpm, high octave, short decay.
const STEP = 60 / 72 / 2;
for (let step = 2; step * STEP < DURATION - 3; step++) {
	const start = step * STEP;
	if (step % 8 === 6) continue; // leave a gap now and then so it breathes
	const chord = CHORDS[chordAt(start)];
	const m = chord[(step * 3) % chord.length] + 24;
	const f = midi(m);
	const pan = ((step % 4) / 3) * 0.7 - 0.35;
	const from = Math.floor(start * SR);
	const len = Math.floor(0.6 * SR);
	for (let j = 0; j < len && from + j < N; j++) {
		const tt = j / SR;
		const env = Math.exp(-tt * 6.5) * (1 - Math.exp(-tt * 400));
		const s = 0.075 * env * (Math.sin(2 * Math.PI * f * tt) + 0.2 * Math.sin(2 * Math.PI * 2 * f * tt));
		left[from + j] += s * (0.5 - pan);
		right[from + j] += s * (0.5 + pan);
	}
}

// One-pole low-pass to round everything off, then comb reverb for space.
const lowpass = (buf, cutoff) => {
	const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
	let y = 0;
	for (let i = 0; i < buf.length; i++) {
		y += a * (buf[i] - y);
		buf[i] = y;
	}
};
lowpass(left, 2600);
lowpass(right, 2600);

const reverb = (buf, delaysMs, feedback, mix) => {
	const wet = new Float64Array(buf.length);
	for (const ms of delaysMs) {
		const d = Math.floor((ms / 1000) * SR);
		const line = new Float64Array(buf.length);
		for (let i = 0; i < buf.length; i++) {
			const back = i - d >= 0 ? line[i - d] : 0;
			line[i] = buf[i] + feedback * back;
			wet[i] += line[i];
		}
	}
	for (let i = 0; i < buf.length; i++) buf[i] = buf[i] * (1 - mix) + (wet[i] / delaysMs.length) * mix;
};
reverb(left, [311, 397, 463, 521], 0.62, 0.35);
reverb(right, [323, 409, 457, 547], 0.62, 0.35);

// Master: fade in/out, normalise to -3 dBFS.
const fadeIn = 2.5 * SR;
const fadeOut = 4 * SR;
let peak = 0;
for (let i = 0; i < N; i++) {
	const g = Math.min(1, i / fadeIn, (N - i) / fadeOut);
	left[i] *= g;
	right[i] *= g;
	peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
}
const gain = (0.707 / peak) || 1;

const header = Buffer.alloc(44);
const dataBytes = N * 4;
header.write("RIFF", 0);
header.writeUInt32LE(36 + dataBytes, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(dataBytes, 40);

const pcm = Buffer.alloc(dataBytes);
for (let i = 0; i < N; i++) {
	pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i] * gain)) * 32767), i * 4);
	pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i] * gain)) * 32767), i * 4 + 2);
}
const out = path.join(__dirname, "music.wav");
fs.writeFileSync(out, Buffer.concat([header, pcm]));
console.log("wrote", out);
