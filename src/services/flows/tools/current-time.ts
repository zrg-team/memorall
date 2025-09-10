import z from "zod";
import type { Tool } from "../interfaces/tool";

export const currentTimeTool: Tool<{ timezone?: string }> = {
	name: "current_time",
	description: "Get the current date and time",
	schema: z.object({
		timezone: z.string().optional().describe("Timezone (default: UTC)"),
	}),
	execute: async (input: { timezone?: string }) => {
		const { timezone = "UTC" } = input;
		const now = new Date();

		if (timezone === "UTC") {
			return `Current UTC time: ${now.toISOString()}`;
		} else {
			return `Current time in ${timezone}: ${now.toLocaleString("en-US", { timeZone: timezone })}`;
		}
	},
};
