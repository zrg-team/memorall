/**
 * What xterm.js sends for the keyboard (its `onData`), read back into keys:
 * text, a paste, or a key with its modifiers, as a terminal encodes them.
 */
export type TerminalKey =
	| { type: "text"; text: string }
	| { type: "paste"; text: string }
	| {
			type: "key";
			/** enter, backspace, up…; a letter for Ctrl or Alt with one. */
			name: string;
			ctrl?: boolean;
			alt?: boolean;
			shift?: boolean;
	  };

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** CSI and SS3 finals for the keys a line editor uses. */
const FINAL_KEYS: Record<string, string> = {
	A: "up",
	B: "down",
	C: "right",
	D: "left",
	H: "home",
	F: "end",
};

/** `ESC [ n ~` keys. */
const TILDE_KEYS: Record<string, string> = {
	"1": "home",
	"2": "insert",
	"3": "delete",
	"4": "end",
	"5": "pageup",
	"6": "pagedown",
	"7": "home",
	"8": "end",
};

const key = (
	name: string,
	modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {},
): TerminalKey => ({ type: "key", name, ...modifiers });

/** A CSI's modifiers: `1 + (shift 1 | alt 2 | ctrl 4 | meta 8)`. */
const csiModifiers = (value: string) => {
	const bits = Number(value) - 1;
	if (!(bits > 0)) return {};
	return {
		...(bits & 1 ? { shift: true } : {}),
		...(bits & (2 | 8) ? { alt: true } : {}),
		...(bits & 4 ? { ctrl: true } : {}),
	};
};

const csiKey = (params: string, final: string): TerminalKey | null => {
	const [first = "", modifier = ""] = params.split(";");
	if (final === "Z") return key("tab", { shift: true });
	const name = final === "~" ? TILDE_KEYS[first] : FINAL_KEYS[final];
	return name ? key(name, csiModifiers(modifier)) : null;
};

export const parseTerminalInput = (data: string): TerminalKey[] => {
	const keys: TerminalKey[] = [];
	let text = "";
	const push = (entry: TerminalKey | null) => {
		if (text) {
			keys.push({ type: "text", text });
			text = "";
		}
		if (entry) keys.push(entry);
	};
	let index = 0;
	while (index < data.length) {
		if (data.startsWith(PASTE_START, index)) {
			const from = index + PASTE_START.length;
			const end = data.indexOf(PASTE_END, from);
			push({
				type: "paste",
				text: data.slice(from, end < 0 ? undefined : end),
			});
			index = end < 0 ? data.length : end + PASTE_END.length;
			continue;
		}
		const char = data[index] as string;
		const code = char.charCodeAt(0);
		if (char === "\x1b") {
			const next = data[index + 1];
			if (next === "[") {
				let end = index + 2;
				while (end < data.length && !/[@-~]/.test(data[end] as string)) {
					end += 1;
				}
				push(csiKey(data.slice(index + 2, end), data[end] ?? ""));
				index = end + 1;
			} else if (next === "O" && index + 2 < data.length) {
				const name = FINAL_KEYS[data[index + 2] as string];
				push(name ? key(name) : null);
				index += 3;
			} else if (next === undefined || next === "\x1b") {
				push(key("escape"));
				index += 1;
			} else {
				// Alt with a key: ESC, then the key.
				if (next === "\x7f" || next === "\b") {
					push(key("backspace", { alt: true }));
				} else if (next === "\r") {
					push(key("enter", { alt: true }));
				} else {
					const lower = next.toLowerCase();
					push(
						key(lower, {
							alt: true,
							...(lower !== next ? { shift: true } : {}),
						}),
					);
				}
				index += 2;
			}
			continue;
		}
		index += 1;
		if (char === "\r" || char === "\n") {
			push(key("enter"));
			// A CR LF is one Enter.
			if (char === "\r" && data[index] === "\n") index += 1;
		} else if (char === "\x7f") {
			push(key("backspace"));
		} else if (char === "\b") {
			// Ctrl+Backspace.
			push(key("backspace", { ctrl: true }));
		} else if (char === "\t") {
			push(key("tab"));
		} else if (code >= 1 && code <= 26) {
			push(key(String.fromCharCode(code + 96), { ctrl: true }));
		} else if (code < 32 || (code >= 0x80 && code < 0xa0)) {
			// Other control characters type nothing.
		} else {
			text += char;
		}
	}
	push(null);
	return keys;
};
