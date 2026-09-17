import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	existing: null as Record<string, unknown> | null,
	updates: [] as Array<Record<string, unknown>>,
	registered: [] as Array<{ instance: { process: Function } }>,
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFileAsBase64: vi.fn() },
}));

vi.mock("@/services", () => {
	const chain = (rows: () => unknown[]) => {
		const query: Record<string, unknown> = {};
		for (const method of ["from", "where", "orderBy"]) {
			query[method] = () => query;
		}
		query.limit = async () => rows();
		return query;
	};
	return {
		serviceManager: {
			databaseService: {
				use: async (fn: (ctx: { db: unknown; schema: unknown }) => unknown) =>
					fn({
						db: {
							select: () =>
								chain(() => [
									db.existing ?? {
										id: "conversation-1",
										mode: "chat",
									},
								]),
							update: () => ({
								set: (values: Record<string, unknown>) => {
									db.updates.push(values);
									return { where: async () => undefined };
								},
							}),
						},
						schema: {
							conversations: { mode: "mode", createdAt: "created_at" },
							messages: { id: "id" },
						},
					}),
			},
		},
	};
});

vi.mock("../process-factory", () => ({
	backgroundProcessFactory: {
		register: (entry: { instance: { process: Function } }) =>
			db.registered.push(entry),
	},
}));

await import("../process-embedded-chat-history");

const finalize = (message: Record<string, unknown>) =>
	db.registered[0]?.instance.process(
		"job-1",
		{
			payload: { operation: "finalize-message", id: "assistant-1", message },
		},
		{},
	);

describe("finishing a co-agent turn the chat handler already saved", () => {
	beforeEach(() => {
		db.updates = [];
	});

	it("keeps the saved answer when the turn has parts", async () => {
		// The handler wrote the whole flow — text, tool calls, results. The
		// dock's flattened text arriving afterwards must not replace it.
		db.existing = {
			id: "assistant-1",
			role: "assistant",
			content: "",
			parts: [{ role: "assistant", content: "answer" }],
			metadata: { usage: { prompt_tokens: 10 } },
		};

		await finalize({
			content: "answer flattened by the dock",
			metadata: { source: "co-agent" },
		});

		expect(db.updates[0]).toMatchObject({
			content: "",
			metadata: { usage: { prompt_tokens: 10 }, source: "co-agent" },
		});
	});

	it("uses the dock's text when the run never got as far as saving", async () => {
		db.existing = {
			id: "assistant-1",
			role: "assistant",
			content: "",
			parts: null,
			metadata: {},
		};

		await finalize({ content: "The request failed." });

		expect(db.updates[0]).toMatchObject({ content: "The request failed." });
	});
});
