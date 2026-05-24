import z from "zod";
import type { Tool, ToolFactory } from "../interfaces/tool";
import { toolRegistry } from "../tool-registry";

const TOOL_NAME = "calculator" as const;

const OPERATIONS = [
	"add",
	"subtract",
	"multiply",
	"divide",
	"power",
	"modulo",
	"nth_root",
	"sqrt",
	"abs",
	"negate",
	"percentage",
	"sum",
	"average",
	"min",
	"max",
	"round",
	"floor",
	"ceil",
	"ln",
	"log10",
	"log",
	"sin",
	"cos",
	"tan",
	"factorial",
	"gcd",
	"lcm",
] as const;

const schema = z.object({
	operation: z.enum(OPERATIONS),
	a: z.number().optional().describe("Primary number"),
	b: z.number().optional().describe("Secondary number"),
	values: z
		.array(z.number())
		.optional()
		.describe("List of values for aggregate operations"),
	precision: z
		.number()
		.int()
		.min(0)
		.max(12)
		.optional()
		.describe("Decimal precision for round/floor/ceil"),
});

type Input = z.infer<typeof schema>;
type Operation = (typeof OPERATIONS)[number];

const ensureFinite = (value: number, label: string) => {
	if (!Number.isFinite(value)) {
		throw new Error(`${label} must be a finite number`);
	}
	return value;
};

const requireNumber = (value: number | undefined, label: string) => {
	if (typeof value !== "number") {
		throw new Error(`${label} is required for this operation`);
	}
	return ensureFinite(value, label);
};

const requirePair = (a: number | undefined, b: number | undefined) => ({
	a: requireNumber(a, "a"),
	b: requireNumber(b, "b"),
});

const requireValues = (values: number[] | undefined): number[] => {
	if (!values || values.length === 0) {
		throw new Error(
			"values is required and must not be empty for this operation",
		);
	}
	return values.map((value, index) => ensureFinite(value, `values[${index}]`));
};

const toInteger = (value: number, label: string): number => {
	if (!Number.isInteger(value)) {
		throw new Error(`${label} must be an integer`);
	}
	return value;
};

const applyPrecision = (value: number, precision?: number) => {
	if (typeof precision !== "number") {
		return value;
	}
	const factor = 10 ** precision;
	return Math.round(value * factor) / factor;
};

const formatNumber = (value: number) => {
	const normalized = Number(value.toFixed(12));
	return Number.isInteger(normalized)
		? normalized.toString()
		: normalized.toString();
};

const factorial = (n: number): number => {
	if (n < 0) {
		throw new Error("factorial is only defined for non-negative integers");
	}
	let result = 1;
	for (let i = 2; i <= n; i++) {
		result *= i;
	}
	return result;
};

const gcd = (a: number, b: number): number => {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y !== 0) {
		const temp = y;
		y = x % y;
		x = temp;
	}
	return x;
};

const lcm = (a: number, b: number): number => {
	if (a === 0 || b === 0) return 0;
	return Math.abs((a * b) / gcd(a, b));
};

