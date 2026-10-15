import type { HostedAppId } from "../catalog";
import type { HostedEngine } from "../engine-types";

/**
 * An engine over a list of lines, standing in for a hosted app's in tests:
 * `add` appends, `fail` refuses, `read` reads, and the file is the lines.
 */
export const fakeEngine = (
	id: HostedAppId,
	options: { readOnlyFiles?: boolean } = {},
): HostedEngine => ({
	apiVersion: 1,
	id,
	guide: "Lines of text.",
	commands: [
		{
			name: "read",
			description: "Reads the lines. More words.",
			parameters: { type: "object", properties: {}, required: [] },
			readOnly: true,
		},
		{
			name: "add",
			description: "Adds a line.",
			parameters: {
				type: "object",
				properties: {
					text: { type: "string" },
					where: { type: "string", enum: ["top", "bottom"] },
				},
				required: ["text"],
			},
			readOnly: false,
		},
		{
			name: "fail",
			description: "Always refuses.",
			parameters: { type: "object", properties: {} },
			readOnly: false,
		},
	],
	async open(bytes) {
		const lines = bytes?.length
			? new TextDecoder().decode(bytes).split("\n")
			: [];
		return {
			readOnly: !!options.readOnlyFiles,
			describe: () => `${lines.length} lines: ${lines.join(" | ")}`,
			async run(name, args) {
				if (name === "read")
					return { ok: true, content: lines.join("\n"), changed: false };
				if (name === "add") {
					if (args.where === "top") lines.unshift(String(args.text));
					else lines.push(String(args.text));
					return { ok: true, content: `added ${args.text}`, changed: true };
				}
				return { ok: false, content: "Error: refused.", changed: false };
			},
			save: async () => new TextEncoder().encode(lines.join("\n")),
		};
	},
});
