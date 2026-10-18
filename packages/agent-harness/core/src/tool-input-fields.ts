import { z } from "zod";

/** Optional controls often arrive as null or an empty form field. */
export const optionalToolField = <T extends z.ZodType>(
	schema: T,
	options: {
		preserveBlank?: boolean;
		normalize?: (value: unknown) => unknown;
	} = {},
) =>
	z
		.preprocess((value) => {
			if (
				value === null ||
				(!options.preserveBlank && typeof value === "string" && !value.trim())
			)
				return undefined;
			return options.normalize ? options.normalize(value) : value;
		}, schema.optional())
		.optional();

export const optionalToolInteger = (
	bounds: { min?: number; max?: number } = {},
) => {
	let schema = z.number().int();
	if (bounds.min !== undefined) schema = schema.min(bounds.min);
	if (bounds.max !== undefined) schema = schema.max(bounds.max);
	return optionalToolField(schema, {
		normalize: (value) => {
			const number = typeof value === "string" ? Number(value) : value;
			if (typeof number !== "number" || !Number.isFinite(number)) return value;
			return Math.min(
				bounds.max ?? Infinity,
				Math.max(bounds.min ?? -Infinity, Math.trunc(number)),
			);
		},
	});
};

export const optionalToolBoolean = () =>
	optionalToolField(z.boolean(), {
		normalize: (value) => {
			if (typeof value !== "string") return value;
			const text = value.trim().toLowerCase();
			return text === "true" ? true : text === "false" ? false : value;
		},
	});

export const toolChoice = <const T extends readonly [string, ...string[]]>(
	values: T,
) =>
	z.preprocess((value) => {
		if (typeof value !== "string") return value;
		if (values.includes(value)) return value;
		const key = (text: string) =>
			text
				.trim()
				.toLowerCase()
				.replace(/[\s-]+/g, "_");
		const matches = values.filter((option) => key(option) === key(value));
		return matches.length === 1 ? matches[0] : value;
	}, z.enum(values));

export const optionalToolChoice = <
	const T extends readonly [string, ...string[]],
>(
	values: T,
) => optionalToolField(toolChoice(values));
