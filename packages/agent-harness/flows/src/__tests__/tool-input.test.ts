import { describe, expect, it } from "vitest";
import z from "zod";
import {
	describeSchemaIssues,
	parseToolInput,
	ToolInputError,
} from "../interfaces/engine/tool-input.js";

/** The real `web_find_in_page` shape: a pattern plus a deprecated alias. */
const findInPageSchema = z
	.object({
		sessionId: z.string().optional(),
		pattern: z.string().min(1).optional(),
		query: z.string().min(1).optional(),
		selector: z.string().optional(),
	})
	.refine((value) => Boolean(value.pattern || value.query), {
		message: "`pattern` is required.",
		path: ["pattern"],
	});

describe("parseToolInput: empty strings models send", () => {
	it("accepts a complete call carrying an empty deprecated alias", () => {
		// The reported failure: a perfectly specified call rejected because the
		// model also filled in the alias it was told about.
		const parsed = parseToolInput<{ pattern?: string; query?: string }>(
			findInPageSchema,
			{ sessionId: "s1", pattern: "rent", query: "" },
			"web_find_in_page",
		);

		expect(parsed.pattern).toBe("rent");
		expect(parsed.query).toBeUndefined();
	});

	it("treats a whitespace-only argument as absent too", () => {
		const parsed = parseToolInput<{ pattern?: string }>(
			findInPageSchema,
			{ pattern: "rent", query: "   " },
			"web_find_in_page",
		);

		expect(parsed.pattern).toBe("rent");
	});

	it("still fails, readably, when dropping the blank leaves nothing to search for", () => {
		expect(() =>
			parseToolInput(findInPageSchema, { query: "" }, "web_find_in_page"),
		).toThrow(ToolInputError);

		try {
			parseToolInput(findInPageSchema, { query: "" }, "web_find_in_page");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain("web_find_in_page");
			expect(message).toContain("`pattern` is required.");
			// The empty alias is no longer mentioned: the model can do nothing
			// about a field it was right to leave blank.
			expect(message).not.toContain("too_small");
			expect(message).not.toContain("query");
		}
	});

	it("leaves an empty string alone where the schema accepts one", () => {
		// A file's contents or a process's stdin may legitimately be empty, and
		// the schema says so by not complaining.
		const schema = z.object({ path: z.string().min(1), content: z.string() });

		const parsed = parseToolInput<{ content: string }>(
			schema,
			{ path: "a.txt", content: "" },
			"fs_write",
		);

		expect(parsed.content).toBe("");
	});

	it("does not rescue a blank the schema never objected to", () => {
		const schema = z.object({ a: z.string().min(1) });

		expect(() => parseToolInput(schema, { a: "ok", b: "" }, "t")).not.toThrow();
	});
});

describe("describeSchemaIssues", () => {
	it("renders issues as instructions instead of a JSON dump", () => {
		const schema = z.object({
			query: z.string().min(1),
			limit: z.number().int(),
		});
		const result = schema.safeParse({ query: "", limit: "ten" });

		const message = describeSchemaIssues(result.error, "web_search");

		expect(message).toContain("`web_search` rejected the arguments:");
		expect(message).toContain("- query:");
		expect(message).toContain("- limit:");
		expect(message).toContain("Omit a field entirely rather than");
		// The thing that made the transcript unreadable.
		expect(message).not.toContain('"code"');
		expect(message).not.toContain('"inclusive"');
	});

	it("names a nested path the way the model wrote it", () => {
		const schema = z.object({
			filters: z.array(z.object({ name: z.string().min(1) })),
		});
		const result = schema.safeParse({ filters: [{ name: "" }] });

		expect(describeSchemaIssues(result.error)).toContain("- filters[0].name:");
	});

	it("passes a plain error through untouched", () => {
		expect(describeSchemaIssues(new Error("boom"))).toBe("boom");
	});
});
