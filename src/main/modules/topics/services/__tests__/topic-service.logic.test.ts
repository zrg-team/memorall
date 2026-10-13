import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { runMigrations } from "@/services/database/migrations";
import { schema } from "@/services/database/schema";

const database = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/services", () => ({
	serviceManager: {
		databaseService: {
			use: async (fn: (context: { db: unknown; schema: unknown }) => unknown) =>
				fn({ db: database.db, schema }),
		},
	},
}));

vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import { TopicService } from "../topic-service";

describe("TopicService on a real database", () => {
	let pg: PGlite;
	const topics = new TopicService();

	beforeAll(async () => {
		pg = new PGlite({ extensions: { vector, uuid_ossp, pg_trgm } });
		await pg.waitReady;
		await runMigrations(pg);
		database.db = drizzle(pg, { schema });
	}, 60_000);

	afterAll(async () => {
		await pg.close();
	});

	beforeEach(async () => {
		await pg.exec("DELETE FROM topic_files; DELETE FROM topics;");
	});

	it("counts each topic's files in one grouped query", async () => {
		const research = await topics.createTopic({ name: "Research" });
		const empty = await topics.createTopic({ name: "Empty" });
		await topics.addFileToTopic(research.id, "/notes/a.md");
		await topics.addFileToTopic(research.id, "/notes/b.md");

		const counted = await topics.getTopicsWithContentCount();

		const byName = Object.fromEntries(
			counted.map((topic) => [topic.name, topic.fileCount]),
		);
		expect(byName).toMatchObject({ Research: 2, Empty: 0 });
		expect(counted.find((topic) => topic.id === empty.id)?.fileCount).toBe(0);
		expect(typeof counted[0]?.fileCount).toBe("number");
	});

	it("maps each file to its topics", async () => {
		const research = await topics.createTopic({ name: "Research" });
		const work = await topics.createTopic({ name: "Work" });
		await topics.addFileToTopic(research.id, "/notes/a.md");
		await topics.addFileToTopic(work.id, "/notes/a.md");
		await topics.addFileToTopic(work.id, "/notes/b.md");

		const map = await topics.getFileTopicMap();

		expect(
			map
				.get("/notes/a.md")
				?.map((topic) => topic.name)
				.sort(),
		).toEqual(["Research", "Work"]);
		expect(map.get("/notes/b.md")?.map((topic) => topic.name)).toEqual([
			"Work",
		]);
	});

	it("adds a file to a second topic and removes it from only one", async () => {
		const research = await topics.createTopic({ name: "Research" });
		const work = await topics.createTopic({ name: "Work" });
		await topics.addFileToTopic(research.id, "/notes/a.md");
		await topics.addFileToTopic(work.id, "/notes/a.md");
		// Adding again is a no-op, not a second row.
		await topics.addFileToTopic(work.id, "/notes/a.md");
		expect(await topics.getTopicFiles(work.id)).toEqual(["/notes/a.md"]);

		await topics.removeFileFromTopic(research.id, "/notes/a.md");

		expect(await topics.getTopicFiles(research.id)).toEqual([]);
		expect(await topics.getTopicFiles(work.id)).toEqual(["/notes/a.md"]);
	});
});
