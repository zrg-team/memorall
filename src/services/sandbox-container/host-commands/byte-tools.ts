import { resolvePath } from "./command-line";
import type { HostCommand, HostFiles } from "./types";

/**
 * `cat`, `tee` and `base64` in a pipeline that runs a host command. The
 * sandbox shell carries text, so an image or a video read by its `cat`
 * arrives broken; next to host commands these run here instead and pass the
 * bytes on whole (`cat photo.png | magick - small.webp`,
 * `magick a.png png:- | base64 -w0`). A form they do not take here (`cat -n`,
 * a file only the shell has) stays the shell's.
 */

const decoder = new TextDecoder();

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
	const out = new Uint8Array(
		parts.reduce((size, part) => size + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
};

const bytesOutput = (bytes: Uint8Array) => ({
	stdout: decoder.decode(bytes),
	stdoutBytes: bytes,
	stderr: "",
	exitCode: 0,
});

/** `cat [file|-]…`: the files are on the host (byteToolFor checked). */
const cat: HostCommand = async (argv, context) => {
	const names = argv.slice(1);
	const parts: Uint8Array[] = [];
	for (const name of names.length ? names : ["-"]) {
		if (name === "-") {
			if (context.stdin) parts.push(context.stdin);
		} else {
			parts.push(await context.files.read(resolvePath(context.cwd, name)));
		}
	}
	return bytesOutput(concat(parts));
};

const tee: HostCommand = async (argv, context) => {
	const append = argv.includes("-a") || argv.includes("--append");
	const input = context.stdin ?? new Uint8Array();
	const paths = argv
		.slice(1)
		.filter((arg) => !arg.startsWith("-"))
		.map((name) => resolvePath(context.cwd, name))
		.filter((path) => path !== "/dev/null");
	for (const path of paths) {
		const before =
			append && (await context.files.exists(path))
				? await context.files.read(path)
				: new Uint8Array();
		await context.files.write(path, concat([before, input]));
	}
	if (paths.length) context.filesChanged();
	return bytesOutput(input);
};

const BASE64 =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const toBase64 = (bytes: Uint8Array): string => {
	let out = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const [a = 0, b = 0, c = 0] = [
			bytes[index],
			bytes[index + 1],
			bytes[index + 2],
		];
		const chunk = (a << 16) | (b << 8) | c;
		out += BASE64[(chunk >> 18) & 63];
		out += BASE64[(chunk >> 12) & 63];
		out += index + 1 < bytes.length ? BASE64[(chunk >> 6) & 63] : "=";
		out += index + 2 < bytes.length ? BASE64[chunk & 63] : "=";
	}
	return out;
};

/** null when the text is not base64. */
export const fromBase64 = (text: string): Uint8Array | null => {
	const clean = text.replace(/\s+/g, "").replace(/=+$/, "");
	if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) return null;
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0;
	let value = 0;
	let at = 0;
	for (const char of clean) {
		value = (value << 6) | BASE64.indexOf(char);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[at] = (value >> bits) & 255;
			at += 1;
		}
	}
	return out;
};

interface Base64Options {
	decode: boolean;
	ignoreGarbage: boolean;
	wrap: number;
	file?: string;
}

/** base64's options as GNU base64 takes them; null for what this one does not take. */
const base64Options = (args: readonly string[]): Base64Options | null => {
	const options: Base64Options = {
		decode: false,
		ignoreGarbage: false,
		wrap: 76,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] as string;
		if (arg === "-d" || arg === "--decode") options.decode = true;
		else if (arg === "-i" || arg === "--ignore-garbage")
			options.ignoreGarbage = true;
		else if (arg === "-w" || /^-w\d+$/.test(arg) || /^--wrap=\d+$/.test(arg)) {
			const value =
				arg === "-w" ? args[++index] : arg.replace(/^-w|^--wrap=/, "");
			if (!value || !/^\d+$/.test(value)) return null;
			options.wrap = Number(value);
		} else if (arg === "-" || !arg.startsWith("-")) {
			if (options.file !== undefined) return null;
			options.file = arg;
		} else return null;
	}
	return options;
};

const base64: HostCommand = async (argv, context) => {
	const options = base64Options(argv.slice(1)) as Base64Options;
	const input =
		options.file && options.file !== "-"
			? await context.files.read(resolvePath(context.cwd, options.file))
			: (context.stdin ?? new Uint8Array());
	if (options.decode) {
		let text = decoder.decode(input);
		if (options.ignoreGarbage) text = text.replace(/[^A-Za-z0-9+/=]/g, "");
		const bytes = fromBase64(text);
		return bytes
			? bytesOutput(bytes)
			: { stdout: "", stderr: "base64: invalid input\n", exitCode: 1 };
	}
	const encoded = toBase64(input);
	const lines =
		options.wrap > 0
			? (encoded.match(new RegExp(`.{1,${options.wrap}}`, "g")) ?? [])
			: [encoded];
	// GNU base64 ends with a newline, except unwrapped (-w0).
	const text = options.wrap > 0 && encoded ? `${lines.join("\n")}\n` : encoded;
	return { stdout: text, stderr: "", exitCode: 0 };
};

/**
 * The byte tool that runs these words in a host pipeline, if one does:
 * `cat` of files the host has, `tee [-a] file…`, and `base64` with GNU's
 * options.
 */
export const byteToolFor = async (
	argv: readonly string[],
	cwd: string,
	files: HostFiles,
): Promise<HostCommand | null> => {
	const [name, ...args] = argv;
	if (name === "cat") {
		if (args.some((arg) => arg !== "-" && arg.startsWith("-"))) return null;
		for (const arg of args) {
			if (arg === "-") continue;
			const path = resolvePath(cwd, arg);
			if (!(await files.exists(path)) || (await files.isDirectory(path))) {
				return null;
			}
		}
		return cat;
	}
	if (name === "tee") {
		return args.every(
			(arg) => !arg.startsWith("-") || arg === "-a" || arg === "--append",
		)
			? tee
			: null;
	}
	if (name === "base64") {
		const options = base64Options(args);
		if (!options) return null;
		if (options.file && options.file !== "-") {
			const path = resolvePath(cwd, options.file);
			if (!(await files.exists(path)) || (await files.isDirectory(path))) {
				return null;
			}
		}
		return base64;
	}
	return null;
};
