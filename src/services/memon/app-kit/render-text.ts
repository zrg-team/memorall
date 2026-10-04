import type { MemonControlNode, MemonInputNode, MemonViewNode } from "./types";

/** Lines of a multi-line field the agent sees on one screen. */
const FIELD_LINES = 30;
const FIELD_CHARS = 1_500;
const MARKDOWN_CHARS = 3_000;
const SUGGESTIONS = 6;
/** A row of controls longer than this is written one per line. */
const ROW_CHARS = 220;

const isControl = (node: MemonViewNode): node is MemonControlNode =>
	(node.type === "button" && !node.userOnly) ||
	node.type === "toggle" ||
	node.type === "input" ||
	node.type === "select" ||
	node.type === "tabs";

const childrenOf = (node: MemonViewNode): MemonViewNode[] =>
	node.type === "group" || node.type === "item" ? (node.children ?? []) : [];

/**
 * Refs for the controls, in reading order: the window and the screen text
 * number them the same way, so `[s3]` is the same control in both.
 */
export const assignRefs = (
	nodes: readonly MemonViewNode[],
	prefix: string,
): Map<MemonViewNode, string> => {
	const refs = new Map<MemonViewNode, string>();
	const walk = (list: readonly MemonViewNode[]) => {
		for (const node of list) {
			if (isControl(node)) refs.set(node, `${prefix}${refs.size + 1}`);
			walk(childrenOf(node));
		}
	};
	walk(nodes);
	return refs;
};

/** The control a ref names, with its id, for memon_act. */
export const controlsByRef = (
	nodes: readonly MemonViewNode[],
	prefix: string,
): Map<string, MemonControlNode> => {
	const out = new Map<string, MemonControlNode>();
	for (const [node, ref] of assignRefs(nodes, prefix)) {
		out.set(ref, node as MemonControlNode);
	}
	return out;
};

const cut = (text: string, max: number): string =>
	text.length > max
		? `${text.slice(0, max)}… (${text.length - max} more)`
		: text;

const fieldLines = (node: MemonInputNode, ref: string): string[] => {
	const value = cut(node.value, node.maxChars ?? FIELD_CHARS);
	if (!node.value) return [`[${ref}] ${node.label}: (empty)`];
	if (!node.lines || node.lines <= 1) {
		return [`[${ref}] ${node.label}: "${value.replace(/\n/g, " ")}"`];
	}
	const lines = value.split("\n");
	return [
		`[${ref}] ${node.label}:`,
		...lines.slice(0, FIELD_LINES).map((line) => `  | ${line}`),
		...(lines.length > FIELD_LINES
			? [`  | … ${lines.length - FIELD_LINES} more lines`]
			: []),
	];
};

const STATUS_MARK = { todo: "[ ]", doing: "[~]", done: "[x]" } as const;

/**
 * The window as the agent reads it. Controls carry their refs; things only
 * the user can use are left out.
 */
export const renderViewText = (
	nodes: readonly MemonViewNode[],
	prefix: string,
): string[] => {
	const refs = assignRefs(nodes, prefix);
	const lines: string[] = [];
	const write = (list: readonly MemonViewNode[], indent: string) => {
		for (const node of list) {
			const ref = refs.get(node) ?? "";
			switch (node.type) {
				case "heading":
					lines.push(`${indent}${node.text}:`);
					break;
				case "text": {
					const lead =
						node.tone === "error"
							? "error: "
							: node.tone === "warning"
								? "note: "
								: "";
					for (const line of node.text.split("\n")) {
						lines.push(`${indent}${lead}${line}`);
					}
					break;
				}
				case "markdown":
					for (const line of cut(
						node.text,
						node.maxChars ?? MARKDOWN_CHARS,
					).split("\n")) {
						lines.push(`${indent}  ${line}`);
					}
					break;
				case "progress":
					lines.push(`${indent}${node.label}: ${node.value}/${node.max}`);
					break;
				case "group": {
					if (node.layout === "row") {
						// A row of short things reads as one line, as it looks.
						const start = lines.length;
						const parts: string[] = [];
						let oneLineEach = true;
						for (const child of node.children) {
							const before = lines.length;
							write([child], "");
							const added = lines.length - before;
							if (added > 1) oneLineEach = false;
							if (added === 1) parts.push(lines[lines.length - 1] ?? "");
						}
						const joined = parts.reduce(
							(line, part) =>
								!line
									? part
									: `${line}${line.endsWith(":") ? " " : " · "}${part}`,
							"",
						);
						if (oneLineEach && joined.length <= ROW_CHARS) {
							lines.length = start;
							if (joined) lines.push(`${indent}${joined}`);
							break;
						}
						const written = lines.splice(start);
						lines.push(...written.map((line) => `${indent}${line}`));
						break;
					}
					write(node.children, indent);
					break;
				}
				case "item": {
					const mark = node.status ? STATUS_MARK[node.status] : "-";
					const badges = node.badges?.length
						? ` (${node.badges.map((badge) => (typeof badge === "string" ? badge : badge.text)).join(", ")})`
						: "";
					const head = `${indent}${mark} ${node.title}${node.detail ? ` — ${node.detail}` : ""}${badges}`;
					const start = lines.length;
					write(node.children ?? [], `${indent}  `);
					const added = lines.slice(start);
					// One short line of controls goes on the item's own line.
					const tail = added[0]?.trimStart() ?? "";
					if (added.length === 1 && head.length + tail.length < ROW_CHARS) {
						lines.splice(start, 1, `${head} ${tail}`);
					} else {
						lines.splice(start, 0, head);
					}
					break;
				}
				case "button":
					if (node.userOnly) break;
					lines.push(
						`${indent}[${ref}] ${node.label}${node.disabled ? ` (unavailable: ${node.disabled})` : ""}`,
					);
					break;
				case "toggle": {
					const mark =
						node.variant === "check"
							? node.checked
								? "x"
								: " "
							: node.checked
								? "on"
								: "off";
					lines.push(
						`${indent}[${ref}] [${mark}] ${node.label}${node.disabled ? ` (unavailable: ${node.disabled})` : ""}`,
					);
					break;
				}
				case "input":
					for (const line of fieldLines(node, ref)) {
						lines.push(`${indent}${line}`);
					}
					if (node.suggestions?.length) {
						lines.push(
							`${indent}  e.g. ${node.suggestions.slice(0, SUGGESTIONS).join(", ")}${node.suggestions.length > SUGGESTIONS ? ", …" : ""}`,
						);
					}
					break;
				case "select": {
					const current =
						node.options.find((option) => option.value === node.value)?.label ??
						(node.value || "(none)");
					lines.push(
						`${indent}[${ref}] ${node.label}: ${current} (choose: ${node.options.map((option) => option.value).join(" | ")})`,
					);
					break;
				}
				case "tabs":
					lines.push(
						`${indent}[${ref}] ${node.label}: ${node.options
							.map((option) =>
								option.value === node.value
									? `*${option.value}*`
									: option.value,
							)
							.join(" · ")}`,
					);
					break;
				case "audio":
					lines.push(
						`${indent}audio${node.label ? ` ${node.label}` : ""}: ${node.path}${node.durationMs ? ` (${(node.durationMs / 1000).toFixed(1)} s)` : ""}`,
					);
					break;
				case "image":
					lines.push(
						`${indent}image: ${node.path}${node.detail ? ` (${node.detail})` : ""}`,
					);
					break;
				case "slot":
					for (const line of node.text.split("\n")) {
						lines.push(`${indent}${line}`);
					}
					break;
			}
		}
	};
	write(nodes, "");
	return lines;
};
