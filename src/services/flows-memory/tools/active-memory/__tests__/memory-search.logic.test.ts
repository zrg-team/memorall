import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { edge as edgeTable } from "@/services/database/entities/edges";
import { node as nodeTable } from "@/services/database/entities/nodes";
import type { Edge, Node } from "../../../interfaces/knowledge";
import type { ActiveMemoryServices } from "../shared";
import { findMemoryFacts } from "../shared";

const dialect = new PgDialect();

interface CapturedQuery {
	sql: string;
	params: unknown[];
}

const memoryEdge = (id: string, overrides: Partial<Edge> = {}): Edge => ({
	id,
	sourceId: "node-source",
	destinationId: "node-destination",
	edgeType: "prefers",
	factText: `fact ${id}`,
	isCurrent: true,
	attributes: { origin: "active_memory", memoryKind: "preference" },
	...overrides,
});

const graphNodes: Node[] = [
	{ id: "node-source", name: "User", nodeType: "entity" },
	{ id: "node-destination", name: "Dark mode", nodeType: "value" },
];

/**
 * Drizzle builder stand-in that records every where-clause it is handed.
 *
 * The clauses are the point of these tests: which rows a memory lookup is even
 * allowed to consider is decided entirely there, so they are serialized through
 * the real dialect and asserted as SQL rather than trusted as opaque objects.
 */
const createServices = (options: {
	textMatches?: Edge[];
	vectorMatches?: Edge[];
	vectorRows?: Record<string, unknown>[];
	embeddingReady?: boolean;
}) => {
	const captured: CapturedQuery[] = [];
	const edgeBatches = [options.textMatches ?? [], options.vectorMatches ?? []];
	let edgeCall = 0;

	// The node fetch is awaited straight off `.where()` while the edge fetches end
	// in `.limit()`, so the tail of the chain has to be a real promise that also
	// answers the remaining builder calls.
	type QueryTail = Promise<unknown[]> & {
		orderBy: () => QueryTail;
		limit: () => QueryTail;
	};

	const queryTail = (rows: unknown[]): QueryTail => {
		const tail = Promise.resolve(rows) as QueryTail;
		tail.orderBy = () => tail;
		tail.limit = () => tail;
		return tail;
	};

	const db = {
		select: () => ({
			from: (table: unknown) => {
				const rows =
					table === edgeTable ? (edgeBatches[edgeCall++] ?? []) : graphNodes;
				return {
					where: (clause: SQL) => {
						const query = dialect.sqlToQuery(clause);
						captured.push({ sql: query.sql, params: query.params });
						return queryTail(rows);
					},
				};
			},
		}),
	};

	const raw = vi.fn(async () => ({ rows: options.vectorRows ?? [] }));
	const textToVector = vi.fn(async () => [0.1, 0.2, 0.3]);

	const services = {
		database: {
			raw,
			knowledge: {
				schema: { edges: edgeTable, nodes: nodeTable },
				query: async <T>(fn: (ctx: unknown) => Promise<T> | T) =>
					fn({ db, schema: { edges: edgeTable, nodes: nodeTable }, raw }),
			},
		},
		embedding: {
			get: async () =>
				options.embeddingReady === false
					? null
					: { isReady: () => true, textToVector },
		},
	} as unknown as ActiveMemoryServices;

	return { services, captured, raw, textToVector };
};

describe("findMemoryFacts search", () => {
	it("returns a memory that only matches by meaning", async () => {
		// The regression: fact text and query share no substring, which is the
		// normal case for a question asked in the user's own words.
		const semantic = memoryEdge("edge-semantic", {
			factText: "User prefers a dark interface",
		});
		const { services } = createServices({
			textMatches: [],
			vectorMatches: [semantic],
			vectorRows: [{ id: "edge-semantic", similarity: 0.82 }],
		});

		const facts = await findMemoryFacts(services, {
			query: "what look does the app use at night",
		});

		expect(facts.map((fact) => fact.edge.id)).toEqual(["edge-semantic"]);
	});

	it("keeps text hits alongside vector hits without duplicating them", async () => {
		const shared = memoryEdge("edge-shared");
		const vectorOnly = memoryEdge("edge-vector");
		const { services } = createServices({
			textMatches: [shared],
			vectorMatches: [shared, vectorOnly],
			vectorRows: [
				{ id: "edge-vector", similarity: 0.9 },
				{ id: "edge-shared", similarity: 0.7 },
			],
		});

		const facts = await findMemoryFacts(services, { query: "dark mode" });

		expect(facts.map((fact) => fact.edge.id)).toEqual([
			"edge-shared",
			"edge-vector",
		]);
	});

	it("matches saved wording case-insensitively", async () => {
		const { services, captured } = createServices({
			textMatches: [memoryEdge("edge-1")],
		});

		await findMemoryFacts(services, { query: "Dark Mode" });

		expect(captured[0].sql).toContain("ilike");
		expect(captured[0].sql).not.toMatch(/[^i]like/);
	});

	it("treats wildcards in the query as literal characters", async () => {
		const { services, captured } = createServices({
			textMatches: [],
		});

		await findMemoryFacts(services, { query: "100% done_now" });

		expect(captured[0].params).toContain("%100\\% done\\_now%");
	});

	it("scopes to agent-written memories by default", async () => {
		const { services, captured } = createServices({
			textMatches: [memoryEdge("edge-1")],
		});

		await findMemoryFacts(services, { query: "dark mode" });

		expect(captured[0].sql).toContain("'origin'");
		expect(captured[0].params).toContain("active_memory");
	});

	it("reaches extracted knowledge when the scope is 'all'", async () => {
		// Facts written by the ingestion pipeline carry no origin attribute, so an
		// origin filter is what made a populated graph read as empty.
		const { services, captured } = createServices({
			textMatches: [
				memoryEdge("edge-ingested", { attributes: { entityType: "topic" } }),
			],
		});

		const facts = await findMemoryFacts(services, {
			query: "dark mode",
			scope: "all",
		});

		expect(captured[0].params).not.toContain("active_memory");
		expect(facts.map((fact) => fact.edge.id)).toEqual(["edge-ingested"]);
	});

	it("re-applies the scope filters to vector candidates", async () => {
		// The similarity query cannot filter on origin, kind, or currency, so the
		// ranked ids have to come back through the same clauses.
		const { services, captured } = createServices({
			textMatches: [],
			vectorMatches: [memoryEdge("edge-vector")],
			vectorRows: [{ id: "edge-vector", similarity: 0.9 }],
		});

		await findMemoryFacts(services, { query: "dark mode" });

		expect(captured[1].sql).toContain("'origin'");
		expect(captured[1].sql).toContain("in (");
		expect(captured[1].params).toContain("edge-vector");
	});

	it("skips the embedding round trip for an exact id lookup", async () => {
		const { services, raw, textToVector } = createServices({
			textMatches: [memoryEdge("edge-1")],
		});

		await findMemoryFacts(services, { edgeId: "edge-1" });

		expect(textToVector).not.toHaveBeenCalled();
		expect(raw).not.toHaveBeenCalled();
	});

	it("falls back to the text match when no embedding is ready", async () => {
		const { services, raw } = createServices({
			textMatches: [memoryEdge("edge-1")],
			embeddingReady: false,
		});

		const facts = await findMemoryFacts(services, { query: "dark mode" });

		expect(raw).not.toHaveBeenCalled();
		expect(facts.map((fact) => fact.edge.id)).toEqual(["edge-1"]);
	});
});
