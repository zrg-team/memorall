/**
 * Just enough shell parsing to run `git` and `py` outside the sandbox while
 * the rest of a command line still goes to the sandbox shell: chains split at
 * `&&`, `||` and `;`, quoting, leading `NAME=value` assignments, and an output
 * redirect at the end.
 */

export type ChainJoin = "&&" | "||" | ";";

export interface ChainSegment {
	text: string;
	/** How this segment joins the one before it; null for the first. */
	join: ChainJoin | null;
}

export const splitChain = (command: string): ChainSegment[] => {
	const segments: ChainSegment[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let join: ChainJoin | null = null;

	const push = (next: ChainJoin | null) => {
		const text = current.trim();
		if (text) segments.push({ text, join: segments.length ? join : null });
		current = "";
		join = next;
	};

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		if (quote) {
			current += char;
			if (char === "\\" && quote === '"' && index + 1 < command.length) {
				index += 1;
				current += command[index];
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === "\\" && index + 1 < command.length) {
			current += char + command[index + 1];
			index += 1;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		const pair = command.slice(index, index + 2);
		if (pair === "&&" || pair === "||") {
			push(pair);
			index += 1;
			continue;
		}
		if (char === ";" || char === "\n") {
			push(";");
			continue;
		}
		current += char;
	}
	push(null);
	return segments;
};

/** Splits a segment at unquoted `|` into the stages of a pipeline. */
export const splitPipeline = (text: string): string[] => {
	const stages: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] as string;
		if (quote) {
			current += char;
			if (char === "\\" && quote === '"' && index + 1 < text.length) {
				index += 1;
				current += text[index];
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === "\\" && index + 1 < text.length) {
			current += char + text[index + 1];
			index += 1;
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}
		if (char === "|") {
			stages.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	stages.push(current.trim());
	return stages;
};

export interface ParsedSegment {
	argv: string[];
	env: Record<string, string>;
	/** `> file` or `>> file` at the end of the command. */
	redirect?: { path: string; append: boolean };
	/** `2> file` or `2>> file`. */
	stderrRedirect?: { path: string; append: boolean };
	/** `2>&1`: stderr goes where stdout goes. */
	mergeStderr: boolean;
	/** Uses a pipe or input redirect, which only the sandbox shell can run. */
	needsShell: boolean;
}

interface Token {
	value: string;
	/** An unquoted operator such as `|`, `>`, `>>`, `<`, `2>&1`. */
	operator: boolean;
}

const tokenize = (text: string): Token[] => {
	const tokens: Token[] = [];
	let value = "";
	let started = false;
	let quote: '"' | "'" | null = null;

	const flush = () => {
		if (started) tokens.push({ value, operator: false });
		value = "";
		started = false;
	};

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (quote === "'") {
			if (char === "'") quote = null;
			else value += char;
			continue;
		}
		if (quote === '"') {
			if (char === '"') {
				quote = null;
			} else if (
				char === "\\" &&
				index + 1 < text.length &&
				'"\\$`'.includes(text[index + 1])
			) {
				index += 1;
				value += text[index];
			} else {
				value += char;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			started = true;
			continue;
		}
		if (char === "\\" && index + 1 < text.length) {
			index += 1;
			value += text[index];
			started = true;
			continue;
		}
		if (/\s/.test(char)) {
			flush();
			continue;
		}
		const rest = text.slice(index);
		// `2>` is an operator only where a word starts, as in a shell.
		const operator = (
			started
				? [">>", ">", "|", "<"]
				: ["2>&1", "2>>", "2>", ">>", ">", "|", "<"]
		).find((candidate) => rest.startsWith(candidate));
		if (operator) {
			flush();
			tokens.push({ value: operator, operator: true });
			index += operator.length - 1;
			continue;
		}
		value += char;
		started = true;
	}
	flush();
	return tokens;
};

export const parseSegment = (text: string): ParsedSegment => {
	const tokens = tokenize(text);
	const parsed: ParsedSegment = {
		argv: [],
		env: {},
		mergeStderr: false,
		needsShell: false,
	};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.operator) {
			if (token.value === "2>&1") {
				parsed.mergeStderr = true;
			} else if (
				token.value === ">" ||
				token.value === ">>" ||
				token.value === "2>" ||
				token.value === "2>>"
			) {
				const target = tokens[index + 1];
				if (!target || target.operator) {
					parsed.needsShell = true;
					break;
				}
				const redirect = {
					path: target.value,
					append: token.value.endsWith(">>"),
				};
				if (token.value.startsWith("2")) parsed.stderrRedirect = redirect;
				else parsed.redirect = redirect;
				index += 1;
			} else {
				parsed.needsShell = true;
			}
			continue;
		}
		const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(token.value);
		if (!parsed.argv.length && assignment) {
			parsed.env[assignment[1]] = assignment[2];
			continue;
		}
		parsed.argv.push(token.value);
	}
	return parsed;
};

/** Resolves a path the way a shell in `cwd` would. */
export const resolvePath = (cwd: string, path: string): string => {
	const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
	const parts: string[] = [];
	for (const part of absolute.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};
