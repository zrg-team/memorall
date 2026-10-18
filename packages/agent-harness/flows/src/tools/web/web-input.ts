import z from "zod";
import { optionalToolField } from "@memorall/agent-harness-core";

export {
	optionalToolField,
	optionalToolBoolean,
	optionalToolInteger,
	optionalToolChoice,
	toolChoice,
} from "@memorall/agent-harness-core";

export const optionalWebString = () => optionalToolField(z.string().trim());
export const webUrl = () => z.string().trim().url();
export const optionalWebUrl = () => optionalToolField(webUrl());

/** Session reuse does not navigate, so navigation-only fields are irrelevant. */
export const withWebSessionTarget = <
	T extends z.ZodType<{ sessionId?: string; url?: string }>,
>(
	schema: T,
) =>
	z.preprocess(
		(input) => {
			if (typeof input !== "object" || input === null || Array.isArray(input))
				return input;
			const value = input as Record<string, unknown>;
			if (typeof value.sessionId !== "string" || !value.sessionId.trim())
				return input;
			const { url: _url, browserMode: _browserMode, ...sessionInput } = value;
			return sessionInput;
		},
		schema.refine((value) => Boolean(value.sessionId || value.url), {
			message: "Either sessionId or url must be provided.",
			path: ["sessionId"],
		}),
	);