const executeOperation = (
	input: Input,
): { result: number; expression: string } => {
	const { operation, a, b, values, precision } = input;

	switch (operation as Operation) {
		case "add": {
			const { a: left, b: right } = requirePair(a, b);
			return { result: left + right, expression: `${left} + ${right}` };
		}
		case "subtract": {
			const { a: left, b: right } = requirePair(a, b);
			return { result: left - right, expression: `${left} - ${right}` };
		}
		case "multiply": {
			const { a: left, b: right } = requirePair(a, b);
			return { result: left * right, expression: `${left} * ${right}` };
		}
		case "divide": {
			const { a: left, b: right } = requirePair(a, b);
			if (right === 0) throw new Error("Division by zero");
			return { result: left / right, expression: `${left} / ${right}` };
		}
		case "power": {
			const { a: left, b: right } = requirePair(a, b);
			return { result: left ** right, expression: `${left} ^ ${right}` };
		}
		case "modulo": {
			const { a: left, b: right } = requirePair(a, b);
			if (right === 0) throw new Error("Modulo by zero");
			return { result: left % right, expression: `${left} % ${right}` };
		}
		case "nth_root": {
			const { a: value, b: root } = requirePair(a, b);
			if (root === 0) throw new Error("Root degree cannot be zero");
			if (value < 0 && root % 2 === 0) {
				throw new Error("Even root of a negative number is not a real number");
			}
			return {
				result: Math.sign(value) * Math.abs(value) ** (1 / root),
				expression: `${root}√${value}`,
			};
		}
		case "sqrt": {
			const value = requireNumber(a, "a");
			if (value < 0)
				throw new Error("Square root of negative number is invalid");
			return { result: Math.sqrt(value), expression: `sqrt(${value})` };
		}
		case "abs": {
			const value = requireNumber(a, "a");
			return { result: Math.abs(value), expression: `abs(${value})` };
		}
		case "negate": {
			const value = requireNumber(a, "a");
			return { result: -value, expression: `-(${value})` };
		}
		case "percentage": {
			const { a: part, b: total } = requirePair(a, b);
			if (total === 0)
				throw new Error("Cannot compute percentage with total = 0");
			return {
				result: (part / total) * 100,
				expression: `(${part}/${total}) * 100`,
			};
		}
		case "sum": {
			const inputValues = requireValues(values);
			return {
				result: inputValues.reduce((acc, current) => acc + current, 0),
				expression: `sum([${inputValues.join(", ")}])`,
			};
		}
		case "average": {
			const inputValues = requireValues(values);
			const sum = inputValues.reduce((acc, current) => acc + current, 0);
			return {
				result: sum / inputValues.length,
				expression: `avg([${inputValues.join(", ")}])`,
			};
		}
		case "min": {
			const inputValues = requireValues(values);
			return {
				result: Math.min(...inputValues),
				expression: `min([${inputValues.join(", ")}])`,
			};
		}
		case "max": {
			const inputValues = requireValues(values);
			return {
				result: Math.max(...inputValues),
				expression: `max([${inputValues.join(", ")}])`,
			};
		}
		case "round": {
			const value = requireNumber(a, "a");
			return {
				result: applyPrecision(value, precision),
				expression:
					typeof precision === "number"
						? `round(${value}, ${precision})`
						: `round(${value})`,
			};
		}
		case "floor": {
			const value = requireNumber(a, "a");
			if (typeof precision !== "number") {
				return { result: Math.floor(value), expression: `floor(${value})` };
			}
			const factor = 10 ** precision;
			return {
				result: Math.floor(value * factor) / factor,
				expression: `floor(${value}, ${precision})`,
			};
		}
		case "ceil": {
			const value = requireNumber(a, "a");
			if (typeof precision !== "number") {
				return { result: Math.ceil(value), expression: `ceil(${value})` };
			}
			const factor = 10 ** precision;
			return {
				result: Math.ceil(value * factor) / factor,
				expression: `ceil(${value}, ${precision})`,
			};
		}
		case "ln": {
			const value = requireNumber(a, "a");
			if (value <= 0)
				throw new Error("ln is defined only for positive numbers");
			return { result: Math.log(value), expression: `ln(${value})` };
		}
		case "log10": {
			const value = requireNumber(a, "a");
			if (value <= 0)
				throw new Error("log10 is defined only for positive numbers");
			return { result: Math.log10(value), expression: `log10(${value})` };
		}
		case "log": {
			const { a: value, b: base } = requirePair(a, b);
			if (value <= 0) throw new Error("log value must be positive");
			if (base <= 0 || base === 1) {
				throw new Error("log base must be positive and not equal to 1");
			}
			return {
				result: Math.log(value) / Math.log(base),
				expression: `log(${value}, base ${base})`,
			};
		}
		case "sin": {
			const value = requireNumber(a, "a");
			return { result: Math.sin(value), expression: `sin(${value})` };
		}
		case "cos": {
			const value = requireNumber(a, "a");
			return { result: Math.cos(value), expression: `cos(${value})` };
		}
		case "tan": {
			const value = requireNumber(a, "a");
			return { result: Math.tan(value), expression: `tan(${value})` };
		}
		case "factorial": {
			const value = toInteger(requireNumber(a, "a"), "a");
			return { result: factorial(value), expression: `${value}!` };
		}
		case "gcd": {
			const pair = requirePair(a, b);
			const left = toInteger(pair.a, "a");
			const right = toInteger(pair.b, "b");
			return { result: gcd(left, right), expression: `gcd(${left}, ${right})` };
		}
		case "lcm": {
			const pair = requirePair(a, b);
			const left = toInteger(pair.a, "a");
			const right = toInteger(pair.b, "b");
			return { result: lcm(left, right), expression: `lcm(${left}, ${right})` };
		}
		default:
			throw new Error(`Unknown operation: ${operation}`);
	}
};

export const createCalculatorTool: ToolFactory<
	Input,
	undefined
> = (): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Perform advanced mathematical calculations across arithmetic, statistics, and scientific operations",
	schema,
	execute: async (input) => {
		const { result, expression } = executeOperation(input);
		ensureFinite(result, "result");
		return `${expression} = ${formatNumber(result)}`;
	},
});

// Self-register the tool
toolRegistry.register(TOOL_NAME, createCalculatorTool);

// Extend global ToolTypeRegistry for type-safe tool creation
declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: undefined;
		};
	}
}
