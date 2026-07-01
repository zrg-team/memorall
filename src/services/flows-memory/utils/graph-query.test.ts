import { SQL, and, ilike, inArray, is, or } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { edge } from "@/services/database/entities/edges";
import { node } from "@/services/database/entities/nodes";
import { getScopedGraphWhere } from "./graph-query";

describe("getScopedGraphWhere", () => {
	it("returns a Drizzle SQL predicate for an explicit graph", () => {
		const where = getScopedGraphWhere({ graphId: " topic-id " }, node.graph);

		expect(is(where, SQL)).toBe(true);
	});

	it("returns a Drizzle SQL predicate for the default graph", () => {
		const where = getScopedGraphWhere({}, node.graph);

		expect(is(where, SQL)).toBe(true);
	});

	it("compiles load-entities style default graph filters without object params", () => {
		const dialect = new PgDialect();
		const conditions = ["User", "LangChain"].flatMap((name) => {
			const pattern = `%${name}%`;
			return [ilike(node.name, pattern), ilike(node.summary, pattern)];
		});
		const where = and(or(...conditions), getScopedGraphWhere({}, node.graph));

		const query = dialect.sqlToQuery(where!);

		expect(query.sql).toContain('"nodes"."graph" =');
		expect(query.sql).toContain('"nodes"."graph" IS NULL');
		expect(query.sql).not.toMatch(/\band\s+\$\d+\b/i);
		expect(query.params).not.toContainEqual(expect.any(Object));
	});

	it("compiles load-facts style explicit graph filters without object params", () => {
		const dialect = new PgDialect();
		const where = and(
			or(
				inArray(edge.sourceId, ["source-id"]),
				inArray(edge.destinationId, ["dest-id"]),
			),
			getScopedGraphWhere({ graphId: " topic-id " }, edge.graph),
		);

		const query = dialect.sqlToQuery(where!);

		expect(query.sql).toContain('"edges"."graph" =');
		expect(query.sql).not.toContain("IS NULL");
		expect(query.sql).not.toMatch(/\band\s+\$\d+\b/i);
		expect(query.params).toContain("topic-id");
		expect(query.params).not.toContainEqual(expect.any(Object));
	});
});
