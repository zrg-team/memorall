/**
 * The TypeBox subset the pi port uses, as plain JSON Schema.
 *
 * pi (@mariozechner/pi-ai, pi-coding-agent) declares tool parameters with
 * TypeBox. This module keeps those call sites unchanged: `Type.*` builders
 * return plain JSON Schema objects (what the LLM receives), `Static<T>` infers
 * the argument type, and `Compile` gives the small checker pi-ai's
 * `validateToolArguments` needs.
 */

declare const kStatic: unique symbol;
declare const kOptional: unique symbol;

/** Any JSON Schema object. */
export type TSchema = { [key: string]: unknown };

type Typed<T> = TSchema & { readonly [kStatic]: T };

export type TString = Typed<string>;
export type TNumber = Typed<number>;
export type TInteger = Typed<number>;
export type TBoolean = Typed<boolean>;
export type TNull = Typed<null>;
export type TUnsafe<T> = Typed<T>;
export type TLiteral<T extends string | number | boolean> = Typed<T>;
export type TArray<T extends TSchema> = Typed<Static<T>[]>;
export type TOptional<T extends TSchema> = T & { readonly [kOptional]: true };
export type TUnion<T extends TSchema[]> = Typed<Static<T[number]>>;
export type TRecord<V extends TSchema> = Typed<Record<string, Static<V>>>;

export type Static<T> = T extends { readonly [kStatic]: infer S } ? S : unknown;

type OptionalKeys<P> = {
	[K in keyof P]: P[K] extends { readonly [kOptional]: true } ? K : never;
}[keyof P];
type RequiredKeys<P> = Exclude<keyof P, OptionalKeys<P>>;
type Evaluate<T> = { [K in keyof T]: T[K] } & {};

export type TObject<P extends Record<string, TSchema>> = Typed<
	Evaluate<
		{ [K in RequiredKeys<P>]: Static<P[K]> } & {
			[K in OptionalKeys<P>]?: Static<P[K]>;
		}
	>
>;

type Options = Record<string, unknown>;

const optionalSchemas = new WeakSet<object>();

const typed = <T extends TSchema>(schema: Record<string, unknown>): T =>
	schema as T;

export const Type = {
	String: (options: Options = {}): TString =>
		typed({ ...options, type: "string" }),
	Number: (options: Options = {}): TNumber =>
		typed({ ...options, type: "number" }),
	Integer: (options: Options = {}): TInteger =>
		typed({ ...options, type: "integer" }),
	Boolean: (options: Options = {}): TBoolean =>
		typed({ ...options, type: "boolean" }),
	Null: (options: Options = {}): TNull => typed({ ...options, type: "null" }),
	Literal: <T extends string | number | boolean>(
		value: T,
		options: Options = {},
	): TLiteral<T> => typed({ ...options, const: value, type: typeof value }),
	Array: <T extends TSchema>(items: T, options: Options = {}): TArray<T> =>
		typed({ ...options, type: "array", items }),
	Union: <T extends TSchema[]>(
		anyOf: [...T],
		options: Options = {},
	): TUnion<T> => typed({ ...options, anyOf }),
	Unsafe: <T>(schema: Options): TUnsafe<T> => typed({ ...schema }),
	Record: <V extends TSchema>(
		_key: TString,
		value: V,
		options: Options = {},
	): TRecord<V> =>
		typed({ ...options, type: "object", additionalProperties: value }),
	Optional: <T extends TSchema>(schema: T): TOptional<T> => {
		const copy = { ...schema };
		optionalSchemas.add(copy);
		return copy as TOptional<T>;
	},
	Object: <P extends Record<string, TSchema>>(
		properties: P,
		options: Options = {},
	): TObject<P> => {
		const required = Object.keys(properties).filter(
			(key) => !optionalSchemas.has(properties[key]),
		);
		return typed({
			...options,
			type: "object",
			properties,
			...(required.length > 0 ? { required } : {}),
		});
	},
};

// ---------------------------------------------------------------------------
// Checking (the `typebox/compile` surface pi-ai uses)
// ---------------------------------------------------------------------------

export interface TLocalizedValidationError {
	keyword: string;
	instancePath: string;
	params: Record<string, unknown>;
	message: string;
}

