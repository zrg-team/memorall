import type { MemonTerminalLine } from "../types";

/**
 * A sandbox command's output events as Terminal lines. A chunk that ends
 * mid-line (a prompt waiting for an answer, a progress line) ends in a
 * partial line: the screen continues it with what comes next.
 */
export const toTerminalLines = (
	events: Array<{ type: string; text?: string }>,
): MemonTerminalLine[] =>
	events
		.filter((event) => event.type !== "status" && event.text)
		.flatMap((event) => {
			const text = event.text ?? "";
			const ended = text.endsWith("\n");
			const pieces = (ended ? text.slice(0, -1) : text).split("\n");
			const kind =
				event.type === "stderr" ? ("stderr" as const) : ("stdout" as const);
			return pieces.map((piece, index) =>
				!ended && index === pieces.length - 1
					? { kind, text: piece, partial: true }
					: { kind, text: piece },
			);
		});
