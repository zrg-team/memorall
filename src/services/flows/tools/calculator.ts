import z from "zod";
import type { Tool } from "../interfaces/tool";

export const calculatorTool: Tool<
	{ operation: string; a: number; b: number },
	void
> = {
	name: "calculator",
	description: "Perform basic mathematical calculations",
	schema: z.object({
		operation: z.enum(["add", "subtract", "multiply", "divide"]),
		a: z.number().describe("First number"),
		b: z.number().describe("Second number"),
	}),
	execute: async (input: { operation: string; a: number; b: number }) => {
		const { operation, a, b } = input;
		let result: number;

		switch (operation) {
			case "add":
				result = a + b;
				break;
			case "subtract":
				result = a - b;
				break;
			case "multiply":
				result = a * b;
				break;
			case "divide":
				if (b === 0) throw new Error("Division by zero");
				result = a / b;
				break;
			default:
				throw new Error(`Unknown operation: ${operation}`);
		}

		return `${a} ${operation} ${b} = ${result}`;
	},
};