interface JsonSchema {
	type?: string | string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean | JsonSchema;
	items?: JsonSchema | JsonSchema[];
	enum?: unknown[];
	const?: unknown;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	allOf?: JsonSchema[];
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const matchesType = (value: unknown, type: string): boolean => {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		case "array":
			return Array.isArray(value);
		case "object":
			return isRecord(value);
		default:
			return true;
	}
};

const describe = (value: unknown): string =>
	value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

function collectErrors(
	schema: JsonSchema,
	value: unknown,
	path: string,
	errors: TLocalizedValidationError[],
): void {
	const push = (
		keyword: string,
		message: string,
		params: Record<string, unknown> = {},
	) => errors.push({ keyword, instancePath: path, params, message });

	if (schema.allOf) {
		for (const nested of schema.allOf)
			collectErrors(nested, value, path, errors);
	}
	for (const union of [schema.anyOf, schema.oneOf]) {
		if (!union) continue;
		const matched = union.some((nested) => {
			const nestedErrors: TLocalizedValidationError[] = [];
			collectErrors(nested, value, path, nestedErrors);
			return nestedErrors.length === 0;
		});
		if (!matched) push("anyOf", "must match a schema in anyOf");
	}

	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!types.some((type) => matchesType(value, type))) {
			push("type", `must be ${types.join(" or ")}, got ${describe(value)}`, {
				type: schema.type,
			});
			return;
		}
	}
	if (schema.const !== undefined && value !== schema.const) {
		push("const", `must be equal to constant ${JSON.stringify(schema.const)}`);
	}
	if (schema.enum && !schema.enum.includes(value)) {
		push(
			"enum",
			`must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
		);
	}

	if (typeof value === "number") {
		if (schema.minimum !== undefined && value < schema.minimum) {
			push("minimum", `must be >= ${schema.minimum}`);
		}
		if (schema.maximum !== undefined && value > schema.maximum) {
			push("maximum", `must be <= ${schema.maximum}`);
		}
	}
	if (typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) {
			push(
				"minLength",
				`must NOT have fewer than ${schema.minLength} characters`,
			);
		}
		if (schema.maxLength !== undefined && value.length > schema.maxLength) {
			push(
				"maxLength",
				`must NOT have more than ${schema.maxLength} characters`,
			);
		}
	}

	if (Array.isArray(value)) {
		if (schema.minItems !== undefined && value.length < schema.minItems) {
			push("minItems", `must NOT have fewer than ${schema.minItems} items`);
		}
		if (schema.maxItems !== undefined && value.length > schema.maxItems) {
			push("maxItems", `must NOT have more than ${schema.maxItems} items`);
		}
		value.forEach((item, index) => {
			const itemSchema = Array.isArray(schema.items)
				? schema.items[index]
				: schema.items;
			if (itemSchema)
				collectErrors(itemSchema, item, `${path}/${index}`, errors);
		});
	}

	if (isRecord(value)) {
		for (const key of schema.required ?? []) {
			if (!(key in value) || value[key] === undefined) {
				push("required", `must have required property '${key}'`, {
					requiredProperties: [key],
				});
			}
		}
		const properties = schema.properties ?? {};
		for (const [key, child] of Object.entries(value)) {
			const propertySchema = properties[key];
			if (propertySchema) {
				if (child !== undefined) {
					collectErrors(propertySchema, child, `${path}/${key}`, errors);
				}
			} else if (schema.additionalProperties === false) {
				push(
					"additionalProperties",
					`must NOT have additional property '${key}'`,
					{
						additionalProperty: key,
					},
				);
			} else if (isRecord(schema.additionalProperties)) {
				collectErrors(
					schema.additionalProperties,
					child,
					`${path}/${key}`,
					errors,
				);
			}
		}
	}
}

export interface CompiledSchema {
	Check(value: unknown): boolean;
	Errors(value: unknown): TLocalizedValidationError[];
}

export function Compile(schema: TSchema): CompiledSchema {
	const errorsOf = (value: unknown) => {
		const errors: TLocalizedValidationError[] = [];
		collectErrors(schema as JsonSchema, value, "", errors);
		return errors;
	};
	return {
		Check: (value) => errorsOf(value).length === 0,
		Errors: errorsOf,
	};
}

export const Value = {
	/**
	 * TypeBox converts primitives in place for schemas it built. These schemas
	 * carry no TypeBox metadata, so pi-ai's own JSON-schema coercion handles
	 * conversion and this is a no-op.
	 */
	Convert: <T>(_schema: TSchema, value: T): T => value,
};
